/** Today summary + workout start (quick "Begin workout" from Today). */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { notFound, unauthorized } from '../lib/errors';
import { newId, nowIso, todayIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';

export const workoutRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

workoutRoutes.get('/today', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const today = todayIso();

  const [
    plan,
    nextSession,
    activeWorkout,
    proposals,
    notifications,
    onboarding,
  ] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.id, p.status, pv.version, p.nutrition_framework
       FROM plans p JOIN plan_versions pv ON pv.id = p.current_version_id
       WHERE p.user_id = ? AND p.status = 'active' LIMIT 1`,
    )
      .bind(auth.user.id)
      .first<{ id: string; status: string; version: number; nutrition_framework: string }>(),
    c.env.DB.prepare(
      `SELECT ss.id, ss.scheduled_date, ss.weekday, ss.kind, ss.title_key, ss.focus_key,
              ss.duration_minutes, ss.status
       FROM scheduled_sessions ss
       JOIN plans p ON p.current_version_id = ss.version_id
       WHERE p.user_id = ? AND ss.scheduled_date >= ? AND ss.kind = 'workout' AND ss.status = 'planned'
       ORDER BY ss.scheduled_date LIMIT 1`,
    )
      .bind(auth.user.id, today)
      .first<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT id, client_workout_id, started_at, state, server_version
       FROM workout_executions WHERE user_id = ? AND state = 'in_progress'
       ORDER BY started_at DESC LIMIT 1`,
    )
      .bind(auth.user.id)
      .first<{ id: string; started_at: string; server_version: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM adaptation_proposals WHERE user_id = ? AND status = 'pending'`,
    )
      .bind(auth.user.id)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    )
      .bind(auth.user.id)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT onboarding_completed_at FROM profiles WHERE user_id = ?`,
    )
      .bind(auth.user.id)
      .first<{ onboarding_completed_at: string | null }>(),
  ]);

  let sessionDetail: Record<string, unknown> | null = null;
  if (nextSession) {
    const exercises = await c.env.DB.prepare(
      `SELECT se.id, se.exercise_id, se.position, e.name_en
       FROM session_exercises se JOIN exercises e ON e.id = se.exercise_id
       WHERE se.session_id = ? ORDER BY se.position`,
    )
      .bind(nextSession.id)
      .all();
    sessionDetail = { ...nextSession, exercises: exercises.results };
  }

  return c.json({
    plan: plan
      ? {
          id: plan.id,
          status: plan.status,
          version: plan.version,
          nutritionFramework: JSON.parse(plan.nutrition_framework),
        }
      : null,
    nextSession: sessionDetail,
    activeWorkout,
    pendingProposalCount: proposals?.n ?? 0,
    unreadNotifications: notifications?.n ?? 0,
    nextAction: activeWorkout
      ? {
          kind: 'resume_workout',
          labelKey: 'today.action.resume_workout',
          workoutId: activeWorkout.id,
        }
      : nextSession
        ? {
            kind: 'start_workout',
            labelKey: 'today.action.start_workout',
            sessionId: nextSession.id,
          }
        : plan
          ? { kind: 'view_plan', labelKey: 'today.action.view_plan' }
          : onboarding?.onboarding_completed_at
            ? { kind: 'generate_plan', labelKey: 'today.action.generate_plan' }
            : { kind: 'start_onboarding', labelKey: 'today.action.start_onboarding' },
  });
});

workoutRoutes.post('/start', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = (await c.req.json().catch(() => ({}))) as {
    sessionId?: string;
    clientWorkoutId?: string;
  };

  const active = await c.env.DB.prepare(
    `SELECT id, server_version, started_at FROM workout_executions
     WHERE user_id = ? AND state = 'in_progress' LIMIT 1`,
  )
    .bind(auth.user.id)
    .first<{ id: string; server_version: number; started_at: string }>();
  if (active) {
    return c.json({
      workoutId: active.id,
      serverVersion: active.server_version,
      resumed: true,
      startedAt: active.started_at,
    });
  }

  let sessionId: string | null;
  if (body.sessionId) {
    const session = await c.env.DB.prepare(
      `SELECT id FROM scheduled_sessions WHERE id = ? AND user_id = ?`,
    )
      .bind(body.sessionId, auth.user.id)
      .first<{ id: string }>();
    if (!session) throw notFound('Scheduled session not found.');
    sessionId = session.id;
  } else {
    const next = await c.env.DB.prepare(
      `SELECT ss.id FROM scheduled_sessions ss
       JOIN plans p ON p.current_version_id = ss.version_id
       WHERE p.user_id = ? AND ss.scheduled_date >= ? AND ss.kind = 'workout' AND ss.status = 'planned'
       ORDER BY ss.scheduled_date LIMIT 1`,
    )
      .bind(auth.user.id, todayIso())
      .first<{ id: string }>();
    sessionId = next?.id ?? null;
  }

  const workoutId = newId('wko');
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO workout_executions (id, user_id, session_id, client_workout_id, state,
       started_at, server_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'in_progress', ?, 1, ?, ?)`,
  )
    .bind(workoutId, auth.user.id, sessionId, body.clientWorkoutId ?? workoutId, now, now, now)
    .run();

  if (sessionId) {
    const sessionExercises = await c.env.DB.prepare(
      `SELECT id, exercise_id, position FROM session_exercises WHERE session_id = ? ORDER BY position`,
    )
      .bind(sessionId)
      .all<{ id: string; exercise_id: string; position: number }>();
    for (const se of sessionExercises.results) {
      const peId = newId('pex');
      await c.env.DB.prepare(
        `INSERT INTO performed_exercises (id, workout_id, session_exercise_id, exercise_id,
           planned_position, actual_position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(peId, workoutId, se.id, se.exercise_id, se.position, se.position, now)
        .run();

      const plannedSets = await c.env.DB.prepare(
        `SELECT id, set_index FROM planned_sets WHERE session_exercise_id = ? ORDER BY set_index`,
      )
        .bind(se.id)
        .all<{ id: string; set_index: number }>();
      for (const ps of plannedSets.results) {
        await c.env.DB.prepare(
          `INSERT INTO set_logs (id, workout_id, performed_exercise_id, set_index, planned_set_id,
             status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'skipped', ?, ?)`,
        )
          .bind(newId('stl'), workoutId, peId, ps.set_index, ps.id, now, now)
          .run();
      }
    }
  }

  return c.json({ workoutId, serverVersion: 1, resumed: false, startedAt: now });
});
