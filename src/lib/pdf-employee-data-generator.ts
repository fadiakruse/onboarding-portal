import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';

// Dedicated single-page, multi-column layout for the Employee Data Form
// (Step 1) — the generic generateFormPdf() in pdf-generator.ts stacks every
// field in one column, which pushed this particular form onto 2 pages. This
// groups related fields onto shared rows (2-3 columns) instead, matching the
// same visual density as a typical printed HR intake form.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

interface GenerateEmployeeDataPdfOptions {
  answers: Record<string, any>;
  employeeName: string;
  signatureDataUrl: string;
  practiceName: string;
  submittedAt: Date;
}

interface Cell {
  label: string;
  value: string;
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

export async function generateEmployeeDataPdf(opts: GenerateEmployeeDataPdfOptions): Promise<Uint8Array> {
  const { answers, employeeName, signatureDataUrl, practiceName, submittedAt } = opts;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  let y = PAGE_HEIGHT - PAGE_MARGIN;

  // Header
  page.drawText(practiceName, { x: PAGE_MARGIN, y, size: 9, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
  y -= 18;
  page.drawText('Employee Data Form', { x: PAGE_MARGIN, y, size: 14, font: boldFont });
  y -= 8;
  page.drawLine({ start: { x: PAGE_MARGIN, y }, end: { x: PAGE_WIDTH - PAGE_MARGIN, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 16;

  const val = (id: string): string => {
    const v = answers[id];
    if (v === undefined || v === null || v === '') return '—';
    return String(v);
  };

  const labelSize = 7.5;
  const valueSize = 10;
  const labelColor = rgb(0.4, 0.4, 0.4);

  // Draws one row of 1-3 cells sharing the row's width evenly (minus gaps),
  // each with a small caps label above the value, and advances `y` past the
  // tallest cell in the row (accounting for value text wrapping).
  function drawRow(cells: Cell[], gap = 14) {
    const n = cells.length;
    const colWidth = (CONTENT_WIDTH - gap * (n - 1)) / n;
    let x = PAGE_MARGIN;
    let maxLines = 1;
    const wrappedPerCell: string[][] = [];

    cells.forEach((cell) => {
      const lines = wrapText(cell.value, font, valueSize, colWidth);
      wrappedPerCell.push(lines);
      maxLines = Math.max(maxLines, lines.length);
    });

    cells.forEach((cell, i) => {
      page.drawText(cell.label.toUpperCase(), { x, y, size: labelSize, font: boldFont, color: labelColor });
      let vy = y - 11;
      wrappedPerCell[i].forEach((line) => {
        page.drawText(line, { x, y: vy, size: valueSize, font });
        vy -= 12;
      });
      x += colWidth + gap;
    });

    y -= 11 + maxLines * 12 + 9;
  }

  // Row 1: First / Last name
  drawRow([
    { label: 'First Name', value: val('firstName') },
    { label: 'Last Name', value: val('lastName') },
  ]);

  // Row 2: SSN / DOB
  drawRow([
    { label: 'Social Security Number', value: val('ssn') },
    { label: 'Date of Birth', value: val('dob') },
  ]);

  // Row 3: Address — full width since it can run long
  drawRow([{ label: 'Home Address', value: val('address') }], 0);

  // Row 4: Cell phone / email
  drawRow([
    { label: 'Cell Phone', value: val('cell') },
    { label: 'Email Address', value: val('email') },
  ]);

  // Row 5: All emergency contact info on one row, as requested
  drawRow(
    [
      { label: 'Emergency Contact Name', value: val('emergencyContactName') },
      { label: 'Emergency Contact Phone', value: val('emergencyContactPhone') },
      { label: 'Relationship', value: val('emergencyContactRelationship') },
    ],
    12
  );

  // Row 6: Hire type / position (adds a 3rd column for "Position (specified)"
  // only when the employee picked "Other" and typed one in)
  const positionOther = answers.positionOther ? String(answers.positionOther) : '';
  if (positionOther) {
    drawRow(
      [
        { label: 'Hire Type', value: val('hireType') },
        { label: 'Position', value: val('position') },
        { label: 'Position (specified)', value: positionOther },
      ],
      12
    );
  } else {
    drawRow([
      { label: 'Hire Type', value: val('hireType') },
      { label: 'Position', value: val('position') },
    ]);
  }

  // Row 7: Start date / employment type
  drawRow([
    { label: 'Start Date', value: val('startDate') },
    { label: 'Employment Type', value: val('employmentType') },
  ]);

  // Row 8: Salary rate / basis
  drawRow([
    { label: 'Salary Rate ($)', value: val('salaryRate') },
    { label: 'Salary Basis', value: val('salaryBasis') },
  ]);

  // Row 9: Special conditions — only rendered if the employee filled it in
  const specialConditions = answers.specialConditions ? String(answers.specialConditions) : '';
  if (specialConditions) {
    drawRow([{ label: 'Special Conditions of Employment', value: specialConditions }], 0);
  }

  // Short at-will/no-agreement disclaimer, same substance as the on-screen
  // intro text, kept brief here to preserve room for the signature block.
  y -= 6;
  const disclaimer =
    'This Employee Data Form does not constitute, imply, or create either an employment agreement or any terms of employment. All employment is considered "at will."';
  wrapText(disclaimer, font, 8.5, CONTENT_WIDTH).forEach((line) => {
    page.drawText(line, { x: PAGE_MARGIN, y, size: 8.5, font, color: rgb(0.45, 0.45, 0.45) });
    y -= 11;
  });

  // Signature block
  y -= 14;
  page.drawLine({ start: { x: PAGE_MARGIN, y }, end: { x: PAGE_WIDTH - PAGE_MARGIN, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 18;

  page.drawText('Employee Signature', { x: PAGE_MARGIN, y, size: 8.5, font: boldFont, color: rgb(0.35, 0.35, 0.35) });
  y -= 6;

  if (signatureDataUrl?.startsWith('data:image/png')) {
    const base64 = signatureDataUrl.split(',')[1];
    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
    const sigImage = await pdfDoc.embedPng(bytes);
    const maxSigWidth = 200;
    const maxSigHeight = 55;
    const scale = Math.min(maxSigWidth / sigImage.width, maxSigHeight / sigImage.height, 1);
    const w = sigImage.width * scale;
    const h = sigImage.height * scale;
    page.drawImage(sigImage, { x: PAGE_MARGIN, y: y - h, width: w, height: h });
    y -= h + 6;
  } else {
    y -= 30;
  }

  page.drawLine({ start: { x: PAGE_MARGIN, y }, end: { x: PAGE_MARGIN + 200, y }, thickness: 0.75, color: rgb(0.5, 0.5, 0.5) });
  y -= 14;

  page.drawText(`Signed by: ${employeeName}`, { x: PAGE_MARGIN, y, size: 9.5, font });
  y -= 13;
  page.drawText(`Date: ${submittedAt.toLocaleDateString('en-US')}`, { x: PAGE_MARGIN, y, size: 9.5, font });

  return pdfDoc.save();
}
