/** Billing: Checkout, Customer Portal, entitlement status (webhooks live in billing-webhook.ts). */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { badRequest, unauthorized } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { createStripeClient, type StripeClient } from '../services/stripe';

export const billingRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function stripe(env: Env): StripeClient {
  return createStripeClient(env);
}

billingRoutes.get('/status', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const [entitlement, sub, customer, invoices] = await Promise.all([
    c.env.DB.prepare(
      `SELECT plan, status, valid_until, updated_at FROM entitlements WHERE user_id = ?`,
    )
      .bind(auth.user.id)
      .first(),
    c.env.DB.prepare(
      `SELECT stripe_subscription_id, status, price_id, currency, current_period_end,
              cancel_at_period_end, canceled_at, trial_end
       FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(auth.user.id)
      .first<{
        stripe_subscription_id: string;
        status: string;
        price_id: string;
        currency: string;
        current_period_end: string | null;
        cancel_at_period_end: number;
        canceled_at: string | null;
        trial_end: string | null;
      }>(),
    c.env.DB.prepare(`SELECT stripe_customer_id FROM stripe_customers WHERE user_id = ?`)
      .bind(auth.user.id)
      .first<{ stripe_customer_id: string }>(),
    c.env.DB.prepare(
      `SELECT stripe_invoice_id, amount_due, amount_paid, currency, status, hosted_invoice_url,
              due_date, paid_at, created_at
       FROM billing_invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 12`,
    )
      .bind(auth.user.id)
      .all(),
  ]);

  return c.json({
    entitlement,
    subscription: sub
      ? {
          status: sub.status,
          priceId: sub.price_id,
          currency: sub.currency,
          nextBillAt: sub.current_period_end,
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          canceledAt: sub.canceled_at,
          trialEnd: sub.trial_end,
        }
      : null,
    hasCustomer: !!customer,
    invoices: invoices.results,
    currency: c.env.STRIPE_CURRENCY,
    interval: 'month',
    priceNote: 'Localized price and tax are shown by Stripe at checkout.',
    trialDays: Number(c.env.STRIPE_TRIAL_DAYS ?? 0),
    portalAvailable: !!customer,
  });
});

billingRoutes.post('/checkout', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  if (!c.env.STRIPE_SECRET_KEY || c.env.STRIPE_PRICE_ID.includes('placeholder')) {
    throw badRequest('Payments are not configured in this environment yet. See DEPLOYMENT.md.');
  }
  const db = c.env.DB;
  let customer = await db
    .prepare(`SELECT stripe_customer_id FROM stripe_customers WHERE user_id = ?`)
    .bind(auth.user.id)
    .first<{ stripe_customer_id: string }>();
  if (!customer) {
    const created = await stripe(c.env).createCustomer(auth.user.email, auth.user.id);
    await db
      .prepare(
        `INSERT INTO stripe_customers (user_id, stripe_customer_id, email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(auth.user.id, created.id, auth.user.email, nowIso(), nowIso())
      .run();
    customer = { stripe_customer_id: created.id };
  }

  const session = await stripe(c.env).createCheckoutSession({
    customerId: customer.stripe_customer_id,
    priceId: c.env.STRIPE_PRICE_ID,
    currency: c.env.STRIPE_CURRENCY,
    trialDays: Number(c.env.STRIPE_TRIAL_DAYS ?? 0),
    successUrl: `${c.env.APP_URL}/account/billing?checkout=success`,
    cancelUrl: `${c.env.APP_URL}/account/billing?checkout=cancelled`,
  });
  return c.json({ url: session.url });
});

billingRoutes.post('/portal', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const customer = await c.env.DB.prepare(
    `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .first<{ stripe_customer_id: string }>();
  if (!customer) throw badRequest('No billing account yet. Subscribe first.');
  const session = await stripe(c.env).createPortalSession(
    customer.stripe_customer_id,
    `${c.env.APP_URL}/account/billing`,
  );
  return c.json({ url: session.url });
});
