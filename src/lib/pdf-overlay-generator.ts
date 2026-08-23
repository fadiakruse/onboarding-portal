import { PDFDocument, StandardFonts, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

// Source PDFs for the four documents that need to be filled onto the real,
// original file (as opposed to the generic generated summary used for most
// other forms — see generateFormPdf in pdf-generator.ts). Each of these must
// exist in /public/forms in the repo. None of them have fillable AcroForm
// fields (unlike the W-4), so everything below is drawn as free page content
// at fixed coordinates, same technique already used for the W-4's signature/
// date/employer-address overlay in pdf-w4-generator.ts.
//
// Coordinates below are second-pass, adjusted against real rendered output
// from a live test submission (2026-08-21) — first-pass estimates had the
// date overlapping labels on 05/06, name/date/signature floating too high
// above the line on 07, and the employee name landing mid-paragraph on 08.
// All four fixed below. If anything's still off after this round, it's the
// same kind of nudge the W-4 signature went through — small y/x adjustment,
// not a structural issue.
const FORMS_DIR = path.join(process.cwd(), 'public', 'forms');

function loadSourceBytes(filename: string): Buffer {
  const filePath = path.join(FORMS_DIR, filename);
  return fs.readFileSync(filePath);
}

interface DrawTextSpec {
  page: number; // 0-indexed
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
}

interface DrawSignatureSpec {
  page: number;
  x: number;
  y: number;
  maxWidth?: number;
  maxHeight?: number;
}

interface OverlayOptions {
  sourceFile: string;
  texts?: Array<DrawTextSpec & { value: string }>;
  signature?: DrawSignatureSpec & { dataUrl: string | null | undefined };
}

async function drawSignatureImage(pdfDoc: PDFDocument, page: PDFPage, spec: DrawSignatureSpec & { dataUrl: string | null | undefined }) {
  if (!spec.dataUrl?.startsWith('data:image/png')) return;
  try {
    const base64 = spec.dataUrl.split(',')[1];
    const bytes = Buffer.from(base64, 'base64');
    const img: PDFImage = await pdfDoc.embedPng(bytes);
    const maxW = spec.maxWidth ?? 180;
    const maxH = spec.maxHeight ?? 50;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: spec.x, y: spec.y, width: w, height: h });
  } catch (err) {
    console.error('Could not draw signature onto overlay PDF', err);
  }
}

// Generic engine: loads a bundled source PDF, draws the given text/signature
// at fixed coordinates, and returns the filled bytes. All four document-
// specific functions below are thin wrappers around this.
async function fillOverlayPdf(opts: OverlayOptions): Promise<Uint8Array> {
  const templateBytes = loadSourceBytes(opts.sourceFile);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  for (const t of opts.texts ?? []) {
    const p = pages[t.page];
    if (!p) continue;
    p.drawText(t.value, { x: t.x, y: t.y, size: t.size ?? 10, font: t.bold ? boldFont : font });
  }

  if (opts.signature) {
    const p = pages[opts.signature.page];
    if (p) await drawSignatureImage(pdfDoc, p, opts.signature);
  }

  return pdfDoc.save();
}

interface SimpleSignParams {
  printName: string;
  signatureDataUrl: string | null | undefined;
  submittedAt: Date;
}

// Item 6 — Step 5, Employee HIPAA Confidentiality Agreement.
// FIXED: date was overlapping the "Signature:" line text (moved right to sit
// under "Date:" instead); printName was overlapping the "Print Name:" label
// itself (moved right past the label, onto the blank line).
export async function fillHipaaConfidentialityPdf({ printName, signatureDataUrl, submittedAt }: SimpleSignParams): Promise<Uint8Array> {
  return fillOverlayPdf({
    sourceFile: '05-hipaa-confidentiality.pdf',
    texts: [
      { page: 0, x: 455, y: 108, value: submittedAt.toLocaleDateString('en-US'), size: 12 },
      { page: 0, x: 140, y: 76, value: printName, size: 13 },
    ],
    signature: { page: 0, x: 74, y: 85, dataUrl: signatureDataUrl, maxWidth: 230, maxHeight: 58 },
  });
}

// Item 7 — Step 6, HIPAA Compliance Form. Employee signature/date were
// already landing correctly under "Signature of Employee" (the other, larger
// scrawl on the right is the Compliance Officer's pre-existing signature,
// already part of the source template — not drawn by this code).
// FIXED: date was overlapping the "Date" label directly beneath it — moved
// up so it sits cleanly on the blank line above the label.
export async function fillHipaaCompliancePdf({ signatureDataUrl, submittedAt }: Omit<SimpleSignParams, 'printName'>): Promise<Uint8Array> {
  return fillOverlayPdf({
    sourceFile: '06-hipaa-compliance-form.pdf',
    texts: [
      { page: 0, x: 90, y: 97, value: submittedAt.toLocaleDateString('en-US'), size: 10 },
    ],
    signature: { page: 0, x: 72, y: 132, dataUrl: signatureDataUrl, maxWidth: 198, maxHeight: 50 },
  });
}

