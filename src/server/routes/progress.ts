/** Progress inputs: weigh-ins and optional measurements. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { measurementSchema, weighInSchema } from '../../shared/contracts';
import { badRequest, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';

export const progressRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

progressRoutes.post('/weigh-ins', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = weighInSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid weigh-in.', issue?.path.join('.'));
  }
  const d = parsed.data;
  await c.env.DB.prepare(
    `INSERT INTO weigh_ins (id, user_id, entry_date, weight_kg, conditions, skipped, skip_reason,
       source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)
     ON CONFLICT(user_id, entry_date) DO UPDATE SET weight_kg = excluded.weight_kg,
       conditions = excluded.conditions, skipped = excluded.skipped,
       skip_reason = excluded.skip_reason, created_at = excluded.created_at`,
  )
    .bind(
      newId('wei'),
      auth.user.id,
      d.entryDate,
      d.weightKg,
      d.conditions ? JSON.stringify(d.conditions) : null,
      d.skipped ? 1 : 0,
      d.skipReason ?? null,
      nowIso(),
    )
    .run();
  return c.json({ ok: true, reminderKey: 'progress.weighin.consistency_reminder' });
});

progressRoutes.get('/weigh-ins', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT entry_date, weight_kg, conditions, skipped, skip_reason FROM weigh_ins
     WHERE user_id = ? ORDER BY entry_date DESC LIMIT 120`,
  )
    .bind(auth.user.id)
    .all();
  return c.json({ weighIns: rows.results });
});

progressRoutes.post('/measurements', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = measurementSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Invalid measurement entry.');
  const d = parsed.data;
  await c.env.DB.prepare(
    `INSERT INTO measurements (id, user_id, kind, metric_key, value, unit, entry_date, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId('mea'),
      auth.user.id,
      d.kind,
      d.metricKey,
      d.value,
      d.unit,
      d.entryDate,
      d.note ?? null,
      nowIso(),
    )
    .run();
  return c.json({ ok: true });
});

progressRoutes.get('/measurements', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const kind = c.req.query('kind');
  const sql = `SELECT id, kind, metric_key, value, unit, entry_date, note FROM measurements
    WHERE user_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY entry_date DESC LIMIT 200`;
  const rows = await c.env.DB.prepare(sql)
    .bind(...(kind ? [auth.user.id, kind] : [auth.user.id]))
    .all();
  return c.json({ measurements: rows.results });
});
