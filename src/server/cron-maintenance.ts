/** Idempotent maintenance jobs: payment reminders, report retries, cleanup, sessions. */

import type { Env } from './env';
import { sendMail } from './services/mail';
import { newId, nowIso } from './lib/ids';
import { generateReportPdf } from './services/report-service';

/* ---------- Failed-payment reminder cadence (daily, idempotent) ---------- */

export async function runDelinquencyReminders(env: Env): Promise<void> {
  const db = env.DB;
  const today = new Date().toISOString().slice(0, 10);

  const pastDue = await db
    .prepare(
      `SELECT s.user_id, s.status, u.email, u.locale
       FROM subscriptions s JOIN users u ON u.id = s.user_id
       WHERE s.status IN ('past_due','unpaid') AND u.status = 'active'`,
    )
    .all<{ user_id: string; status: string; email: string; locale: string }>();

  for (const sub of pastDue.results) {
    // Idempotent: UNIQUE(user_id, reminder_date, channel, reason) prevents duplicates.
    const existing = await db
      .prepare(
        `SELECT id FROM billing_reminders
         WHERE user_id = ? AND reminder_date = ? AND channel = 'email' AND reason = 'payment_failed'`,
      )
      .bind(sub.user_id, today)
      .first<{ id: string }>();
    if (existing) continue;

    const invoice = await db
      .prepare(
        `SELECT amount_due, currency FROM billing_invoices
         WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(sub.user_id)
      .first<{ amount_due: number; currency: string }>();

    const reminderId = newId('brm');
    await db
      .prepare(
        `INSERT INTO billing_reminders (id, user_id, reminder_date, channel, reason, delivery_status, created_at)
         VALUES (?, ?, ?, 'email', 'payment_failed', 'pending', ?)`,
      )
      .bind(reminderId, sub.user_id, today, nowIso())
      .run();

    const result = await sendMail(env, {
      to: sub.email,
      template: 'payment_failed',
      locale: sub.locale,
      params: {
        amount: ((invoice?.amount_due ?? 0) / 100).toFixed(2),
        currency: (invoice?.currency ?? env.STRIPE_CURRENCY).toUpperCase(),
        portalUrl: `${env.APP_URL}/account/billing`,
      },
    });

    await db
      .prepare(`UPDATE billing_reminders SET delivery_status = ? WHERE id = ?`)
      .bind(result.status === 'failed' ? 'failed' : 'sent', reminderId)
      .run();

    // In-app reminder (push requires explicit consent + a push subscription; never silent).
    await db
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, title_key, body_key, params, created_at)
         VALUES (?, ?, 'payment_failed', 'notification.payment_failed.title',
                 'notification.payment_failed.body', ?, ?)`,
      )
      .bind(newId('ntf'), sub.user_id, JSON.stringify({ date: today }), nowIso())
      .run();
  }
}

/* ------------------------ Report export retries ------------------------ */

export async function runReportRetries(env: Env): Promise<void> {
  const stuck = await env.DB.prepare(
    `SELECT id, user_id, period_start, period_end, detail_level, report_locale
       FROM report_exports
       WHERE status IN ('pending','processing') AND attempts < 3
         AND created_at < datetime('now', '-2 minutes')
       ORDER BY created_at LIMIT 5`,
  ).all<{
    id: string;
    user_id: string;
    period_start: string;
    period_end: string;
    detail_level: 'summary' | 'standard' | 'detailed';
    report_locale: string;
  }>();

  for (const row of stuck.results) {
    await generateReportPdf(env, row.id, row.user_id, {
      periodStart: row.period_start,
      periodEnd: row.period_end,
      detailLevel: row.detail_level,
      reportLocale: row.report_locale,
    }).catch(() => undefined); // service already marks the record failed on error
  }
}

/* --------------------------- Cleanup jobs --------------------------- */

export async function runCleanup(env: Env): Promise<void> {
  const db = env.DB;
  await db
    .prepare(`DELETE FROM verification_tokens WHERE expires_at < datetime('now', '-1 day')`)
    .run();
  await db.prepare(`DELETE FROM oauth_states WHERE expires_at < datetime('now')`).run();
  await db.prepare(`DELETE FROM rate_limit_counters WHERE expires_at < datetime('now')`).run();

  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const stale = await db
    .prepare(
      `SELECT object_key FROM r2_objects
       WHERE purpose = 'report_pdf' AND created_at < ? AND deleted_at IS NULL LIMIT 20`,
    )
    .bind(cutoff)
    .all<{ object_key: string }>();
  for (const row of stale.results) {
    await env.MEDIA.delete(row.object_key);
    await db
      .prepare(
        `UPDATE r2_objects SET deleted_at = ? WHERE object_key = ?;
         UPDATE report_exports SET object_key = NULL WHERE object_key = ?`,
      )
      .bind(nowIso(), row.object_key, row.object_key)
      .run();
  }
}

export async function runSessionHousekeeping(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
}
