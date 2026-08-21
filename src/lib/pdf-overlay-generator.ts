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
// IMPORTANT — coordinates below are first-pass estimates based on the plain
// text layout of each source document (Letter size, 612x792pt, origin at
// bottom-left). They have NOT been visually verified against the rendered
// PDFs. Expect one round of "nudge the numbers" the same way the W-4's
// signature position was tuned in past commits — generate one real submission
// per document, open the resulting PDF, and adjust x/y as needed.
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
// Source doc is a single page ending with a "Signature ... Date" line
// followed by "Print Name" below it.
export async function fillHipaaConfidentialityPdf({ printName, signatureDataUrl, submittedAt }: SimpleSignParams): Promise<Uint8Array> {
  return fillOverlayPdf({
    sourceFile: '05-hipaa-confidentiality.pdf',
    texts: [
      { page: 0, x: 300, y: 98, value: submittedAt.toLocaleDateString('en-US'), size: 10 },
      { page: 0, x: 72, y: 76, value: printName, size: 11 },
    ],
    signature: { page: 0, x: 72, y: 104, dataUrl: signatureDataUrl, maxWidth: 190, maxHeight: 45 },
  });
}

// Item 7 — Step 6, HIPAA Compliance Form. Two side-by-side signature lines
// (Employee / Compliance Officer) with a single Date line beneath — only the
// Employee side + Date are filled; the Compliance Officer line stays blank
// for the office to complete separately.
export async function fillHipaaCompliancePdf({ signatureDataUrl, submittedAt }: Omit<SimpleSignParams, 'printName'>): Promise<Uint8Array> {
  return fillOverlayPdf({
    sourceFile: '06-hipaa-compliance-form.pdf',
    texts: [
      { page: 0, x: 72, y: 84, value: submittedAt.toLocaleDateString('en-US'), size: 10 },
    ],
    signature: { page: 0, x: 72, y: 106, dataUrl: signatureDataUrl, maxWidth: 190, maxHeight: 40 },
  });
}

interface JobExposureParams {
  employeeName: string;
  exposureCategory: string; // e.g. "Category 1 — Employees Have Regular Exposure"
  signatureDataUrl: string | null | undefined;
  submittedAt: Date;
}

// Item 8 — Step 7, Job Exposure Classification Record. The category
// checkboxes on the original PDF aren't in a fixed, easily-targetable spot
// from text layout alone, so rather than guess checkbox coordinates, the
// selected category is stamped as a clear text line ("Selected: Category
// X ...") near the top of the page — reliable regardless of exact checkbox
// position, and unambiguous for anyone reviewing the saved PDF. Employee
// Signature + Date go on the existing "Employee Signature ... Date" line.
export async function fillJobExposurePdf({ employeeName, exposureCategory, signatureDataUrl, submittedAt }: JobExposureParams): Promise<Uint8Array> {
  return fillOverlayPdf({
    sourceFile: '07-job-exposure-classification.pdf',
    texts: [
      { page: 0, x: 72, y: 700, value: `Selected: ${exposureCategory}`, size: 11, bold: true },
      { page: 0, x: 260, y: 168, value: employeeName, size: 10 },
      { page: 0, x: 470, y: 168, value: submittedAt.toLocaleDateString('en-US'), size: 10 },
    ],
    signature: { page: 0, x: 260, y: 174, dataUrl: signatureDataUrl, maxWidth: 190, maxHeight: 30 },
  });
}

// Item 9 — Step 8, TMGNJ Confidentiality Agreement. Multi-page document;
// "including all agreement text" is satisfied by overlaying onto the actual
// source PDF (which already contains the full agreement body) rather than
// regenerating a summary — Name goes on the blank near the top of page 1,
// Signature + Date on the signature line at the end of the last page.
export async function fillTmgnjConfidentialityPdf({ employeeName, signatureDataUrl, submittedAt }: { employeeName: string; signatureDataUrl: string | null | undefined; submittedAt: Date }): Promise<Uint8Array> {
  const templateBytes = loadSourceBytes('08-tmgnj-confidentiality-agreement.pdf');
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const lastPageIndex = pages.length - 1;

  // Name field near the top of page 1 ("Employee Name: ____")
  pages[0].drawText(employeeName, { x: 190, y: pages[0].getHeight() - 300, size: 11, font });

  // Signature + Date on the last page's signature line
  const lastPage = pages[lastPageIndex];
  await drawSignatureImage(pdfDoc, lastPage, { page: lastPageIndex, x: 72, y: 100, dataUrl: signatureDataUrl, maxWidth: 190, maxHeight: 40 });
  lastPage.drawText(submittedAt.toLocaleDateString('en-US'), { x: 320, y: 108, size: 10, font });

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
