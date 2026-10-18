/** Workout actions: set logging (planned vs actual), skips, reorder. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { reorderSchema, setLogSchema, skipExerciseSchema } from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';

export const workoutActionRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function ownedWorkout(env: Env, userId: string, workoutId: string) {
  const workout = await env.DB.prepare(
    `SELECT id, user_id, session_id, started_at, ended_at, state, server_version
     FROM workout_executions WHERE id = ?`,
  )
    .bind(workoutId)
    .first<{
      id: string;
      user_id: string;
      session_id: string | null;
      started_at: string;
      ended_at: string | null;
      state: string;
      server_version: number;
    }>();
  if (!workout || workout.user_id !== userId) throw notFound('Workout not found.');
  return workout;
}

/* ------------------------------ Set log ------------------------------ */

workoutActionRoutes.post('/:id/sets', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const workoutId = c.req.param('id');
  const workout = await ownedWorkout(c.env, auth.user.id, workoutId);
  if (workout.state !== 'in_progress') {
    throw badRequest('This workout is already finished. Its records are preserved as-is.');
  }

  const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = setLogSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid set entry.', issue?.path.join('.'));
  }
  const d = parsed.data;
  const exerciseId = typeof raw?.exerciseId === 'string' ? raw.exerciseId : '';
  if (!exerciseId) throw badRequest('Missing exercise for this set.', 'exerciseId');

  // Empty-save guard (task_0002): never store status:'partial' (or 'completed')
  // with all-null actuals — such rows poison the finish gate, which needs
  // >=1 completed set with actual_reps > 0 OR actual_weight_kg > 0.
  const hasActual =
    d.actualReps != null || d.actualWeightKg != null || d.actualRpe != null || d.actualRir != null;
  if (!hasActual) {
    throw badRequest(
      'Enter reps, weight, RPE or RIR before saving this set — empty sets are not saved.',
      'set_empty',
    );
  }
  if (d.status === 'completed' && !((d.actualReps ?? 0) > 0 || (d.actualWeightKg ?? 0) > 0)) {
    throw badRequest(
      'A completed set needs reps above 0 or a weight above 0.',
      'set_empty',
    );
  }

  const pe = await c.env.DB.prepare(
    `SELECT id FROM performed_exercises WHERE workout_id = ? AND exercise_id = ?`,
  )
    .bind(workoutId, exerciseId)
    .first<{ id: string }>();
  if (!pe) throw notFound('Exercise not found in this workout.');

  // Idempotency: the same client event id never double-applies.
  const dup = await c.env.DB.prepare(
    `SELECT id FROM workout_sync_events WHERE workout_id = ? AND client_event_id = ?`,
  )
    .bind(workoutId, d.clientEventId)
    .first<{ id: string }>();
  if (dup) return c.json({ ok: true, duplicate: true, serverVersion: workout.server_version });

  const now = nowIso();
  const planned = await c.env.DB.prepare(
    `SELECT ps.id FROM set_logs sl LEFT JOIN planned_sets ps ON ps.id = sl.planned_set_id
     WHERE sl.workout_id = ? AND sl.performed_exercise_id = ? AND sl.set_index = ?`,
  )
    .bind(workoutId, pe.id, d.setIndex)
    .first<{ id: string | null }>();

  // Planned and actual both retained: planned_set_id untouched, actuals written separately.
  await c.env.DB.prepare(
    `INSERT INTO set_logs (id, workout_id, performed_exercise_id, set_index, planned_set_id,
       actual_weight_kg, actual_reps, actual_rpe, actual_rir, status, note, client_event_id,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workout_id, performed_exercise_id, set_index) DO UPDATE SET
       actual_weight_kg = excluded.actual_weight_kg, actual_reps = excluded.actual_reps,
       actual_rpe = excluded.actual_rpe, actual_rir = excluded.actual_rir,
       status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
  )
    .bind(
      newId('stl'),
      workoutId,
      pe.id,
      d.setIndex,
      d.plannedSetId ?? planned?.id ?? null,
      d.actualWeightKg ?? null,
      d.actualReps ?? null,
      d.actualRpe ?? null,
      d.actualRir ?? null,
      d.status,
      d.note ?? null,
      d.clientEventId,
      now,
      now,
    )
    .run();

  if (d.applyTo === 'remaining_sets') {
    await c.env.DB.prepare(
      `UPDATE set_logs SET actual_weight_kg = ?, actual_reps = ?, updated_at = ?
       WHERE workout_id = ? AND performed_exercise_id = ? AND set_index > ?
         AND actual_reps IS NULL AND actual_weight_kg IS NULL`,
    )
      .bind(d.actualWeightKg ?? null, d.actualReps ?? null, now, workoutId, pe.id, d.setIndex)
      .run();
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO workout_sync_events (id, workout_id, client_event_id, event_type, payload, applied_at)
       VALUES (?, ?, ?, 'set_logged', ?, ?)`,
    ).bind(newId('wse'), workoutId, d.clientEventId, JSON.stringify({ setIndex: d.setIndex }), now),
    c.env.DB.prepare(
      `UPDATE workout_executions SET updated_at = ?, server_version = server_version + 1 WHERE id = ?`,
    ).bind(now, workoutId),
  ]);

  return c.json({ ok: true, serverVersion: workout.server_version + 1 });
});

/* ---------------------------- Skip exercise ---------------------------- */

workoutActionRoutes.post('/:id/skip', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const workoutId = c.req.param('id');
  const workout = await ownedWorkout(c.env, auth.user.id, workoutId);
  const body = await c.req.json().catch(() => null);
  const parsed = skipExerciseSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Please choose a skip reason (or "No reason").');

  const now = nowIso();
  await c.env.DB.prepare(
    `UPDATE performed_exercises SET status = 'skipped', skip_reason = ?, skip_note = ?
     WHERE workout_id = ? AND exercise_id = ?`,
  )
    .bind(parsed.data.reason, parsed.data.note ?? null, workoutId, parsed.data.exerciseId)
    .run();
  await c.env.DB.prepare(
    `UPDATE workout_executions SET updated_at = ?, server_version = server_version + 1 WHERE id = ?`,
  )
    .bind(now, workoutId)
    .run();
  return c.json({ ok: true, serverVersion: workout.server_version + 1 });
});

/* ------------------------------ Reorder ------------------------------ */

workoutActionRoutes.post('/:id/reorder', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const workoutId = c.req.param('id');
  const workout = await ownedWorkout(c.env, auth.user.id, workoutId);
  const body = await c.req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Invalid exercise order.');

  const now = nowIso();
  for (let i = 0; i < parsed.data.order.length; i++) {
    await c.env.DB.prepare(
      `UPDATE performed_exercises SET actual_position = ? WHERE workout_id = ? AND exercise_id = ?`,
    )
      .bind(i + 1, workoutId, parsed.data.order[i])
      .run();
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO workout_sync_events (id, workout_id, client_event_id, event_type, payload, applied_at)
       VALUES (?, ?, ?, 'exercise_reordered', ?, ?)`,
    ).bind(
      newId('wse'),
      workoutId,
      parsed.data.clientEventId,
      JSON.stringify({ order: parsed.data.order }),
      now,
    ),
    c.env.DB.prepare(
      `UPDATE workout_executions SET updated_at = ?, server_version = server_version + 1 WHERE id = ?`,
    ).bind(now, workoutId),
  ]);
  return c.json({ ok: true, serverVersion: workout.server_version + 1 });
});
