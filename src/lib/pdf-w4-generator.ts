import { PDFDocument, StandardFonts } from 'pdf-lib';

const W4_SOURCE_URL = 'https://www.irs.gov/pub/irs-pdf/fw4.pdf';

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

  // Signature — drawn as the actual signature image (drawn or typed-cursive
  // PNG captured by the existing SignaturePad), positioned over the real
  // signature field's location rather than typed as plain text.
  if (signatureDataUrl) {
    try {
      const base64 = signatureDataUrl.split(',')[1];
      const pngBytes = Buffer.from(base64, 'base64');
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const sigField = form.getTextField('topmostSubform[0].Page1[0].f1_12[0]');
      const widget = sigField.acroField.getWidgets()[0];
      const rect = widget.getRectangle();
      const page = pdfDoc.getPages()[0];
      const sigHeight = Math.min(rect.height, 22);
      const sigWidth = (pngImage.width / pngImage.height) * sigHeight;
      page.drawImage(pngImage, {
        x: rect.x + 2,
        y: rect.y + (rect.height - sigHeight) / 2,
        width: sigWidth,
        height: sigHeight,
      });
    } catch (err) {
      console.error('Could not draw signature onto W-4', err);
    }
  }

  // Date — server-generated timestamp, not client-supplied, so it can't be spoofed.
  setText('topmostSubform[0].Page1[0].f1_13[0]', submittedAt.toLocaleDateString('en-US'));

  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(helv);
  form.flatten();

  return pdfDoc.save();
}
