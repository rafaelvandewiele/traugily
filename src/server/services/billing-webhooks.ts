/** Verified webhook event application: entitlements only change from Stripe state. */

import type { Env } from '../env';
import { entitlementFromStripe, epochToIso, mapSubscription } from './stripe';
import type { MailInput } from './mail';
import { newId, nowIso } from '../lib/ids';
import { writeAudit } from '../lib/audit';

export type WebhookOutcome = {
  status: 'processed' | 'ignored';
  mail?: MailInput;
};

export async function applyWebhookEvent(
  env: Env,
  event: { id: string; type: string; data: { object: Record<string, unknown> } },
): Promise<WebhookOutcome> {
  const db = env.DB;
  const obj = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const customerId = String(obj.customer ?? '');
      const subscriptionId = String(obj.subscription ?? '');
      const customerRow = await db
        .prepare(`SELECT user_id FROM stripe_customers WHERE stripe_customer_id = ?`)
        .bind(customerId)
        .first<{ user_id: string }>();
      if (!customerRow || !subscriptionId) return { status: 'ignored' };
      await upsertSubscriptionFromStripe(env, customerRow.user_id, subscriptionId);
      return { status: 'processed' };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const snapshot = mapSubscription(obj);
      const customerRow = await db
        .prepare(`SELECT user_id FROM stripe_customers WHERE stripe_customer_id = ?`)
        .bind(snapshot.customerId)
        .first<{ user_id: string }>();
      if (!customerRow) return { status: 'ignored' };
      await persistSubscription(env, customerRow.user_id, snapshot);
      const mail = await maybePaymentMail(env, customerRow.user_id, event.type, snapshot);
      return { status: 'processed', mail };
    }

    case 'invoice.paid':
    case 'invoice.payment_failed':
      return applyInvoiceEvent(env, event, obj);

    default:
      return { status: 'ignored' };
  }
}

async function applyInvoiceEvent(
  env: Env,
  event: { id: string; type: string },
  obj: Record<string, unknown>,
): Promise<WebhookOutcome> {
  const db = env.DB;
  const invoiceId = String(obj.id ?? '');
  const customerId = String(obj.customer ?? '');
  const customerRow = await db
    .prepare(`SELECT user_id FROM stripe_customers WHERE stripe_customer_id = ?`)
    .bind(customerId)
    .first<{ user_id: string }>();
  if (!customerRow) return { status: 'ignored' };
  const userId = customerRow.user_id;

  await db
    .prepare(
      `INSERT INTO billing_invoices (id, user_id, stripe_invoice_id, stripe_subscription_id,
         amount_due, amount_paid, currency, status, hosted_invoice_url, invoice_pdf_url,
         due_date, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(stripe_invoice_id) DO UPDATE SET
         amount_due = excluded.amount_due, amount_paid = excluded.amount_paid,
         status = excluded.status, hosted_invoice_url = excluded.hosted_invoice_url,
         invoice_pdf_url = excluded.invoice_pdf_url, paid_at = excluded.paid_at`,
    )
    .bind(
      newId('inv'),
      userId,
      invoiceId,
      obj.subscription ? String(obj.subscription) : null,
      Number(obj.amount_due ?? 0),
      Number(obj.amount_paid ?? 0),
      String(obj.currency ?? ''),
      String(obj.status ?? ''),
      obj.hosted_invoice_url ? String(obj.hosted_invoice_url) : null,
      obj.invoice_pdf ? String(obj.invoice_pdf) : null,
      epochToIso(numOrNull(obj.due_date)),
      epochToIso(
        numOrNull((obj.status_transitions as Record<string, unknown> | undefined)?.paid_at),
      ),
      nowIso(),
    )
    .run();

  const user = await db
    .prepare(`SELECT email, locale FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ email: string; locale: string }>();
  const amount = (Number(obj.amount_due ?? 0) / 100).toFixed(2);
  const currency = String(obj.currency ?? '').toUpperCase();

  if (event.type === 'invoice.paid') {
    await db
      .prepare(
        `UPDATE entitlements SET plan = 'premium', status = 'active', valid_until = NULL,
           source = 'stripe_webhook', updated_at = ? WHERE user_id = ?`,
      )
      .bind(nowIso(), userId)
      .run();
    await clearDelinquencyJobs(env, userId);
    if (user) {
      return {
        status: 'processed',
        mail: {
          to: user.email,
          template: 'payment_success',
          locale: user.locale,
          params: { amount, currency, invoiceUrl: String(obj.hosted_invoice_url ?? '') },
        },
      };
    }
    return { status: 'processed' };
  }

  if (user) {
    return {
      status: 'processed',
      mail: {
        to: user.email,
        template: 'payment_failed',
        locale: user.locale,
        params: { amount, currency, portalUrl: `${env.APP_URL}/account/billing` },
      },
    };
  }
  return { status: 'processed' };
}

async function upsertSubscriptionFromStripe(
  env: Env,
  userId: string,
  subscriptionId: string,
): Promise<void> {
  // Checkout only carries the id; fetch authoritative state from Stripe (server-side key).
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY ?? ''}` },
    });
    if (!res.ok) return;
    const raw = (await res.json()) as Record<string, unknown>;
    await persistSubscription(env, userId, mapSubscription(raw));
  } catch (err) {
    console.error('[billing] subscription fetch failed', subscriptionId, err);
  }
}

