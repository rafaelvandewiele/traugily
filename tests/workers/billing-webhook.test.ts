/** Integration tests: Stripe webhook signature verification + idempotency (scenario #7). */

import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signupAndCookies } from './helpers';

const WEBHOOK_SECRET = 'whsec_test_secret'; // matches the test-only binding in vitest.workers.config.ts

async function sign(payload: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${ts},v1=${hex}`;
}

async function seedCustomer(email: string): Promise<string> {
  await signupAndCookies(email);
  const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO stripe_customers (user_id, stripe_customer_id, email, created_at, updated_at)
     VALUES (?, 'cus_wh_test', ?, ?, ?)`,
  )
    .bind(user!.id, email, now, now)
    .run();
  return user!.id;
}

function subscriptionEvent(eventId: string, status = 'active'): string {
  return JSON.stringify({
    id: eventId,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_wh_test',
        customer: 'cus_wh_test',
        status,
        currency: 'eur',
        current_period_start: 1760000000,
        current_period_end: 1762600000,
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_test' } }] },
      },
    },
  });
}

describe('Stripe webhook endpoint', () => {
  it('rejects unsigned payloads without recording them as processed', async () => {
    const payload = subscriptionEvent('evt_bad_sig');
    const res = await SELF.fetch('http://localhost/api/v1/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    expect(res.status).toBe(400);
    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM billing_webhook_events
       WHERE stripe_event_id = 'evt_bad_sig' AND status = 'processed'`,
    ).first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it('rejects payloads whose signature does not match the body', async () => {
    const payload = subscriptionEvent('evt_tampered');
    const res = await SELF.fetch('http://localhost/api/v1/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': await sign(payload) },
      body: subscriptionEvent('evt_tampered', 'canceled'),
    });
    expect(res.status).toBe(400);
  });

  it('applies verified subscription events once and short-circuits duplicates', async () => {
    const userId = await seedCustomer('wh-user@workers.test');
    const payload = subscriptionEvent('evt_processed_1');
    const headers = {
      'content-type': 'application/json',
      'stripe-signature': await sign(payload),
    };

    const first = await SELF.fetch('http://localhost/api/v1/billing/webhook', {
      method: 'POST',
      headers,
      body: payload,
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { status: string }).status).toBe('processed');

    const ent = await env.DB.prepare(`SELECT plan, status FROM entitlements WHERE user_id = ?`)
      .bind(userId)
      .first<{ plan: string; status: string }>();
    expect(ent?.plan).toBe('premium');
    expect(ent?.status).toBe('active');

    // Duplicate delivery: recorded, but no second application.
    const dupRes = await SELF.fetch('http://localhost/api/v1/billing/webhook', {
      method: 'POST',
      headers,
      body: payload,
    });
    expect(dupRes.status).toBe(200);
    const dupBody = (await dupRes.json()) as { duplicate: boolean };
    expect(dupBody.duplicate).toBe(true);
    const events = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM billing_webhook_events WHERE stripe_event_id = 'evt_processed_1'`,
    ).first<{ n: number }>();
    expect(events?.n).toBe(1);
  });
});
