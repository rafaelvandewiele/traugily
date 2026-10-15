/** Planner extras: rest-day requests and availability updates. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { badRequest, unauthorized } from '../lib/errors';
import { nowIso, todayIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';

export const plannerExtraRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

plannerExtraRoutes.post('/rest-day', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = (await c.req.json().catch(() => ({}))) as { date?: string; reason?: string };
  const date = body.date ?? todayIso();
  const plan = await c.env.DB.prepare(
    `SELECT current_version_id FROM plans WHERE user_id = ? AND status = 'active' LIMIT 1`,
  )
    .bind(auth.user.id)
    .first<{ current_version_id: string | null }>();
  if (!plan?.current_version_id) throw badRequest('No active plan to adjust.');

  // Convert a planned session to a rest/recovery marker; history is never deleted.
  const result = await c.env.DB.prepare(
    `UPDATE scheduled_sessions SET kind = 'recovery', title_key = 'plan.week.rest',
       status = 'rest', move_note = ?, updated_at = ?
     WHERE version_id = ? AND scheduled_date = ? AND status = 'planned'`,
  )
    .bind(body.reason ?? 'member_requested_rest', nowIso(), plan.current_version_id, date)
    .run();
  return c.json({
    ok: true,
    date,
    changed: result.meta.changes ?? 0,
    messageKey: 'planner.rest_day.requested',
  });
});

plannerExtraRoutes.post('/availability', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = (await c.req.json().catch(() => null)) as {
    preferredWeekdays?: number[];
    minutesPerSession?: number;
  } | null;
  if (!body?.preferredWeekdays || body.preferredWeekdays.length < 2) {
    throw badRequest('Choose at least two preferred training days.', 'preferredWeekdays');
  }
  if (body.preferredWeekdays.some((d) => d < 0 || d > 6)) {
    throw badRequest('Weekdays must be between 0 (Sunday) and 6 (Saturday).', 'preferredWeekdays');
  }
  const now = nowIso();
  await c.env.DB.prepare(`DELETE FROM availability WHERE user_id = ?`).bind(auth.user.id).run();
  for (const wd of body.preferredWeekdays) {
    await c.env.DB.prepare(
      `INSERT INTO availability (id, user_id, weekday, preferred, minutes, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
      .bind(`avl_${auth.user.id}_${wd}`, auth.user.id, wd, body.minutesPerSession ?? null, now)
      .run();
  }
  return c.json({ ok: true, messageKey: 'planner.availability.updated_recalc_hint' });
});
