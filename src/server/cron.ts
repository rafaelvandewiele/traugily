/**
 * Cron jobs — all idempotent (safe to re-run on retries):
 *  1. Failed-payment reminder cadence: daily email + in-app per user until paid.
 *  2. 14-day delinquency cancellation driven by recorded Stripe state.
 *  3-5. Report retries, R2 cleanup, session housekeeping (cron-maintenance.ts).
 */

import type { Env } from './env';
import { createStripeClient, type StripeClient } from './services/stripe';
import { sendMail } from './services/mail';
import { nowIso } from './lib/ids';
import { writeAudit } from './lib/audit';
import {
  runCleanup,
  runDelinquencyReminders,
  runReportRetries,
  runSessionHousekeeping,
} from './cron-maintenance';

export async function runScheduledJobs(env: Env, _ctx: ExecutionContext): Promise<void> {
  await Promise.allSettled([
    runDelinquencyReminders(env),
    runScheduledCancellations(env),
    runReportRetries(env),
    runCleanup(env),
    runSessionHousekeeping(env),
  ]);
}

/* -------------------- 14-day delinquency cancellation -------------------- */

export async function runScheduledCancellations(env: Env, client?: StripeClient): Promise<void> {
  const db = env.DB;
  const now = nowIso();
  const due = await db
    .prepare(
      `SELECT id, user_id, stripe_subscription_id FROM billing_cancellation_jobs
       WHERE status = 'pending' AND scheduled_cancel_at <= ?`,
    )
    .bind(now)
    .all<{ id: string; user_id: string; stripe_subscription_id: string }>();

  if (due.results.length === 0) return;
  const stripe = client ?? createStripeClient(env);

  for (const job of due.results) {
    // Re-check current Stripe state before cancelling — never act on stale local dates.
    let currentStatus: string;
    try {
      const sub = await stripe.getSubscription(job.stripe_subscription_id);
      currentStatus = sub.status;
      if (sub.status === 'active' || sub.status === 'trialing') {
        await db
          .prepare(`UPDATE billing_cancellation_jobs SET status = 'skipped' WHERE id = ?`)
          .bind(job.id)
          .run();
        continue;
      }
      if (sub.status !== 'canceled' && sub.status !== 'unpaid' && sub.status !== 'past_due') {
        await db
          .prepare(
            `UPDATE billing_cancellation_jobs SET status = 'canceled_by_stripe' WHERE id = ?`,
          )
          .bind(job.id)
          .run();
        continue;
      }
      await stripe.cancelSubscription(job.stripe_subscription_id);
    } catch (err) {
      console.error('[cron] cancellation failed', job.id, err);
      continue;
    }

    await db.batch([
      db
        .prepare(
          `UPDATE billing_cancellation_jobs SET executed_at = ?, status = 'executed' WHERE id = ?`,
        )
        .bind(nowIso(), job.id),
      db
        .prepare(
          `UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ?
         WHERE stripe_subscription_id = ?`,
        )
        .bind(now, now, job.stripe_subscription_id),
      db
        .prepare(
          `UPDATE entitlements SET plan = 'free', status = 'canceled', valid_until = NULL,
           source = 'delinquency_cancel', updated_at = ? WHERE user_id = ?`,
        )
        .bind(now, job.user_id),
    ]);

    const user = await db
      .prepare(`SELECT email, locale FROM users WHERE id = ?`)
      .bind(job.user_id)
      .first<{ email: string; locale: string }>();
    if (user) {
      await sendMail(env, {
        to: user.email,
        template: 'subscription_canceled',
        locale: user.locale,
        params: { appUrl: env.APP_URL },
      });
    }

    // Data preserved: only entitlement ends; export and deletion remain available.
    await writeAudit(db, {
      actor: { userId: null, role: 'system' },
      action: 'subscription_auto_canceled',
      targetType: 'user',
      targetId: job.user_id,
      afterState: { stripeStatus: currentStatus, reason: '14_day_delinquency' },
    });
  }
}
