/** Finish a workout: summary stats (labelled estimates) + adaptation proposal trigger. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { finishWorkoutSchema } from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { writeAudit } from '../lib/audit';
import { runAdaptationEvaluation } from '../services/adaptation-service';

export const workoutFinishRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

workoutFinishRoutes.post('/:id/finish', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const workoutId = c.req.param('id');

  const workout = await c.env.DB.prepare(
    `SELECT id, user_id, session_id, started_at, state, server_version
     FROM workout_executions WHERE id = ?`,
  )
    .bind(workoutId)
    .first<{
      id: string;
      user_id: string;
      session_id: string | null;
      started_at: string;
      state: string;
      server_version: number;
    }>();
  if (!workout || workout.user_id !== auth.user.id) throw notFound('Workout not found.');
  if (workout.state !== 'in_progress') {
    throw badRequest('This workout is already finished.');
  }

  const body = await c.req.json().catch(() => null);
  const parsed = finishWorkoutSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Invalid finish payload.');

  const executedSets = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM set_logs
     WHERE workout_id = ? AND status = 'completed' AND (actual_reps > 0 OR actual_weight_kg > 0)`,
  )
    .bind(workoutId)
    .first<{ n: number }>();
  if (!executedSets || executedSets.n < 1) {
    throw badRequest(
      'Finishing needs at least one logged set. Keep this as a draft, or discard the workout.',
      'no_executed_sets',
    );
  }

  const now = nowIso();
  const endedAt = now;
  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(endedAt) - Date.parse(workout.started_at)) / 1000),
  );
  const [rest, volume, skipped, completedExercises, profile, userTz] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(actual_seconds), 0) AS total, COUNT(*) AS n FROM rest_logs WHERE workout_id = ?`,
    )
      .bind(workoutId)
      .first<{ total: number; n: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(actual_weight_kg * actual_reps), 0) AS v FROM set_logs
       WHERE workout_id = ? AND status = 'completed'`,
    )
      .bind(workoutId)
      .first<{ v: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM performed_exercises WHERE workout_id = ? AND status = 'skipped'`,
    )
      .bind(workoutId)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM performed_exercises WHERE workout_id = ? AND status = 'completed'`,
    )
      .bind(workoutId)
      .first<{ n: number }>(),
    c.env.DB.prepare(`SELECT weight_kg, unit_system FROM profiles WHERE user_id = ?`)
      .bind(auth.user.id)
      .first<{ weight_kg: number | null; unit_system: string }>(),
    c.env.DB.prepare(`SELECT timezone FROM users WHERE id = ?`)
      .bind(auth.user.id)
      .first<{ timezone: string }>(),
  ]);

  // Estimated calorie burn — always labelled an estimate (rough MET-based factor).
  const metFactor = 3.5;
  const bodyWeightKg = profile?.weight_kg ?? 75;
  const activeSeconds = Math.max(60, durationSeconds - (rest?.total ?? 0));
  const estimatedCalories =
    Math.round(((metFactor * 3.5 * bodyWeightKg * activeSeconds) / (200 * 60)) * 10) / 10;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE workout_executions SET state = 'completed', ended_at = ?, energy_rating = ?,
         difficulty_rating = ?, recovery_rating = ?, general_note = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      endedAt,
      parsed.data.energyRating ?? null,
      parsed.data.difficultyRating ?? null,
      parsed.data.recoveryRating ?? null,
      parsed.data.generalNote ?? null,
      now,
      workoutId,
    ),
    ...(workout.session_id
      ? [
          c.env.DB.prepare(
            `UPDATE scheduled_sessions SET status = 'completed', updated_at = ? WHERE id = ?`,
          ).bind(now, workout.session_id),
        ]
      : []),
  ]);

  const bestRows = await c.env.DB.prepare(
    `SELECT pe.exercise_id, MAX(sl.actual_weight_kg) AS best_w
     FROM set_logs sl JOIN performed_exercises pe ON pe.id = sl.performed_exercise_id
     WHERE sl.workout_id = ? AND sl.status = 'completed'
     GROUP BY pe.exercise_id`,
  )
    .bind(workoutId)
    .all<{ exercise_id: string; best_w: number | null }>();
  for (const row of bestRows.results) {
    if (row.best_w && row.best_w > 0) {
      await c.env.DB.prepare(
        `INSERT INTO personal_records (id, user_id, exercise_id, record_kind, value, unit,
           achieved_date, workout_id, created_at)
         VALUES (?, ?, ?, 'best_weight', ?, 'kg', ?, ?, ?)`,
      )
        .bind(
          newId('pr'),
          auth.user.id,
          row.exercise_id,
          row.best_w,
          endedAt.slice(0, 10),
          workoutId,
          now,
        )
        .run();
    }
  }

  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'member' },
    action: 'workout_finished',
    targetType: 'workout',
    targetId: workoutId,
    afterState: {
      durationSeconds,
      executedSets: executedSets.n,
      skippedExercises: skipped?.n ?? 0,
    },
  });

  const proposals = await runAdaptationEvaluation(c.env, auth.user.id);

  return c.json({
    ok: true,
    summary: {
      durationSeconds,
      activeSeconds,
      totalRestSeconds: rest?.total ?? 0,
      restCount: rest?.n ?? 0,
      completedExercises: completedExercises?.n ?? 0,
      skippedExercises: skipped?.n ?? 0,
      executedSets: executedSets.n,
      estimatedVolumeKg: Math.round(volume?.v ?? 0),
      estimatedCalories,
      calorieNote: 'estimate_labelled',
      timezone: userTz?.timezone ?? 'UTC',
    },
    newProposals: proposals,
  });
});
