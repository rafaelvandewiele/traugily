/** Localized email rendering with English fallback when a translation is missing. */

import type { MailTemplateKey, TemplateStrings } from './mail-strings-en';
import { mailStringsEn } from './mail-strings-en';
import { mailStringsDe, mailStringsFr, mailStringsNl } from './mail-strings-locales';

export type { MailTemplateKey, TemplateStrings };

const STRINGS: Record<string, TemplateStrings> = {
  en: mailStringsEn,
  nl: mailStringsNl,
  fr: mailStringsFr,
  de: mailStringsDe,
};

export function renderTemplate(
  key: MailTemplateKey,
  locale: string,
  params: Record<string, string | number>,
): { subject: string; html: string; text: string } {
  const table = STRINGS[locale] ?? mailStringsEn;
  const entry = table[key] ?? mailStringsEn[key];
  const fill = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(params[name] ?? ''));
  const text = fill(entry.body);
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.55;color:#134e4a">
<p style="font-size:20px;font-weight:600;margin:0 0 12px">Traugily</p>
<p style="white-space:pre-wrap;margin:0">${escapeHtml(text)}</p>
<p style="margin:24px 0 0;font-size:12px;color:#5b7c77">Traugily · steady progress, made simple</p>
</div>`;
  return { subject: fill(entry.subject), html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