async function persistSubscription(
  env: Env,
  userId: string,
  snapshot: ReturnType<typeof mapSubscription>,
): Promise<void> {
  const db = env.DB;
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_customer_id, status,
         price_id, currency, current_period_start, current_period_end, cancel_at_period_end,
         canceled_at, trial_start, trial_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(stripe_subscription_id) DO UPDATE SET
         status = excluded.status, price_id = excluded.price_id, currency = excluded.currency,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at,
         trial_end = excluded.trial_end, updated_at = excluded.updated_at`,
    )
    .bind(
      newId('sub'),
      userId,
      snapshot.id,
      snapshot.customerId,
      snapshot.status,
      snapshot.priceId,
      snapshot.currency,
      epochToIso(snapshot.currentPeriodStart),
      epochToIso(snapshot.currentPeriodEnd),
      snapshot.cancelAtPeriodEnd ? 1 : 0,
      epochToIso(snapshot.canceledAt),
      epochToIso(snapshot.trialStart),
      epochToIso(snapshot.trialEnd),
      now,
      now,
    )
    .run();

  const entitlement = entitlementFromStripe(snapshot.status, epochToIso(snapshot.trialEnd));
  const validUntil = snapshot.currentPeriodEnd
    ? epochToIso(snapshot.currentPeriodEnd)
    : entitlement.validUntil;
  await db
    .prepare(
      `INSERT INTO entitlements (user_id, plan, status, valid_until, source, updated_at)
       VALUES (?, ?, ?, ?, 'stripe_webhook', ?)
       ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = excluded.status,
         valid_until = excluded.valid_until, source = excluded.source, updated_at = excluded.updated_at`,
    )
    .bind(userId, entitlement.plan, entitlement.status, validUntil, now)
    .run();

  await writeAudit(db, {
    actor: { userId: null, role: 'system' },
    action: 'entitlement_updated',
    targetType: 'user',
    targetId: userId,
    afterState: {
      plan: entitlement.plan,
      status: entitlement.status,
      stripeStatus: snapshot.status,
    },
  });

  // Schedule 14-day delinquency cancellation when Stripe reports past_due/unpaid.
  if (snapshot.status === 'past_due' || snapshot.status === 'unpaid') {
    const existing = await db
      .prepare(
        `SELECT first_failed_at FROM billing_cancellation_jobs
         WHERE user_id = ? AND stripe_subscription_id = ? AND status = 'pending'`,
      )
      .bind(userId, snapshot.id)
      .first<{ first_failed_at: string }>();
    if (!existing) {
      const setting = await db
        .prepare(`SELECT value FROM product_settings WHERE key = 'delinquency_cancel_days'`)
        .first<{ value: string }>();
      const days = Number(setting?.value ?? '14');
      await db
        .prepare(
          `INSERT INTO billing_cancellation_jobs (id, user_id, stripe_subscription_id,
             first_failed_at, scheduled_cancel_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .bind(
          newId('dcj'),
          userId,
          snapshot.id,
          now,
          new Date(Date.now() + days * 86_400_000).toISOString(),
          now,
        )
        .run();
    }
  }
}

async function maybePaymentMail(
  env: Env,
  userId: string,
  eventType: string,
  snapshot: ReturnType<typeof mapSubscription>,
): Promise<MailInput | undefined> {
  const user = await env.DB.prepare(`SELECT email, locale FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ email: string; locale: string }>();
  if (!user) return undefined;
  if (snapshot.status === 'canceled' && eventType === 'customer.subscription.deleted') {
    return {
      to: user.email,
      template: 'subscription_canceled',
      locale: user.locale,
      params: { appUrl: env.APP_URL },
    };
  }
  return undefined;
}

async function clearDelinquencyJobs(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE billing_cancellation_jobs SET status = 'skipped'
     WHERE user_id = ? AND status = 'pending'`,
  )
    .bind(userId)
    .run();
  await env.DB.prepare(
    `UPDATE billing_reminders SET delivery_status = 'skipped'
     WHERE user_id = ? AND delivery_status = 'pending'`,
  )
    .bind(userId)
    .run();
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
