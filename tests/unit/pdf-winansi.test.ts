/** PDF WinAnsi regression: every report string + hostile glyphs must render without throwing. */

import { describe, expect, it } from 'vitest';
import { buildReportPdf } from '../../src/server/services/pdf';
import { reportHeadings } from '../../src/server/lib/report-strings';
import { sanitizeForPdf } from '../../src/server/services/pdf-text';

describe('sanitizeForPdf', () => {
  it('maps arrows, dots, dashes, bullets to WinAnsi-safe text', () => {
    expect(sanitizeForPdf('a → b · c — d – e • f ✓')).toBe('a -> b - c - d - e - f x');
  });

  it('leaves Latin-1 (é, ü, è) intact', () => {
    expect(sanitizeForPdf('Séance réalisée — Übung')).toBe('Séance réalisée - Übung');
  });
});

describe('buildReportPdf with every report string', () => {
  for (const locale of ['en', 'nl', 'fr', 'de']) {
    it(`renders without WinAnsi throw (${locale})`, async () => {
      const h = reportHeadings(locale);
      const pdf = await buildReportPdf({
        title: h.title,
        subtitle: `${h.period} → test · range — with – dashes • bullets ✓`,
        meta: [
          { label: h.reportLanguage, value: locale.toUpperCase() },
          { label: h.notices, value: h.estimateNotice },
        ],
        sections: [
          { kind: 'heading', text: h.sessions },
          { kind: 'paragraph', text: h.noSessions },
          { kind: 'bullets', items: [h.noNutrition, h.noSafety, h.noAdaptations, h.appGuidanceApplied] },
          {
            kind: 'table',
            table: {
              title: h.sessions,
              columns: h.tableColumns,
              columnWidths: [0.14, 0.24, 0.08, 0.12, 0.12, 0.12, 0.12, 0.06],
              rows: [
                { cells: ['2026-10-01', 'Squat → depth · check', '1', '60 kg', '5', '60 kg', '5', 'completed'] },
              ],
            },
          },
        ],
      });
      expect(pdf.byteLength).toBeGreaterThan(500);
    });
  }
});
