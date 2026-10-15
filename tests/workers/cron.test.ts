/** Cron tests: reminder idempotency + 14-day cancellation with an explicit Stripe stub. */

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runScheduledCancellations } from '../../src/server/cron';
import { runDelinquencyReminders } from '../../src/server/cron-maintenance';
import type { StripeClient } from '../../src/server/services/stripe';

/** Explicit test stub — clearly separate from the production Stripe client. */
function stubStripe(status: string): StripeClient {
  return {
    createCustomer: async () => ({ id: 'cus_test', email: 'test@test.de' }),
    createCheckoutSession: async () => ({ id: 'cs_test', url: 'https://x' }),
    createPortalSession: async () => ({ id: 'ps_test', url: 'https://x' }),
    cancelSubscription: async (id: string) => ({
      id,
      customerId: 'cus_test',
      status: 'canceled',
      priceId: 'price_test',
      currency: 'eur',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      canceledAt: Math.floor(Date.now() / 1000),
      trialStart: null,
      trialEnd: null,
    }),
    getSubscription: async (id: string) => ({
      id,
      customerId: 'cus_test',
      status,
      priceId: 'price_test',
      currency: 'eur',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialStart: null,
      trialEnd: null,
    }),
    verifyWebhook: async () => ({ ok: false, reason: 'stub' }),
  };
}

async function seedUser(email: string): Promise<{ id: string; subStripeId: string }> {
  const id = `usr_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_normalized, status, locale, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 'en', ?, ?)`,
  )
    .bind(id, email, email.toLowerCase(), now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO entitlements (user_id, plan, status, source, updated_at)
     VALUES (?, 'premium', 'past_due', 'stripe_webhook', ?)`,
  )
    .bind(id, now)
    .run();
  const subStripeId = `sub_test_${id}`;
  await env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_customer_id, status,
       price_id, currency, cancel_at_period_end, created_at, updated_at)
     VALUES (?, ?, ?, 'cus_test', 'past_due', 'price_test', 'eur', 0, ?, ?)`,
  )
    .bind(`sub_${id}`, id, subStripeId, now, now)
    .run();
  return { id, subStripeId };
}

const testEnv = {
  DB: env.DB,
  APP_URL: 'http://localhost:5173',
  STRIPE_CURRENCY: 'eur',
  STRIPE_SECRET_KEY: undefined,
  EMAIL_PROVIDER: 'outbox',
  RESEND_FROM: 'Test <t@t.dev>',
} as never;

describe('delinquency reminders', () => {
  it('sends at most one reminder per user per day (idempotent reruns)', async () => {
    const { id: userId } = await seedUser('dunning@workers.test');
    const today = new Date().toISOString().slice(0, 10);

    await runDelinquencyReminders(testEnv);
    await runDelinquencyReminders(testEnv); // rerun must not duplicate

    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM billing_reminders
       WHERE user_id = ? AND reminder_date = ? AND channel = 'email' AND reason = 'payment_failed'`,
    )
      .bind(userId, today)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);

    const sent = await env.DB.prepare(
      `SELECT delivery_status FROM billing_reminders WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ delivery_status: string }>();
    expect(['sent', 'failed']).toContain(sent?.delivery_status);

    // In-app notification also created
    const notif = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'payment_failed'`,
    )
      .bind(userId)
      .first<{ n: number }>();
    expect(notif?.n ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe('14-day cancellation', () => {
  it('cancels past-due subscriptions after 14 days without deleting data', async () => {
    const { id: userId, subStripeId } = await seedUser('cancel@workers.test');
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO billing_cancellation_jobs (id, user_id, stripe_subscription_id,
         first_failed_at, scheduled_cancel_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(`dcj_${userId}`, userId, subStripeId, now, now, now)
      .run();

    await runScheduledCancellations(testEnv, stubStripe('past_due'));

    const job = await env.DB.prepare(
      `SELECT status FROM billing_cancellation_jobs WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ status: string }>();
    expect(job?.status).toBe('executed');

    const entitlement = await env.DB.prepare(
      `SELECT plan, status FROM entitlements WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ plan: string; status: string }>();
    expect(entitlement?.plan).toBe('free');
    expect(entitlement?.status).toBe('canceled');

    // Training data preserved: user + subscriptions rows intact
    const user = await env.DB.prepare(`SELECT status FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ status: string }>();
    expect(user?.status).toBe('active');
  });

  it('skips cancellation when Stripe reports the subscription active again', async () => {
    const { id: userId, subStripeId } = await seedUser('recovered@workers.test');
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO billing_cancellation_jobs (id, user_id, stripe_subscription_id,
         first_failed_at, scheduled_cancel_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(`dcj_${userId}`, userId, subStripeId, now, now, now)
      .run();

    await runScheduledCancellations(testEnv, stubStripe('active'));

    const job = await env.DB.prepare(
      `SELECT status FROM billing_cancellation_jobs WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ status: string }>();
    expect(job?.status).toBe('skipped');
  });
});
