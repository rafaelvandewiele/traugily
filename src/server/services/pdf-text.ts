/** WinAnsi-safe text for pdf-lib standard fonts (Helvetica encodes WinAnsi/CP1252 only). */

const WINANSI_REPLACEMENTS: Array<[RegExp, string]> = [
  [/[→➔⇒↦]/g, '->'],
  [/[←⇐]/g, '<-'],
  [/[·•●▪]/g, '-'],
  [/[—–―]/g, '-'],
  [/[✓✔]/g, 'x'],
  [/[✗✘]/g, 'x'],
  [/[’‘‚]/g, "'"],
  [/[“”„]/g, '"'],
  [/[…]/g, '...'],
  [/[≈]/g, '~'],
  [/[×]/g, 'x'],
];

/** Map arrows, bullets, dashes, curly quotes etc. to WinAnsi-safe equivalents. */
export function sanitizeForPdf(text: string): string {
  let out = text;
  for (const [re, replacement] of WINANSI_REPLACEMENTS) out = out.replace(re, replacement);
  // Last resort: anything still outside WinAnsi printable range becomes '?'.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  return out;
}
