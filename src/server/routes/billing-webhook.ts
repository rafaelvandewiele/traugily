/** Stripe webhook route: raw-body signature verification + idempotent event recording. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { unauthorized } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { recordOperationalEvent } from '../lib/audit';
import { createStripeClient } from '../services/stripe';
import { applyWebhookEvent } from '../services/billing-webhooks';
import { sendMail } from '../services/mail';

export const billingWebhookRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

billingWebhookRoutes.post('/webhook', async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header('stripe-signature');
  const verified = await createStripeClient(c.env).verifyWebhook(payload, signature);
  if (!verified.ok) {
    await recordOperationalEvent(c.env.DB, {
      kind: 'webhook_failed',
      severity: 'error',
      subject: 'stripe_signature',
      detail: { reason: verified.reason },
      requestId: c.get('requestId'),
    });
    return c.json(
      { error: { code: 'invalid_signature', message: 'Signature verification failed.' } },
      400,
    );
  }

  const event = JSON.parse(payload) as {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };

  // Idempotency: record the event id first; duplicates short-circuit without side effects.
  const existing = await c.env.DB.prepare(
    `SELECT status FROM billing_webhook_events WHERE stripe_event_id = ?`,
  )
    .bind(event.id)
    .first<{ status: string }>();
  if (existing) {
    return c.json({ received: true, duplicate: true, status: existing.status });
  }
  await c.env.DB.prepare(
    `INSERT INTO billing_webhook_events (stripe_event_id, event_type, payload_hash, received_at, status)
     VALUES (?, ?, ?, ?, 'received')`,
  )
    .bind(event.id, event.type, await hashOf(payload), nowIso())
    .run();

  try {
    const outcome = await applyWebhookEvent(c.env, event);
    await c.env.DB.prepare(
      `UPDATE billing_webhook_events SET status = ?, processed_at = ? WHERE stripe_event_id = ?`,
    )
      .bind(outcome.status, nowIso(), event.id)
      .run();
    if (outcome.mail) await sendMail(c.env, outcome.mail);
    return c.json({ received: true, status: outcome.status });
  } catch (err) {
    await c.env.DB.prepare(
      `UPDATE billing_webhook_events SET status = 'failed', error_message = ? WHERE stripe_event_id = ?`,
    )
      .bind(err instanceof Error ? err.message.slice(0, 200) : 'processing_error', event.id)
      .run();
    await recordOperationalEvent(c.env.DB, {
      kind: 'webhook_failed',
      severity: 'error',
      subject: event.type,
      detail: { eventId: event.id },
      requestId: c.get('requestId'),
    });
    throw err;
  }
});

billingWebhookRoutes.get('/webhook-events', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth || !auth.user.is_admin) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT stripe_event_id, event_type, status, received_at, processed_at, error_message
     FROM billing_webhook_events ORDER BY received_at DESC LIMIT 50`,
  ).all();
  return c.json({ events: rows.results });
});

async function hashOf(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
