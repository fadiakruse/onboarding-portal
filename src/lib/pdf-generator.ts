import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { FormConfig } from './forms-config';

const PAGE_MARGIN = 56;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

interface GeneratePdfOptions {
  form: FormConfig;
  answers: Record<string, any>;
  employeeName: string;
  signatureDataUrl: string;
  practiceName: string;
  submittedAt: Date;
  // Raw uploaded files, keyed by field id (e.g. "checkImage"). When present
  // and the mimeType is an image, the actual image is embedded into the PDF
  // in place of that field's usual "Uploaded: <filename>" text line. Non-
  // image uploads (e.g. a PDF scan) still fall back to the filename text,
  // since embedding a PDF's pages inline here would need a different flow.
  fileAttachments?: Record<string, { dataUrl: string; mimeType: string }>;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateFormPdf(opts: GeneratePdfOptions): Promise<Uint8Array> {
  const { form, answers, employeeName, signatureDataUrl, practiceName, submittedAt, fileAttachments } = opts;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - PAGE_MARGIN;

  const newPageIfNeeded = (needed: number) => {
    if (y - needed < PAGE_MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - PAGE_MARGIN;
    }
  };

  const drawHeader = () => {
    page.drawText(practiceName, { x: PAGE_MARGIN, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
    y -= 22;
    page.drawText(form.title, { x: PAGE_MARGIN, y, size: 15, font: boldFont });
    y -= 10;
    page.drawLine({ start: { x: PAGE_MARGIN, y }, end: { x: PAGE_WIDTH - PAGE_MARGIN, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 22;
  };

  drawHeader();

  for (const para of form.intro) {
    const lines = wrapText(para, font, 10, CONTENT_WIDTH);
    for (const line of lines) {
      newPageIfNeeded(14);
      page.drawText(line, { x: PAGE_MARGIN, y, size: 10, font, color: rgb(0.25, 0.25, 0.25) });
      y -= 14;
    }
    y -= 6;
  }

  y -= 4;

  for (const field of form.fields) {
    const rawValue = answers[field.id];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    const attachment = field.type === 'fileUpload' ? fileAttachments?.[field.id] : undefined;
    const isImageAttachment = attachment?.mimeType?.startsWith('image/');

    // Only the Hep B Vaccination form's "Your Choice" field gets highlighted
    // in red on the generated PDF — every other field, on every other form
    // sharing this generic generator, keeps its normal label/value colors.
    const isHepBChoiceField = form.id === '11-hep-b-vaccination' && field.id === 'hepBChoice';
    const red = rgb(0.85, 0, 0);
    const labelColor = isHepBChoiceField ? red : rgb(0.35, 0.35, 0.35);
    const valueColor = isHepBChoiceField ? red : undefined;

    newPageIfNeeded(30);
    page.drawText(field.label, { x: PAGE_MARGIN, y, size: 9, font: boldFont, color: labelColor });
    y -= 13;

    if (isImageAttachment) {
      // Embed the actual uploaded image (e.g. the voided check) instead of
      // just printing "Uploaded: <filename>".
      try {
        const base64 = attachment!.dataUrl.split(',')[1];
        const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
        const isPng = attachment!.mimeType === 'image/png';
        const image = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        const maxImgWidth = CONTENT_WIDTH;
        const maxImgHeight = 260;
        const scale = Math.min(maxImgWidth / image.width, maxImgHeight / image.height, 1);
        const w = image.width * scale;
        const h = image.height * scale;
        newPageIfNeeded(h + 10);
        page.drawImage(image, { x: PAGE_MARGIN, y: y - h, width: w, height: h });
        y -= h + 8;
      } catch (err) {
        console.error(`Could not embed uploaded image for ${field.id}`, err);
        const value = String(rawValue);
        const valueLines = wrapText(value, font, 11, CONTENT_WIDTH);
        for (const line of valueLines) {
          newPageIfNeeded(16);
          page.drawText(line, { x: PAGE_MARGIN, y, size: 11, font });
          y -= 15;
        }
        y -= 8;
      }
      continue;
    }

    const value = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue);
    const valueLines = wrapText(value, font, 11, CONTENT_WIDTH);
    for (const line of valueLines) {
      newPageIfNeeded(16);
      page.drawText(line, { x: PAGE_MARGIN, y, size: 11, font, color: valueColor });
      y -= 15;
    }
    y -= 8;
  }

  newPageIfNeeded(140);
  y -= 10;
  page.drawLine({ start: { x: PAGE_MARGIN, y }, end: { x: PAGE_WIDTH - PAGE_MARGIN, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 20;

  page.drawText('Employee Signature', { x: PAGE_MARGIN, y, size: 9, font: boldFont, color: rgb(0.35, 0.35, 0.35) });
  y -= 8;

  if (signatureDataUrl?.startsWith('data:image/png')) {
    const base64 = signatureDataUrl.split(',')[1];
    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
    const sigImage = await pdfDoc.embedPng(bytes);
    const sigDims = sigImage.scale(0.35);
    const maxSigWidth = 220;
    const scaleFactor = Math.min(1, maxSigWidth / sigDims.width);
    const w = sigDims.width * scaleFactor;
    const h = sigDims.height * scaleFactor;
    newPageIfNeeded(h + 10);
    page.drawImage(sigImage, { x: PAGE_MARGIN, y: y - h, width: w, height: h });
    y -= h + 6;
  } else {
    y -= 30;
  }

  page.drawLine({ start: { x: PAGE_MARGIN, y }, end: { x: PAGE_MARGIN + 220, y }, thickness: 0.75, color: rgb(0.5, 0.5, 0.5) });
  y -= 16;

  page.drawText(`Signed by: ${employeeName}`, { x: PAGE_MARGIN, y, size: 10, font });
  y -= 14;
  page.drawText(
    `Date: ${submittedAt.toLocaleDateString('en-US')} at ${submittedAt.toLocaleTimeString('en-US')}`,
    { x: PAGE_MARGIN, y, size: 10, font }
  );

  return pdfDoc.save();
}
