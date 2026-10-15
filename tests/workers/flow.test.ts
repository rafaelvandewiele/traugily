/** Integration tests: onboarding flow, workout lifecycle, safety evaluation. */

import { SELF } from 'cloudflare:test';
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
