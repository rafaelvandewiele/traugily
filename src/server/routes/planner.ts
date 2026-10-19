/** Planner: month view and moving sessions with recovery-conflict analysis. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { moveSessionSchema } from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { addDaysISO, weekdayOf } from '../../shared/units';
import { nowIso, todayIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const plannerRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

plannerRoutes.get('/month', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const month = c.req.query('month') ?? todayIso().slice(0, 7); // YYYY-MM
  const start = `${month}-01`;
  const end = `${month}-31`;

  const [sessions, blocked, plan] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ss.id, ss.scheduled_date, ss.weekday, ss.kind, ss.title_key, ss.focus_key,
              ss.duration_minutes, ss.status, ss.moved_from_date
       FROM scheduled_sessions ss
       JOIN plans p ON p.current_version_id = ss.version_id
       WHERE p.user_id = ? AND ss.scheduled_date BETWEEN ? AND ?
       ORDER BY ss.scheduled_date`,
    )
      .bind(auth.user.id, start, end)
      .all(),
    c.env.DB.prepare(
      `SELECT start_date, end_date, reason FROM blocked_dates
       WHERE user_id = ? AND end_date >= ? AND start_date <= ?`,
    )
      .bind(auth.user.id, start, end)
      .all(),
    c.env.DB.prepare(
      `SELECT p.id, p.status, pv.version FROM plans p
       JOIN plan_versions pv ON pv.id = p.current_version_id
       WHERE p.user_id = ? AND p.status = 'active' LIMIT 1`,
    )
      .bind(auth.user.id)
      .first<{ id: string; status: string; version: number }>(),
  ]);

  return c.json({
    month,
    today: todayIso(),
    sessions: sessions.results,
    blockedDates: blocked.results,
    plan: plan ?? null,
  });
});

plannerRoutes.post('/sessions/:id/move', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = moveSessionSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Choose a new date for this session.');

  const sessionId = c.req.param('id');
  const session = await c.env.DB.prepare(
    `SELECT id, user_id, version_id, scheduled_date, kind, status
     FROM scheduled_sessions WHERE id = ?`,
  )
    .bind(sessionId)
    .first<{
      id: string;
      user_id: string;
      version_id: string;
      scheduled_date: string;
      kind: string;
      status: string;
    }>();
  if (!session || session.user_id !== auth.user.id) throw notFound('Session not found.');
  if (session.status !== 'planned') throw badRequest('Only planned sessions can be moved.');

  const [others, blocked] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, scheduled_date, kind, status FROM scheduled_sessions
       WHERE version_id = ? AND kind = 'workout' AND status IN ('planned','completed')
       ORDER BY scheduled_date`,
    )
      .bind(session.version_id)
      .all<{ id: string; scheduled_date: string; kind: string; status: string }>(),
    c.env.DB.prepare(`SELECT start_date, end_date FROM blocked_dates WHERE user_id = ?`)
      .bind(auth.user.id)
      .all<{ start_date: string; end_date: string }>(),
  ]);

  const targetDate = parsed.data.targetDate;
  const conflicts: Array<{
    code: string;
    messageKey: string;
    params: Record<string, string | number>;
  }> = [];
  const workoutDates = new Set(
    others.results
      .filter((s) => s.status === 'planned' && s.id !== session.id)
      .map((s) => s.scheduled_date),
  );

  const inBlocked = blocked.results.find(
    (b) => targetDate >= b.start_date && targetDate <= b.end_date,
  );
  if (inBlocked) {
    conflicts.push({
      code: 'blocked_date',
      messageKey: 'planner.conflict.blocked_date',
      params: { date: targetDate },
    });
  }

  const prevDay = addDaysISO(targetDate, -1);
  const nextDay = addDaysISO(targetDate, 1);
  if (workoutDates.has(prevDay) && workoutDates.has(nextDay)) {
    conflicts.push({
      code: 'no_rest_between',
      messageKey: 'planner.conflict.no_rest_between',
      params: { date: targetDate },
    });
  }

  let streak = 1;
  for (let i = 1; i <= 2 && workoutDates.has(addDaysISO(targetDate, -i)); i++) streak++;
  for (let i = 1; i <= 2 && workoutDates.has(addDaysISO(targetDate, i)); i++) streak++;
  if (streak >= 3) {
    conflicts.push({
      code: 'training_streak',
      messageKey: 'planner.conflict.training_streak',
      params: { streak, date: targetDate },
    });
  }

  const confirmed = parsed.data.confirmed === true;
  if (conflicts.length > 0 && !confirmed) {
    // Show conflicts + at least one safer alternative before anything changes.
    return c.json({
      requiresConfirmation: true,
      conflicts,
      saferAlternatives: findSaferDates(targetDate, workoutDates, blocked.results),
      messageKey: 'planner.move.review_before_confirm',
    });
  }

  if (conflicts.length > 0 && confirmed) {
    await writeAudit(c.env.DB, {
      actor: { userId: auth.user.id, role: 'member' },
      action: 'session_moved_with_conflict',
      targetType: 'scheduled_session',
      targetId: session.id,
      beforeState: { date: session.scheduled_date },
      afterState: { date: targetDate, conflicts: conflicts.map((x) => x.code) },
    });
  }

  const now = nowIso();
  await c.env.DB.prepare(
    `UPDATE scheduled_sessions SET scheduled_date = ?, moved_from_date = ?, move_note = ?,
       weekday = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      targetDate,
      session.scheduled_date,
      parsed.data.reason ?? null,
      weekdayOf(targetDate),
      now,
      session.id,
    )
    .run();

  return c.json({
    ok: true,
    sessionId: session.id,
    scheduledDate: targetDate,
    movedFrom: session.scheduled_date,
    appliedConflicts: conflicts,
  });
});

/**
 * Delete a workout so it can be done again (member right, audited):
 *  - planned sessions are cancelled (removed from the plan flow, still visible in the calendar);
 *  - completed/in-progress sessions are reset to planned and their execution is
 *    discarded (excluded from history), so the member can genuinely redo them.
 */
