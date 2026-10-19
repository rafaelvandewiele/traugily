/** A4 report assembly on top of pdf-layout primitives (pdf-lib, Workers-compatible). */

import { PDFDocument, StandardFonts, type PDFPage, type RGB } from 'pdf-lib';
import {
  BODY_SIZE,
  DARK,
  HEAD_SIZE,
  MARGIN,
  MUTED,
  PAGE_A4,
  TEAL,
  TITLE_SIZE,
  drawFooter,
  drawTable,
  wrap,
  type ReportTable,
} from './pdf-layout';
import { sanitizeForPdf } from './pdf-text';

export type ReportSection =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'table'; table: ReportTable };

export type ReportInput = {
  title: string;
  subtitle: string;
  meta: Array<{ label: string; value: string }>;
  sections: ReportSection[];
};

export async function buildReportPdf(input: ReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitizeForPdf(input.title));
  doc.setCreator('Traugily');
  doc.setProducer('Traugily report service');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const width = PAGE_A4[0] - MARGIN * 2;
  let page: PDFPage = doc.addPage(PAGE_A4);
  let y = PAGE_A4[1] - MARGIN;

  const ensureSpace = (needed: number): void => {
    if (y - needed < MARGIN + 30) {
      drawFooter(page, font);
      page = doc.addPage(PAGE_A4);
      y = PAGE_A4[1] - MARGIN;
    }
  };

  const drawLine = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: RGB; maxWidth?: number } = {},
  ): void => {
    const size = opts.size ?? BODY_SIZE;
    const f = opts.bold ? fontBold : font;
    const color = opts.color ?? DARK;
    const maxWidth = opts.maxWidth ?? width;
    for (const line of wrap(sanitizeForPdf(text), f, size, maxWidth)) {
      ensureSpace(size + 3);
      page.drawText(line, { x: MARGIN, y, size, font: f, color });
      y -= size + 3;
    }
  };

  page.drawText(sanitizeForPdf(input.title), { x: MARGIN, y, size: TITLE_SIZE, font: fontBold, color: TEAL });
  y -= TITLE_SIZE + 6;
  drawLine(input.subtitle, { size: BODY_SIZE + 1, color: MUTED });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + width, y },
    thickness: 1,
    color: TEAL,
  });
  y -= 14;

  for (const item of input.meta) {
    ensureSpace(14);
    const safeLabel = sanitizeForPdf(item.label);
    const safeValue = sanitizeForPdf(item.value);
    page.drawText(`${safeLabel}:`, { x: MARGIN, y, size: BODY_SIZE, font: fontBold, color: DARK });
    const labelW = fontBold.widthOfTextAtSize(`${safeLabel}:`, BODY_SIZE);
    page.drawText(safeValue, {
      x: MARGIN + labelW + 6,
      y,
      size: BODY_SIZE,
      font,
      color: MUTED,
    });
    y -= 13;
  }
  y -= 8;

  for (const section of input.sections) {
    if (section.kind === 'heading') {
      ensureSpace(HEAD_SIZE + 16);
      y -= 6;
      drawLine(section.text, { size: HEAD_SIZE, bold: true, color: TEAL });
      y -= 3;
    } else if (section.kind === 'paragraph') {
      drawLine(section.text, { color: DARK });
      y -= 6;
    } else if (section.kind === 'bullets') {
      for (const item of section.items) {
        drawLine(`• ${item}`, { maxWidth: width - 12 });
        y -= 2;
      }
      y -= 4;
    } else if (section.kind === 'table') {
      drawTable(section.table, {
        getY: () => y,
        setY: (v) => {
          y = v;
        },
        font,
        fontBold,
        width,
        getPage: () => page,
        footer: (p) => drawFooter(p, font),
        newPage: () => {
          page = doc.addPage(PAGE_A4);
          y = PAGE_A4[1] - MARGIN;
        },
      });
    }
  }

  drawFooter(page, font);
  return doc.save();
}

// Re-export for convenience in tests
export type { ReportTable };
export { TEAL, MUTED };
