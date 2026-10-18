/** Regression: empty partial saves must not poison the finish gate (task_0002). */

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { json, post, signupAndCookies } from './helpers';

async function ensureCatalogue() {
  const now = new Date().toISOString();
  // Idempotent across tests sharing one D1 isolate: same rows, ignore repeats.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO exercises (id, slug, name_en, movement_pattern, primary_muscles,
       supporting_muscles, equipment, skill_level, safety_flags, replacement_group,
       review_status, version, created_at, updated_at, published_at)
     VALUES ('ex_bench', 'bench-press', 'Bench Press', 'horizontal_push', '["chest"]',
       '[]', '["barbells"]', 'beginner', '[]', NULL, 'published', 1, ?, ?, ?)`,
  )
    .bind(now, now, now)
    .run();
}

async function startWorkoutWithExercise(email: string, tag: string) {
  const { cookies, csrf } = await signupAndCookies(email);
  const start = await json<{ workoutId: string; serverVersion: number }>(
    '/workouts/start',
    post('/workouts/start', {}, csrf, cookies),
  );
  expect(start.status).toBe(200);
  const workoutId = start.body.workoutId;

  await ensureCatalogue();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO performed_exercises (id, workout_id, session_exercise_id, exercise_id,
       planned_position, actual_position, created_at)
     VALUES (?, ?, NULL, 'ex_bench', 1, 1, ?)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(`pex_${tag}`, workoutId, now)
    .run();

  return { cookies, csrf, workoutId };
}

function setBody(tag: string, extra: Record<string, unknown>) {
  return {
    exerciseId: 'ex_bench',
    setIndex: 1,
    clientEventId: `evt-${tag}-set-01`,
    applyTo: 'this_set',
    ...extra,
  };
}

describe('set-save + finish (task_0002)', () => {
  it('rejects an empty partial save instead of storing all-null actuals', async () => {
    const { cookies, csrf, workoutId } = await startWorkoutWithExercise(
      'empty-partial@workers.test',
      'empty',
    );

    const res = await json<{ error: { code: string; message: string; field?: string } }>(
      `/workouts/${workoutId}/sets`,
      post(
        `/workouts/${workoutId}/sets`,
        setBody('empty', { status: 'partial' }),
        csrf,
        cookies,
      ),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('set_empty');

    // The rejected empty must not leave a poison row behind: finish still
    // reports the honest "no executed sets" gate, not a phantom success.
    const finish = await json<{ error: { field?: string } }>(
      `/workouts/${workoutId}/finish`,
      post(`/workouts/${workoutId}/finish`, { clientWorkoutId: workoutId }, csrf, cookies),
    );
    expect(finish.status).toBe(400);
    expect(finish.body.error.field).toBe('no_executed_sets');
  });

  it('rejects completed-without-actuals and accepts a real set so finish succeeds', async () => {
    const { cookies, csrf, workoutId } = await startWorkoutWithExercise(
      'completed-gate@workers.test',
      'gate',
    );

    const bad = await json<{ error: { field?: string } }>(
      `/workouts/${workoutId}/sets`,
      post(
        `/workouts/${workoutId}/sets`,
        setBody('gate-bad', { status: 'completed' }),
        csrf,
        cookies,
      ),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.field).toBe('set_empty');

    const good = await json<{ ok: boolean; serverVersion: number }>(
      `/workouts/${workoutId}/sets`,
      post(
        `/workouts/${workoutId}/sets`,
        setBody('gate-good', {
          status: 'completed',
          actualReps: 8,
          actualWeightKg: 60,
        }),
        csrf,
        cookies,
      ),
    );
    expect(good.status).toBe(200);
    expect(good.body.ok).toBe(true);

    const finish = await json<{ ok: boolean; summary: { executedSets: number } }>(
      `/workouts/${workoutId}/finish`,
      post(`/workouts/${workoutId}/finish`, { clientWorkoutId: workoutId }, csrf, cookies),
    );
    expect(finish.status).toBe(200);
    expect(finish.body.ok).toBe(true);
    expect(finish.body.summary.executedSets).toBe(1);
  });

  it('counts a weight-only completed set toward the finish gate', async () => {
    const { cookies, csrf, workoutId } = await startWorkoutWithExercise(
      'weight-only@workers.test',
      'weight',
    );

    const good = await json<{ ok: boolean }>(
      `/workouts/${workoutId}/sets`,
      post(
        `/workouts/${workoutId}/sets`,
        setBody('weight-good', {
          status: 'completed',
          actualReps: null,
          actualWeightKg: 40,
        }),
        csrf,
        cookies,
      ),
    );
    expect(good.status).toBe(200);

    const finish = await json<{ ok: boolean; summary: { executedSets: number } }>(
      `/workouts/${workoutId}/finish`,
      post(`/workouts/${workoutId}/finish`, { clientWorkoutId: workoutId }, csrf, cookies),
    );
    expect(finish.status).toBe(200);
    expect(finish.body.summary.executedSets).toBe(1);
  });
});
