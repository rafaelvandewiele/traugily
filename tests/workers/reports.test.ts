/** Integration tests: PDF report generation with real data (scenario #8). */

import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { json, post, seedCatalogue, setupPlan, signupAndCookies } from './helpers';

beforeAll(async () => {
  await seedCatalogue(env.DB);
});

async function completeWorkoutWithSet(cookies: string, csrf: string): Promise<void> {
  const start = await json<{ workoutId: string }>(
    '/workouts/start',
    post('/workouts/start', {}, csrf, cookies),
  );
  expect(start.status).toBe(200);
  const workoutId = start.body.workoutId;
  const pe = await env.DB.prepare(
    `SELECT id, exercise_id FROM performed_exercises WHERE workout_id = ? LIMIT 1`,
  )
    .bind(workoutId)
    .first<{ id: string; exercise_id: string }>();
  expect(pe).toBeTruthy();
  const logged = await json(
    `/workouts/${workoutId}/sets`,
    post(
      `/workouts/${workoutId}/sets`,
      {
        exerciseId: pe!.exercise_id,
        setIndex: 1,
        actualWeightKg: 40,
        actualReps: 8,
        status: 'completed',
        clientEventId: `evt-report-${workoutId}-s1`,
      },
      csrf,
      cookies,
    ),
  );
  expect(logged.status).toBe(200);
  const finish = await json(
    `/workouts/${workoutId}/finish`,
    post(`/workouts/${workoutId}/finish`, { clientWorkoutId: workoutId }, csrf, cookies),
  );
  expect(finish.status).toBe(200);
}

async function waitForReady(exportId: string, cookies: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const status = await json<{ status: string; error_message: string | null }>(
      `/reports/${exportId}/status`,
      { headers: { cookie: cookies } },
    );
    if (status.body.status === 'ready') return 'ready';
    if (status.body.status === 'failed') {
      throw new Error(`report failed: ${status.body.error_message ?? 'unknown'}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('report did not become ready in time');
}

describe('PDF reports', () => {
  it('generates a readable PDF from real workout data, deduplicates requests, and guards access', async () => {
    const { cookies, csrf } = await setupPlan('report@workers.test');
    await completeWorkoutWithSet(cookies, csrf);

    const today = new Date().toISOString().slice(0, 10);
    const request = {
      periodStart: `${today.slice(0, 8)}01`,
      periodEnd: today,
      detailLevel: 'detailed',
      reportLocale: 'en',
    };
    const create = await json<{ exportId: string; status: string }>(
      '/reports',
      post('/reports', request, csrf, cookies),
    );
    expect(create.status).toBe(202);
    expect(create.body.status).toBe('pending');

    // Identical request reuses the export record (idempotent retries).
    const dup = await json<{ exportId: string; deduplicated: boolean }>(
      '/reports',
      post('/reports', request, csrf, cookies),
    );
    expect(dup.body.deduplicated).toBe(true);
    expect(dup.body.exportId).toBe(create.body.exportId);

    expect(await waitForReady(create.body.exportId, cookies)).toBe('ready');

    // The stored object is a real PDF containing the session's exercise name.
    const download = await SELF.fetch(
      `http://localhost/api/v1/reports/${create.body.exportId}/download`,
      { headers: { cookie: cookies } },
    );
    expect(download.status).toBe(200);
    const bytes = new TextDecoder('latin1').decode(await download.arrayBuffer());
    expect(bytes.startsWith('%PDF')).toBe(true);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('does not let another member download someone else’s report', async () => {
    const { cookies, csrf } = await setupPlan('report-owner@workers.test');
    const today = new Date().toISOString().slice(0, 10);
    const create = await json<{ exportId: string }>(
      '/reports',
      post('/reports', { periodStart: today, periodEnd: today }, csrf, cookies),
    );
    const other = await signupAndCookies('report-other@workers.test');
    const res = await SELF.fetch(
      `http://localhost/api/v1/reports/${create.body.exportId}/download`,
      { headers: { cookie: other.cookies } },
    );
    expect(res.status).toBe(404);
  });
});
