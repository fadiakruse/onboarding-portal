import { PDFDocument, StandardFonts } from 'pdf-lib';

const W4_SOURCE_URL = 'https://www.irs.gov/pub/irs-pdf/fw4.pdf';

// Fixed employer info for the "Employers Only" row — this practice's
// details never change, so it's auto-filled every time rather than asked
// of the employee.
const EMPLOYER_NAME_ADDRESS =
  'The Radiology Group of New Jersey LLC D/B/A The Medical Group of New Jersey - 57 US Hwy 46, Hackettstown, NJ 07840';
const EMPLOYER_EIN = '82-3079541';

interface GenerateW4Params {
  answers: Record<string, any>;
  signatureDataUrl: string;
  submittedAt: Date;
}

export async function generateW4Pdf({ answers, signatureDataUrl, submittedAt }: GenerateW4Params): Promise<Uint8Array> {
  const upstream = await fetch(W4_SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NavesinkDerm-OnboardingPortal/1.0)' },
  });
  if (!upstream.ok) {
    throw new Error(`Could not fetch the official W-4 (status ${upstream.status}).`);
  }

  const templateBytes = await upstream.arrayBuffer();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  function setText(fieldName: string, value: any) {
    if (value === undefined || value === null || value === '') return;
    try {
      form.getTextField(fieldName).setText(String(value));
    } catch (err) {
      console.error(`W-4 field ${fieldName} could not be set`, err);
    }
  }

  function setCheck(fieldName: string, checked: boolean) {
    try {
      const box = form.getCheckBox(fieldName);
      if (checked) box.check();
      else box.uncheck();
    } catch (err) {
      console.error(`W-4 checkbox ${fieldName} could not be set`, err);
    }
  }

  // Step 1: personal info. The app's own address field is one combined
  // string ("<street>, <city>, <state> <zip>"); the real PDF has two
  // separate fields, so split on the first comma.
  const rawAddress = String(answers.w4Address || '');
  const [streetPart, ...restParts] = rawAddress.split(',');
  const cityStateZip = restParts.join(',').trim();

  setText('topmostSubform[0].Page1[0].Step1a[0].f1_01[0]', answers.w4FirstName);
  setText('topmostSubform[0].Page1[0].Step1a[0].f1_02[0]', answers.w4LastName);
  setText('topmostSubform[0].Page1[0].Step1a[0].f1_03[0]', streetPart.trim());
  setText('topmostSubform[0].Page1[0].Step1a[0].f1_04[0]', cityStateZip);
  setText('topmostSubform[0].Page1[0].f1_05[0]', answers.w4Ssn);

  // Filing status — three independently-addressable checkboxes, only one checked.
  setCheck('topmostSubform[0].Page1[0].c1_1[0]', answers.w4FilingStatus === 'Single or Married filing separately');
  setCheck(
    'topmostSubform[0].Page1[0].c1_1[1]',
    answers.w4FilingStatus === 'Married filing jointly or Qualifying surviving spouse'
  );
  setCheck('topmostSubform[0].Page1[0].c1_1[2]', answers.w4FilingStatus === 'Head of household');

  // Step 2(c)
  setCheck('topmostSubform[0].Page1[0].c1_2[0]', !!answers.w4MultipleJobs);

  // Step 3
  setText('topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_06[0]', answers.w4Dependents3a);
  setText('topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_07[0]', answers.w4Dependents3b);
  setText('topmostSubform[0].Page1[0].f1_08[0]', answers.w4Dependents);

  // Step 4
  setText('topmostSubform[0].Page1[0].f1_09[0]', answers.w4OtherIncome);
  setText('topmostSubform[0].Page1[0].f1_10[0]', answers.w4Deductions);
  setText('topmostSubform[0].Page1[0].f1_11[0]', answers.w4ExtraWithholding);

  // Exempt
  setCheck('topmostSubform[0].Page1[0].c1_3[0]', !!answers.w4Exempt);

  // "Employers Only" row (f1_12 / f1_13 / f1_14) — the IRS's own layout
  // puts this row directly below the employee signature line. f1_12 is
  // Employer's name and address, f1_14 is the EIN — both fixed for this
  // practice, so they're auto-filled every time. f1_13 (First date of
  // employment) is left blank for HR/payroll to complete separately.
  setText('topmostSubform[0].Page1[0].f1_12[0]', EMPLOYER_NAME_ADDRESS);
  setText('topmostSubform[0].Page1[0].f1_14[0]', EMPLOYER_EIN);

  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.getPages()[0];

  // The actual "Employee's signature ... Date" line (Step 5: Sign Here) has
  // no fillable AcroForm field at all — the IRS left it as ink-only. It sits
  // directly above the Employers Only row (y=36), so both are drawn as free
  // page content rather than filled into a form field. This position is a
  // careful estimate from the surrounding fields' coordinates; nudge the y
  // value here if it needs adjusting once you see a real output.
  const signLineY = 65;

  if (signatureDataUrl) {
    try {
      const base64 = signatureDataUrl.split(',')[1];
      const pngBytes = Buffer.from(base64, 'base64');
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const sigHeight = 20;
      const sigWidth = (pngImage.width / pngImage.height) * sigHeight;
      page.drawImage(pngImage, { x: 95, y: signLineY, width: sigWidth, height: sigHeight });
    } catch (err) {
      console.error('Could not draw signature onto W-4', err);
    }
  }

  // Date — server-generated timestamp, not client-supplied, so it can't be
  // spoofed. Drawn next to the signature on the same line.
  page.drawText(submittedAt.toLocaleDateString('en-US'), {
    x: 420,
    y: signLineY + 4,
    size: 10,
    font: helv,
  });

  form.updateFieldAppearances(helv);
  form.flatten();

  return pdfDoc.save();
}