plannerRoutes.delete('/sessions/:id', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const sessionId = c.req.param('id');
  const session = await c.env.DB.prepare(
    `SELECT id, user_id, scheduled_date, status FROM scheduled_sessions WHERE id = ?`,
  )
    .bind(sessionId)
    .first<{ id: string; user_id: string; scheduled_date: string; status: string }>();
  if (!session || session.user_id !== auth.user.id) throw notFound('Session not found.');
  if (session.status === 'cancelled') throw badRequest('This workout is already deleted.');
  if (session.status === 'rest') throw badRequest('Rest days cannot be deleted.');

  const now = nowIso();
  const executions = await c.env.DB.prepare(
    `SELECT id FROM workout_executions WHERE session_id = ? AND state != 'discarded'`,
  )
    .bind(sessionId)
    .all<{ id: string }>();

  if (session.status === 'planned') {
    await c.env.DB.prepare(
      `UPDATE scheduled_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?`,
    )
      .bind(now, sessionId)
      .run();
  } else {
    // completed or in_progress: reset to planned and discard executions.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE scheduled_sessions SET status = 'planned', updated_at = ? WHERE id = ?`,
      ).bind(now, sessionId),
      ...executions.results.map((e) =>
        c.env.DB
          .prepare(
            `UPDATE workout_executions SET state = 'discarded', updated_at = ? WHERE id = ?`,
          )
          .bind(now, e.id),
      ),
    ]);
  }

  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'member' },
    action: session.status === 'planned' ? 'session_cancelled' : 'session_reset_for_redo',
    targetType: 'scheduled_session',
    targetId: sessionId,
    beforeState: { status: session.status, scheduledDate: session.scheduled_date },
    afterState: { status: session.status === 'planned' ? 'cancelled' : 'planned' },
  });

  return c.json({
    ok: true,
    sessionId,
    newStatus: session.status === 'planned' ? 'cancelled' : 'planned',
    discardedExecutions: executions.results.length,
  });
});

function findSaferDates(
  targetDate: string,
  workoutDates: Set<string>,
  blocked: Array<{ start_date: string; end_date: string }>,
): string[] {
  const out: string[] = [];
  for (let offset = 1; offset <= 7 && out.length < 3; offset++) {
    for (const candidate of [addDaysISO(targetDate, offset), addDaysISO(targetDate, -offset)]) {
      if (out.length >= 3 || out.includes(candidate)) continue;
      if (workoutDates.has(candidate)) continue;
      if (blocked.some((b) => candidate >= b.start_date && candidate <= b.end_date)) continue;
      const prev = addDaysISO(candidate, -1);
      const next = addDaysISO(candidate, 1);
      if (!workoutDates.has(prev) && !workoutDates.has(next)) out.push(candidate);
    }
  }
  if (out.length === 0) {
    let cursor = targetDate;
    for (let i = 0; i < 14; i++) {
      cursor = addDaysISO(cursor, 1);
      if (
        !workoutDates.has(cursor) &&
        !blocked.some((b) => cursor >= b.start_date && cursor <= b.end_date)
      ) {
        out.push(cursor);
        break;
      }
    }
  }
  return out;
}
