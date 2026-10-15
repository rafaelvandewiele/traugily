/** PDF layout primitives: text wrapping, footers, and tables with repeated headings. */

import type { PDFFont, PDFPage } from 'pdf-lib';
import { rgb } from 'pdf-lib';

export const BODY_SIZE = 9;
export const HEAD_SIZE = 13;
export const TITLE_SIZE = 20;
export const MARGIN = 48;
export const PAGE_A4: [number, number] = [595.28, 841.89];
export const TEAL = rgb(0.075, 0.463, 0.431);
export const DARK = rgb(0.11, 0.18, 0.17);
export const MUTED = rgb(0.36, 0.45, 0.43);
export const LIGHT = rgb(0.9, 0.95, 0.94);

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function drawFooter(page: PDFPage, font: PDFFont): void {
  page.drawText('Traugily · estimates are labelled · see report notes', {
    x: MARGIN,
    y: 26,
    size: 7,
    font,
    color: MUTED,
  });
}

export type ReportRow = { cells: string[]; header?: boolean };
export type ReportTable = {
  title: string;
  columns: string[];
  columnWidths: number[];
  rows: ReportRow[];
};

export type TableCtx = {
  getY: () => number;
  setY: (v: number) => void;
  font: PDFFont;
  fontBold: PDFFont;
  width: number;
  getPage: () => PDFPage;
  footer: (p: PDFPage) => void;
  newPage: () => void;
};

export function drawTable(table: ReportTable, ctx: TableCtx): void {
  const { font, fontBold, width } = ctx;
  const pad = 4;
  const rowH = BODY_SIZE + pad + 3;

  const drawRow = (cells: string[], isHeader: boolean, shade: boolean): void => {
    let cx = MARGIN;
    const wrapped = cells.map((cell, i) => {
      const colW = (table.columnWidths[i] ?? 1 / cells.length) * width - pad * 2;
      return wrap(cell ?? '', isHeader ? fontBold : font, BODY_SIZE, Math.max(20, colW));
    });
    const rowHeight = Math.max(
      rowH,
      Math.max(...wrapped.map((w) => w.length)) * (BODY_SIZE + 2) + pad * 2,
    );

    if (ctx.getY() - rowHeight < MARGIN + 30) {
      ctx.footer(ctx.getPage());
      ctx.newPage();
      drawRow(table.columns, true, false);
    }

    const page = ctx.getPage();
    const topY = ctx.getY();
    if (shade) {
      page.drawRectangle({
        x: MARGIN,
        y: topY - rowHeight + 2,
        width,
        height: rowHeight,
        color: LIGHT,
      });
    }
    wrapped.forEach((lines, i) => {
      lines.forEach((line, li) => {
        page.drawText(line, {
          x: cx + pad,
          y: topY - BODY_SIZE - li * (BODY_SIZE + 2),
          size: BODY_SIZE,
          font: isHeader ? fontBold : font,
          color: isHeader ? TEAL : DARK,
        });
      });
      cx += (table.columnWidths[i] ?? 1 / cells.length) * width;
    });
    ctx.setY(topY - rowHeight);
    ctx.getPage().drawLine({
      start: { x: MARGIN, y: ctx.getY() + 2 },
      end: { x: MARGIN + width, y: ctx.getY() + 2 },
      thickness: 0.5,
      color: MUTED,
    });
    ctx.setY(ctx.getY() - 4);
  };

  drawRow(table.columns, true, false);
  table.rows.forEach((row, i) => drawRow(row.cells, false, i % 2 === 1));
  ctx.setY(ctx.getY() - 8);
}
