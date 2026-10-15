/**
 * Transactional email abstraction. Providers:
 *  - 'resend': real HTTP delivery via the Resend API (key from env, never hard-coded)
 *  - 'outbox': development/test transport that records mail in D1 mail_log
 * Production deployments must set EMAIL_PROVIDER=resend and RESEND_API_KEY.
 */

import { newId, nowIso } from '../lib/ids';
import { renderTemplate, type MailTemplateKey } from '../lib/mail-templates';

export type MailInput = {
  to: string;
  template: MailTemplateKey;
  locale: string;
  params: Record<string, string | number>;
};

export type MailResult = { status: 'sent' | 'failed' | 'outbox'; provider: string; error?: string };

export async function sendMail(env: EnvLike, input: MailInput): Promise<MailResult> {
  const provider = env.EMAIL_PROVIDER ?? 'outbox';
  const { subject, html, text } = renderTemplate(input.template, input.locale, input.params);

  if (provider === 'resend') {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
      await logMail(env, input, 'failed', 'resend', 'RESEND_API_KEY not configured');
      return { status: 'failed', provider: 'resend', error: 'provider_not_configured' };
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.RESEND_FROM,
          to: [input.to],
          subject,
          html,
          text,
        }),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        await logMail(env, input, 'failed', 'resend', detail);
        return { status: 'failed', provider: 'resend', error: detail };
      }
      await logMail(env, input, 'sent', 'resend', null);
      return { status: 'sent', provider: 'resend' };
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 200) : 'network_error';
      await logMail(env, input, 'failed', 'resend', detail);
      return { status: 'failed', provider: 'resend', error: detail };
    }
  }

  // Development/test outbox: stored, retrievable, never sent to the network.
  await logMail(env, input, 'outbox', 'outbox', null, { subject, text });
  return { status: 'outbox', provider: 'outbox' };
}

type EnvLike = {
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM: string;
  DB: D1Database;
};

async function logMail(
  env: EnvLike,
  input: MailInput,
  status: MailResult['status'],
  provider: string,
  error: string | null,
  extra?: { subject: string; text: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO mail_log (id, to_email, template, locale, provider, status, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('mail'), input.to, input.template, input.locale, provider, status, error, nowIso())
    .run()
    .catch(() => undefined);
  if (extra && status === 'outbox') {
    // Also surface in console for local development convenience.
    console.warn('[outbox]', input.to, extra.subject, '\n', extra.text);
  }
}
