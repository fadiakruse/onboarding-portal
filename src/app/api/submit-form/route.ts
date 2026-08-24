import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { FORMS, getFormById } from '@/lib/forms-config';
import { generateFormPdf } from '@/lib/pdf-generator';
import { sanitizeFolderSegment } from '@/lib/formatters';
import { generateW4Pdf } from '@/lib/pdf-w4-generator';
import {
  fillHipaaConfidentialityPdf,
  fillHipaaCompliancePdf,
  fillJobExposurePdf,
  fillTmgnjConfidentialityPdf,
  appendCertificateToPdf,
} from '@/lib/pdf-overlay-generator';

function extFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/.exec(dataUrl);
  const mime = match?.[1] || 'application/octet-stream';
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  return '';
}

function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/.exec(dataUrl);
  return match?.[1] || 'application/octet-stream';
}

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { formId, answers, signature } = body as { formId: string; answers: Record<string, any>; signature: string | null };

  const form = getFormById(formId);
  if (!form) return NextResponse.json({ error: 'Unknown form' }, { status: 400 });

  const form1 = FORMS[0];

  const { data: statusRows } = await supabase.from('employee_forms').select('form_id, status, answers').eq('employee_id', user.id);
  const statusMap = new Map((statusRows ?? []).map((r) => [r.form_id, r]));

  if (form.order !== 1) {
    const form1Completed = statusMap.get(form1.id)?.status === 'completed';
    if (!form1Completed) return NextResponse.json({ error: 'Please complete the Employee Data Form first.' }, { status: 409 });
  }

  for (const f of form.fields) {
    if (f.type === 'confirmOf' && f.confirmOf) {
      const a = answers[f.id];
      const b = answers[f.confirmOf];
      if (a && b && a !== b) return NextResponse.json({ error: `${f.label} does not match. Please double-check both entries.` }, { status: 400 });
    }
  }

  if (form.requiresSignature && !signature) return NextResponse.json({ error: 'Signature is required.' }, { status: 400 });

  const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', user.id).single();

  let firstName = '';
  let lastName = '';
  let hireDate = '';
  if (form.id === form1.id) {
    firstName = answers.firstName || '';
    lastName = answers.lastName || '';
    hireDate = answers.startDate || '';
  } else {
    const form1Answers = statusMap.get(form1.id)?.answers as Record<string, any> | undefined;
    firstName = form1Answers?.firstName || '';
    lastName = form1Answers?.lastName || '';
    hireDate = form1Answers?.startDate || '';
  }

  const employeeName = profile?.full_name || profile?.email || user.email || 'Employee';
  const fullNameFromForm1 = [firstName, lastName].filter(Boolean).join(' ') || employeeName;
  const practiceName = process.env.NEXT_PUBLIC_PRACTICE_NAME || 'Your Practice';

  if (form.id === form1.id) {
    await supabase.from('profiles').update({ first_name: firstName, last_name: lastName }).eq('id', user.id);
  }

  const folderLast = sanitizeFolderSegment(lastName) || 'Employee';
  const folderFirst = sanitizeFolderSegment(firstName) || 'Unknown';
  const employeeFolder = `${folderLast}, ${folderFirst}`;
  const folderPrefix = `Employee Files/${employeeFolder}/Onboarding Forms`;

  const printableAnswers: Record<string, any> = { ...answers };
  const uploadedFileFields = form.fields.filter((f) => f.type === 'fileUpload');

  // Keep the raw uploaded file (dataUrl + mimeType) around for forms that
  // need to fold it into the generated PDF (currently just the Medicare
  // Attestation's training certificate — item 10), even though
  // printableAnswers below gets overwritten with a plain "Uploaded: x" label
  // for display purposes.
  const rawUploadedFiles: Record<string, { dataUrl: string; mimeType: string }> = {};

  for (const f of uploadedFileFields) {
    const fileValue = answers[f.id] as { name: string; dataUrl: string } | null | undefined;
    if (!fileValue?.dataUrl) continue;
    const base64 = fileValue.dataUrl.split(',')[1];
    if (!base64) continue;
    const bytes = Buffer.from(base64, 'base64');
    const ext = extFromDataUrl(fileValue.dataUrl) || '';
    const filePath = `${folderPrefix}/${form.id}-${f.id}${ext}`;
    const { error: fileUploadError } = await supabase.storage.from('new-hire-forms').upload(filePath, bytes, { upsert: true });
    if (fileUploadError) {
      console.error(`Upload failed for ${f.id}`, fileUploadError);
      return NextResponse.json({ error: `Could not save the uploaded file for "${f.label}": ${fileUploadError.message}` }, { status: 500 });
    }
    rawUploadedFiles[f.id] = { dataUrl: fileValue.dataUrl, mimeType: mimeFromDataUrl(fileValue.dataUrl) };
    printableAnswers[f.id] = `Uploaded: ${fileValue.name}`;
  }

  let pdfBytes: Uint8Array;
  try {
    if (form.id === '02-w4-2026') {
      pdfBytes = await generateW4Pdf({
        answers: printableAnswers,
        signatureDataUrl: signature || '',
        submittedAt: new Date(),
        hireDate,
      });
    } else if (form.id === '05-hipaa-confidentiality') {
      pdfBytes = await fillHipaaConfidentialityPdf({
        printName: printableAnswers.printName || fullNameFromForm1,
        signatureDataUrl: signature,
        submittedAt: new Date(),
      });
    } else if (form.id === '06-hipaa-compliance') {
      pdfBytes = await fillHipaaCompliancePdf({
        signatureDataUrl: signature,
        submittedAt: new Date(),
      });
    } else if (form.id === '07-job-exposure-classification') {
      pdfBytes = await fillJobExposurePdf({
        employeeName: fullNameFromForm1,
        exposureCategory: printableAnswers.exposureCategory || '',
        signatureDataUrl: signature,
        submittedAt: new Date(),
      });
    } else if (form.id === '08-confidentiality-agreement') {
      pdfBytes = await fillTmgnjConfidentialityPdf({
        employeeName: printableAnswers.employeeFullName || fullNameFromForm1,
        signatureDataUrl: signature,
        submittedAt: new Date(),
      });
    } else {
      pdfBytes = await generateFormPdf({
        form, answers: printableAnswers,
        employeeName: fullNameFromForm1,
        signatureDataUrl: signature || '', practiceName, submittedAt: new Date(),
        fileAttachments: rawUploadedFiles,
      });

      // Item 10 — Medicare Attestation: fold the uploaded training
      // certificate in as additional page(s) on the generated PDF.
      if (form.id === '10-medicare-attestation' && rawUploadedFiles.trainingCertificate) {
        pdfBytes = await appendCertificateToPdf(pdfBytes, rawUploadedFiles.trainingCertificate);
      }
    }
  } catch (err) {
    console.error('PDF generation failed', err);
    return NextResponse.json({ error: 'Could not generate PDF.' }, { status: 500 });
  }

  const path = `${folderPrefix}/${form.id}.pdf`;
  const pdfBuffer = Buffer.from(pdfBytes);

  const { error: uploadError } = await supabase.storage.from('new-hire-forms').upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (uploadError) {
    console.error('Upload failed', uploadError);
    return NextResponse.json({ error: `Could not save the PDF: ${uploadError.message}` }, { status: 500 });
  }

  const { error: dbError } = await supabase.from('employee_forms').update({
    status: 'completed', answers: printableAnswers, pdf_path: path,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    // Clear any prior rejection so a resubmission goes back to "awaiting
    // review" instead of carrying the old rejected/accepted state forward.
    review_status: null, review_comment: null, reviewed_by: null, reviewed_at: null,
  }).eq('employee_id', user.id).eq('form_id', form.id);

  if (dbError) {
    console.error('DB update failed', dbError);
    return NextResponse.json({ error: 'Could not save your progress.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
