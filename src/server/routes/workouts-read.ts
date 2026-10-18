/** Workout reads: session state for the player + history list. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { notFound, unauthorized } from '../lib/errors';
import { getAuth } from '../middleware/auth';

export const workoutReadRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

workoutReadRoutes.get('/history', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  // Duration is computed inline on purpose: a scalar subquery of the form
  // `(SELECT COALESCE(SUM(julianday(...) - julianday(...)), 0) ...)` makes D1
  // return a phantom all-NULL row when the outer query matches nothing, which
  // crashed the Log page while rendering (null.started_at.slice). Plain
  // COUNT-style scalar subqueries are safe and verified not to do this.
  const rows = await c.env.DB.prepare(
    `SELECT w.id, w.started_at, w.ended_at, w.state,
            COALESCE(CAST((julianday(w.ended_at) - julianday(w.started_at)) * 86400 AS INTEGER), 0)
              AS duration_seconds,
            (SELECT COUNT(*) FROM set_logs s
              WHERE s.workout_id = w.id AND s.status = 'completed') AS executed_sets
     FROM workout_executions w
     WHERE w.user_id = ? AND w.state = 'completed'
     ORDER BY w.started_at DESC LIMIT 100`,
  )
    .bind(auth.user.id)
    .all<{
      id: string;
      started_at: string;
      ended_at: string | null;
      state: string;
      duration_seconds: number;
      executed_sets: number;
    }>();
  return c.json({ workouts: rows.results });
});

workoutReadRoutes.get('/:id/state', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const workoutId = c.req.param('id');
  const workout = await c.env.DB.prepare(
    `SELECT id, user_id, state, server_version, started_at
     FROM workout_executions WHERE id = ?`,
  )
    .bind(workoutId)
    .first<{
      id: string;
      user_id: string;
      state: string;
      server_version: number;
      started_at: string;
    }>();
  if (!workout || workout.user_id !== auth.user.id) throw notFound('Workout not found.');

  const exercises = await c.env.DB.prepare(
    `SELECT pe.id, pe.exercise_id, pe.actual_position, pe.status, pe.skip_reason, e.name_en
     FROM performed_exercises pe JOIN exercises e ON e.id = pe.exercise_id
     WHERE pe.workout_id = ? ORDER BY pe.actual_position`,
  )
    .bind(workoutId)
    .all<{
      id: string;
      exercise_id: string;
      actual_position: number;
      status: string;
      skip_reason: string | null;
      name_en: string;
    }>();

  const detailed = await Promise.all(
    exercises.results.map(async (ex) => {
      const sets = await c.env.DB.prepare(
        `SELECT sl.set_index, ps.planned_reps, ps.planned_weight_kg, ps.planned_rir,
                ps.rest_seconds, sl.actual_reps, sl.actual_weight_kg, sl.actual_rpe, sl.status
         FROM set_logs sl
         LEFT JOIN planned_sets ps ON ps.id = sl.planned_set_id
         WHERE sl.workout_id = ? AND sl.performed_exercise_id = ?
         ORDER BY sl.set_index`,
      )
        .bind(workoutId, ex.id)
        .all<{
          set_index: number;
          planned_reps: number | null;
          planned_weight_kg: number | null;
          planned_rir: number | null;
          rest_seconds: number | null;
          actual_reps: number | null;
          actual_weight_kg: number | null;
          actual_rpe: number | null;
          status: string;
        }>();
      return { ...ex, sets: sets.results };
    }),
  );

  return c.json({
    workoutId: workout.id,
    serverVersion: workout.server_version,
    startedAt: workout.started_at,
    state: workout.state,
    exercises: detailed,
  });
});
