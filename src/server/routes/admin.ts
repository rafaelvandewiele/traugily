/** Admin: operational health + privacy-minimised member lookup. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { writeAudit } from '../lib/audit';
import { supportAccessGrantSchema } from '../../shared/contracts';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

adminRoutes.use('*', requireAdmin);

adminRoutes.get('/health', async (c) => {
  const db = c.env.DB;
  const [
    webhookFailures,
    syncConflicts,
    exportStates,
    aiFallbacks,
    pendingCancellations,
    memberCount,
  ] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS n FROM billing_webhook_events WHERE status = 'failed'`)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM operational_events
         WHERE kind = 'sync_conflict' AND created_at > datetime('now', '-7 days')`,
      )
      .first<{ n: number }>(),
    db
      .prepare(`SELECT status, COUNT(*) AS n FROM report_exports GROUP BY status`)
      .all<{ status: string; n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM operational_events
         WHERE kind = 'ai_fallback' AND created_at > datetime('now', '-7 days')`,
      )
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM billing_cancellation_jobs
         WHERE status = 'pending' AND scheduled_cancel_at < datetime('now')`,
      )
      .first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'active'`).first<{ n: number }>(),
  ]);

  return c.json({
    memberCount: memberCount?.n ?? 0,
    webhookFailures: webhookFailures?.n ?? 0,
    syncConflicts7d: syncConflicts?.n ?? 0,
    exportStates: Object.fromEntries(exportStates.results.map((r) => [r.status, r.n])),
    aiFallbacks7d: aiFallbacks?.n ?? 0,
    overdueCancellations: pendingCancellations?.n ?? 0,
  });
});

adminRoutes.get('/operational-events', async (c) => {
  const kind = c.req.query('kind');
  const sql = `SELECT id, kind, severity, subject, detail, request_id, created_at, resolved_at
    FROM operational_events ${kind ? 'WHERE kind = ?' : ''} ORDER BY created_at DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql)
    .bind(...(kind ? [kind] : []))
    .all();
  return c.json({ events: rows.results });
});

adminRoutes.get('/members', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const sql = q
    ? `SELECT id, email, status, locale, is_admin, is_support, created_at FROM users
       WHERE email_normalized LIKE ? ORDER BY created_at DESC LIMIT 50`
    : `SELECT id, email, status, locale, is_admin, is_support, created_at FROM users
       ORDER BY created_at DESC LIMIT 50`;
  const rows = await c.env.DB.prepare(sql)
    .bind(...(q ? [`%${q}%`] : []))
    .all();
  // Privacy-minimised: no health-like data in broad member lists.
  return c.json({ members: rows.results });
});

adminRoutes.get('/members/:id', async (c) => {
  const userId = c.req.param('id');
  const db = c.env.DB;
  const member = await db
    .prepare(
      `SELECT id, email, status, locale, unit_system, timezone, is_admin, is_support, created_at
     FROM users WHERE id = ?`,
    )
    .bind(userId)
    .first();
  if (!member) throw notFound('Member not found.');

  const [entitlement, plan, subscription, supportGrants, consentSummary] = await Promise.all([
    db
      .prepare(`SELECT plan, status, valid_until FROM entitlements WHERE user_id = ?`)
      .bind(userId)
      .first(),
    db
      .prepare(
        `SELECT id, status, goal_duration_weeks, created_at FROM plans WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 3`,
      )
      .bind(userId)
      .all(),
    db
      .prepare(
        `SELECT status, currency, current_period_end, cancel_at_period_end FROM subscriptions
       WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(userId)
      .first(),
    db
      .prepare(
        `SELECT id, case_id, supporter_user_id, reason, scope, granted_at, expires_at, revoked_at
       FROM support_access_grants WHERE target_user_id = ? AND revoked_at IS NULL
         AND expires_at > ? ORDER BY granted_at DESC`,
      )
      .bind(userId, nowIso())
      .all(),
    db
      .prepare(`SELECT consent_key, granted, updated_at FROM consents WHERE user_id = ?`)
      .bind(userId)
      .all(),
  ]);

  return c.json({
    member,
    entitlement,
    plans: plan.results,
    subscription,
    activeSupportGrants: supportGrants.results,
    consents: consentSummary.results,
    privacyNote:
      'Support view is privacy-minimised. Extra scopes require a documented, audited grant.',
  });
});

adminRoutes.get('/members/:id/billing', async (c) => {
  const userId = c.req.param('id');
  const [customer, invoices, sub] = await Promise.all([
    c.env.DB.prepare(`SELECT stripe_customer_id, email FROM stripe_customers WHERE user_id = ?`)
      .bind(userId)
      .first(),
    c.env.DB.prepare(
      `SELECT stripe_invoice_id, amount_due, amount_paid, currency, status, due_date, paid_at, created_at
       FROM billing_invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
    )
      .bind(userId)
      .all(),
    c.env.DB.prepare(
      `SELECT stripe_subscription_id, status, price_id, currency, current_period_end,
              cancel_at_period_end, canceled_at FROM subscriptions
       WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(userId)
      .first(),
  ]);
  // Safe Stripe identifiers only — never full payment method details.
  return c.json({ customer, subscription: sub, invoices: invoices.results });
});

adminRoutes.post('/members/:id/support-grant', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const userId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = supportAccessGrantSchema.safeParse(body);
  if (!parsed.success) throw badRequest('A documented reason and scope are required.');
  const d = parsed.data;
  if (d.targetUserId !== userId) throw badRequest('Target user mismatch.');

  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ id: string }>();
  if (!target) throw notFound('Member not found.');

  const now = nowIso();
  const expiresAt = new Date(Date.now() + d.ttlHours * 3_600_000).toISOString();
  const grantId = newId('grt');
  await c.env.DB.prepare(
    `INSERT INTO support_access_grants (id, case_id, supporter_user_id, target_user_id, reason,
       scope, authorized_by, granted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      grantId,
      d.caseId,
      auth.user.id,
      userId,
      d.reason,
      JSON.stringify(d.scope),
      auth.user.id,
      now,
      expiresAt,
    )
    .run();

  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: auth.user.is_admin ? 'admin' : 'support' },
    action: 'support_access_granted',
    targetType: 'user',
    targetId: userId,
    afterState: { grantId, scope: d.scope, expiresAt },
    requestId: c.get('requestId'),
  });
  return c.json({ ok: true, grantId, expiresAt });
});

adminRoutes.post('/members/:id/support-grant/:grantId/revoke', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  await c.env.DB.prepare(
    `UPDATE support_access_grants SET revoked_at = ? WHERE id = ? AND target_user_id = ?`,
  )
    .bind(nowIso(), c.req.param('grantId'), c.req.param('id'))
    .run();
  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'admin' },
    action: 'support_access_revoked',
    targetType: 'user',
    targetId: c.req.param('id'),
    afterState: { grantId: c.req.param('grantId') },
  });
  return c.json({ ok: true });
});