interface JobExposureParams {
  employeeName: string;
  exposureCategory: string; // e.g. "Category 1 — Employees Have Regular Exposure"
  signatureDataUrl: string | null | undefined;
  submittedAt: Date;
}

// Item 8 — Step 7, Job Exposure Classification Record.
// FIXED (round 2, per explicit request): employee name now goes to the
// right of the actual "Employee Name:" field near the top of the page,
// instead of floating near the bottom signature line. The category stamp
// moves to sit directly beneath that Employee Name line (in the gap before
// "Exposure Determination Categories"), rather than above the title. Date +
// signature stay down at the "Employee Signature: ___ Date: ___" line —
// only the name itself was relocated, since that's the field it belongs in.
export async function fillJobExposurePdf({ employeeName, exposureCategory, signatureDataUrl, submittedAt }: JobExposureParams): Promise<Uint8Array> {
  return fillOverlayPdf({
    sourceFile: '07-job-exposure-classification.pdf',
    texts: [
      { page: 0, x: 200, y: 562, value: employeeName, size: 14 },
      { page: 0, x: 72, y: 535, value: `Selected: ${exposureCategory}`, size: 11, bold: true },
      { page: 0, x: 461, y: 149, value: submittedAt.toLocaleDateString('en-US'), size: 13 },
    ],
    signature: { page: 0, x: 242, y: 139, dataUrl: signatureDataUrl, maxWidth: 223, maxHeight: 46 },
  });
}

// Item 9 — Step 8, TMGNJ Confidentiality Agreement. Multi-page document;
// "including all agreement text" is satisfied by overlaying onto the actual
// source PDF (which already contains the full agreement body) rather than
// regenerating a summary. Signature + Date on the last page were already
// correctly placed above "Employee's Signature / Date" — unchanged.
// FIXED: employee name on page 1 was landing mid-paragraph (overlapping
// "...paid by the Practice to Employee, it hereby is agreed as follows") —
// moved up to the actual "Employee Name: ____" blank near the top of the
// page, right after the title.
export async function fillTmgnjConfidentialityPdf({ employeeName, signatureDataUrl, submittedAt }: { employeeName: string; signatureDataUrl: string | null | undefined; submittedAt: Date }): Promise<Uint8Array> {
  const templateBytes = loadSourceBytes('08-tmgnj-confidentiality-agreement.pdf');
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const lastPageIndex = pages.length - 1;

  // Name field near the top of page 1 ("Employee Name: ____"), just below
  // the title and above the "This Confidentiality Agreement is made
  // between..." paragraph.
  pages[0].drawText(employeeName, { x: 150, y: pages[0].getHeight() - 191, size: 12, font });

  // Signature + Date on the last page's signature line — already correct.
  const lastPage = pages[lastPageIndex];
  await drawSignatureImage(pdfDoc, lastPage, { page: lastPageIndex, x: 65, y: 88, dataUrl: signatureDataUrl, maxWidth: 224, maxHeight: 56 });
  lastPage.drawText(submittedAt.toLocaleDateString('en-US'), { x: 328, y: 101, size: 11, font });

  return pdfDoc.save();
}

// Item 10 — Step "10-medicare-attestation", append the employee's uploaded
// training-completion certificate as additional page(s) onto the generated
// Medicare Attestation PDF, instead of (or in addition to) storing it as a
// separate file. Handles both a PDF certificate (pages copied in directly)
// and an image certificate (placed on its own new page, scaled to fit).
export async function appendCertificateToPdf(baseBytes: Uint8Array, certificate: { dataUrl: string; mimeType: string }): Promise<Uint8Array> {
  const baseDoc = await PDFDocument.load(baseBytes);
  const base64 = certificate.dataUrl.split(',')[1];
  const certBytes = Buffer.from(base64, 'base64');

  if (certificate.mimeType === 'application/pdf') {
    const certDoc = await PDFDocument.load(certBytes);
    const copiedPages = await baseDoc.copyPages(certDoc, certDoc.getPageIndices());
    copiedPages.forEach((p) => baseDoc.addPage(p));
  } else {
    // Treat anything else as an image (png/jpg/webp all come through the
    // upload field as image/*). Place on its own Letter-size page, centered
    // and scaled to fit within the margins.
    const isPng = certificate.mimeType === 'image/png';
    const img = isPng ? await baseDoc.embedPng(certBytes) : await baseDoc.embedJpg(certBytes);
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 56;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    const page = baseDoc.addPage([pageWidth, pageHeight]);
    page.drawText('Training Completion Certificate', { x: margin, y: pageHeight - margin, size: 12 });
    page.drawImage(img, { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h });
  }

  return baseDoc.save();
}
