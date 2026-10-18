/** Integration tests: onboarding flow, workout lifecycle, safety evaluation. */

import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { json, post, signupAndCookies, completeOnboarding } from './helpers';

describe('onboarding flow', () => {
  it('validates each step and completes only when all steps pass', async () => {
    const { cookies, csrf } = await signupAndCookies('flow@workers.test');

    const badBasics = await SELF.fetch('http://localhost/api/v1/onboarding/basics', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
      body: JSON.stringify({ heightCm: -5 }),
    });
    expect(badBasics.status).toBe(400);

    await completeOnboarding(cookies, csrf);

    const progress = await json<{ completed: boolean; nextStep: string }>('/onboarding', {
      headers: { cookie: cookies },
    });
    expect(progress.body.completed).toBe(true);

    // Generate plan — empty isolated catalogue returns a clear 400 guard
    const gen = await json<{ error: { code: string; message: string } }>('/plans/generate', {
      method: 'POST',
      headers: { cookie: cookies, 'x-csrf-token': csrf },
    });
    expect(gen.status).toBe(400);
    expect(gen.body.error.message).toContain('catalogue');
  });

  it('requires at least one executed set to finish a workout', async () => {
    const { cookies, csrf } = await signupAndCookies('empty@workers.test');
    const start = await json<{ workoutId: string }>(
      '/workouts/start',
      post('/workouts/start', {}, csrf, cookies),
    );
    expect(start.status).toBe(200);
    const finish = await json<{ error: { field: string } }>(
      `/workouts/${start.body.workoutId}/finish`,
      post(
        `/workouts/${start.body.workoutId}/finish`,
        { clientWorkoutId: start.body.workoutId },
        csrf,
        cookies,
      ),
    );
    expect(finish.status).toBe(400);
    expect(finish.body.error.field).toBe('no_executed_sets');
  });

  it('evaluates urgent pain signals with stop-training guidance', async () => {
    const { cookies, csrf } = await signupAndCookies('pain@workers.test');
    const start = await json<{ workoutId: string }>(
      '/workouts/start',
      post('/workouts/start', {}, csrf, cookies),
    );
    const report = await json<{
      ok: boolean;
      evaluation: { severity: string; stopTraining: boolean; guidanceKey: string };
    }>('/safety/report', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookies,
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({
        severity: 'pain',
        bodyArea: 'chest',
        note: 'chest pain and dizziness during pressing',
        workoutId: start.body.workoutId,
      }),
    });
    expect(report.status).toBe(200);
    expect(report.body.evaluation.severity).toBe('urgent');
    expect(report.body.evaluation.stopTraining).toBe(true);
    expect(report.body.evaluation.guidanceKey).toBe('safety.guidance.urgent');
  });

  it('classifies plain discomfort as advisory (no stop, no medical claim)', async () => {
    const { cookies, csrf } = await signupAndCookies('discomfort@workers.test');
    const report = await json<{
      evaluation: { severity: string; stopTraining: boolean };
    }>('/safety/report', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookies,
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({ severity: 'discomfort', bodyArea: 'shoulder' }),
    });
    expect(report.status).toBe(200);
    expect(report.body.evaluation.severity).toBe('advisory');
    expect(report.body.evaluation.stopTraining).toBe(false);
  });
});

describe('workout history', () => {
  it('returns an empty list — never a phantom null row — for users without workouts', async () => {
    const { cookies } = await signupAndCookies('history-empty@workers.test');
    const res = await json<{ workouts: Array<{ id: string | null; started_at: string | null }> }>(
      '/workouts/history',
      { headers: { cookie: cookies } },
    );
    expect(res.status).toBe(200);
    // The bug that blanked the Log page: D1 returned one all-NULL row here.
    expect(res.body.workouts).toEqual([]);
  });

  it('returns completed workouts with duration and set count', async () => {
    const { cookies } = await signupAndCookies('history-full@workers.test');
    const me = await json<{ user: { id: string } }>('/auth/me', { headers: { cookie: cookies } });
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO workout_executions (id, user_id, client_workout_id, state, started_at, ended_at, created_at, updated_at)
       VALUES ('wrk_hist_test', ?, 'cf-hist-test', 'completed',
               '2026-10-01T10:00:00.000Z', '2026-10-01T10:30:00.000Z', ?, ?)`,
    )
      .bind(me.body.user.id, now, now)
      .run();

    const res = await json<{
      workouts: Array<{
        id: string;
        started_at: string;
        duration_seconds: number;
        executed_sets: number;
      }>;
    }>('/workouts/history', { headers: { cookie: cookies } });
    expect(res.status).toBe(200);
    expect(res.body.workouts).toHaveLength(1);
    const w = res.body.workouts[0];
    expect(w.id).toBe('wrk_hist_test');
    expect(w.started_at).toBe('2026-10-01T10:00:00.000Z');
    expect(w.duration_seconds).toBe(1800);
    expect(w.executed_sets).toBe(0);
  });
});
