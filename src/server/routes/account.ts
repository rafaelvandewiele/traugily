/** Consents, self-service data export, and account deletion. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { consentSchema, changePasswordSchema } from '../../shared/contracts';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { badRequest, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const accountRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

accountRoutes.get('/consents', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT consent_key, granted, version, updated_at FROM consents WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .all<{ consent_key: string; granted: number; version: string; updated_at: string }>();
  return c.json({ consents: rows.results });
});

accountRoutes.put('/consents', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = consentSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Invalid consent request.');
  const { consentKey, granted, version } = parsed.data;
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO consents (id, user_id, consent_key, granted, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, consent_key) DO UPDATE SET granted = excluded.granted,
         version = excluded.version, updated_at = excluded.updated_at`,
    ).bind(newId('con'), auth.user.id, consentKey, granted ? 1 : 0, version, now),
    c.env.DB.prepare(
      `INSERT INTO consent_history (id, user_id, consent_key, granted, version, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(newId('ch'), auth.user.id, consentKey, granted ? 1 : 0, version, now),
  ]);
  return c.json({ ok: true });
});

accountRoutes.get('/export', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const db = c.env.DB;
  const userId = auth.user.id;
  const [profile, goals, sessions, workouts, sets, weighins, foods, consents] = await Promise.all([
    db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).bind(userId).first(),
    db
      .prepare(`SELECT goal_type, priority FROM goals WHERE user_id = ? ORDER BY priority`)
      .bind(userId)
      .all(),
    db
      .prepare(
        `SELECT scheduled_date, kind, title_key, status FROM scheduled_sessions
         WHERE user_id = ? ORDER BY scheduled_date DESC LIMIT 500`,
      )
      .bind(userId)
      .all(),
    db
      .prepare(
        `SELECT id, started_at, ended_at, state FROM workout_executions
         WHERE user_id = ? ORDER BY started_at DESC LIMIT 500`,
      )
      .bind(userId)
      .all(),
    db
      .prepare(
        `SELECT s.id, s.workout_id, s.set_index, s.actual_weight_kg, s.actual_reps, s.status, s.created_at
         FROM set_logs s JOIN workout_executions w ON w.id = s.workout_id
         WHERE w.user_id = ? ORDER BY s.created_at DESC LIMIT 5000`,
      )
      .bind(userId)
      .all(),
    db
      .prepare(
        `SELECT entry_date, weight_kg, skipped, skip_reason FROM weigh_ins
         WHERE user_id = ? ORDER BY entry_date`,
      )
      .bind(userId)
      .all(),
    db
      .prepare(
        `SELECT logged_date, meal_slot, description, accuracy, approx_kcal FROM food_logs
         WHERE user_id = ? AND deleted_at IS NULL ORDER BY logged_date DESC LIMIT 500`,
      )
      .bind(userId)
      .all(),
    db
      .prepare(`SELECT consent_key, granted, version, updated_at FROM consents WHERE user_id = ?`)
      .bind(userId)
      .all(),
  ]);
  await writeAudit(db, {
    actor: { userId, role: 'member' },
    action: 'account_export',
    targetType: 'user',
    targetId: userId,
  });
  return c.json({
    exportedAt: nowIso(),
    user: { email: auth.user.email, locale: auth.user.locale, timezone: auth.user.timezone },
    profile,
    goals: goals.results,
    schedule: sessions.results,
    workouts: workouts.results,
    setLogs: sets.results,
    weighIns: weighins.results,
    foodLogs: foods.results,
    consents: consents.results,
    notice: 'Values are stored in canonical units (kg, cm, UTC). Estimates are labelled.',
  });
});

accountRoutes.delete('/', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = (await c.req.json().catch(() => ({}))) as { confirmEmail?: string };
  if (body.confirmEmail !== auth.user.email) {
    throw badRequest('Type your account email exactly to confirm deletion.', 'confirmEmail');
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(now, now, auth.user.id),
    c.env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?, revoked_reason = 'account_deleted'
       WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(now, auth.user.id),
  ]);
  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'member' },
    action: 'account_delete_requested',
    targetType: 'user',
    targetId: auth.user.id,
    afterState: { status: 'deleted' },
  });
  return c.json({
    ok: true,
    message:
      'Account scheduled for deletion. Operational records (such as invoices) are kept only where legally required.',
  });
accountRoutes.post('/account/password', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid input', issue?.path.join('.'));
  }
  const { currentPassword, newPassword } = parsed.data;

  if (!auth.user.password_hash || !(await verifyPassword(currentPassword, auth.user.password_hash))) {
    throw badRequest('Current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(passwordHash, nowIso(), auth.user.id)
    .run();

  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'member' },
    action: 'password_changed',
    targetType: 'user',
    targetId: auth.user.id,
    afterState: { changedAt: nowIso() },
  });

  return c.json({ ok: true });
});
});
