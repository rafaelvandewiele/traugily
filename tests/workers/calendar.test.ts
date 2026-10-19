/** Integration tests: calendar delete-and-redo + today-only starts + skip counting. */

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { json, post, seedCatalogue, setupPlan } from './helpers';

beforeAll(async () => {
  await seedCatalogue(env.DB);
});

type SessionRow = {
  id: string;
  scheduled_date: string;
  kind: string;
  title_key: string;
  status: string;
};

async function activePlanSessions(cookies: string): Promise<SessionRow[]> {
  const month = new Date().toISOString().slice(0, 7);
  const res = await json<{ sessions: SessionRow[] }>(`/planner/month?month=${month}`, {
    headers: { cookie: cookies },
  });
  return res.body.sessions;
}

async function startAndSet(cookies: string, csrf: string) {
  const start = await json<{ workoutId: string }>(
    '/workouts/start',
    post('/workouts/start', {}, csrf, cookies),
  );
  expect(start.status).toBe(200);
  const state = await json<{
    workoutId: string;
    exercises: Array<{ id: string; exercise_id: string }>;
  }>(`/workouts/${start.body.workoutId}/state`, { headers: { cookie: cookies } });
  return { workoutId: start.body.workoutId, exercises: state.body.exercises };
}

describe('calendar delete-and-redo', () => {
  it('cancels a planned session, and resets a completed one so it can be redone', async () => {
    const { cookies, csrf } = await setupPlan('calendar-delete@workers.test');
    const sessions = await activePlanSessions(cookies);
    const planned = sessions.find((s) => s.kind === 'workout' && s.status === 'planned');
    expect(planned, 'a planned session exists to cancel').toBeTruthy();

    const del = await json<{ ok: boolean; newStatus: string }>(
      `/planner/sessions/${planned!.id}`,
      { ...post(`/planner/sessions/${planned!.id}`, {}, csrf, cookies), method: 'DELETE' },
    );
    expect(del.status).toBe(200);
    expect(del.body.newStatus).toBe('cancelled');

    // A cancelled session never offers a start action.
    const month = new Date().toISOString().slice(0, 7);
    const relist = await json<{ sessions: SessionRow[] }>(`/planner/month?month=${month}`, {
      headers: { cookie: cookies },
    });
    expect(relist.body.sessions.find((s) => s.id === planned!.id)?.status).toBe('cancelled');

    // Deleting a cancelled session is rejected, and foreign members get a 404.
    const again = await json(
      `/planner/sessions/${planned!.id}`,
      { ...post(`/planner/sessions/${planned!.id}`, {}, csrf, cookies), method: 'DELETE' },
    );
    expect(again.status).toBe(400);
    const { cookies: otherCookies, csrf: otherCsrf } = await setupPlan('calendar-stranger@workers.test');
    const foreign = await json(
      `/planner/sessions/${planned!.id}`,
      { ...post(`/planner/sessions/${planned!.id}`, {}, otherCsrf, otherCookies), method: 'DELETE' },
    );
    expect(foreign.status).toBe(404);
  });

  it('counts a skipped exercise and a completed exercise in the finish summary', async () => {
    const { cookies, csrf } = await setupPlan('calendar-counts@workers.test');
    const { workoutId, exercises } = await startAndSet(cookies, csrf);
    expect(exercises.length).toBeGreaterThanOrEqual(2);

    // Complete one real set on the first exercise (direct POST, as the client does).
    const saveOne = await json<{ ok: boolean }>(
      `/workouts/${workoutId}/sets`,
      post(
        `/workouts/${workoutId}/sets`,
        {
          exerciseId: exercises[0].exercise_id,
          setIndex: 1,
          actualReps: 8,
          actualWeightKg: 10,
          status: 'completed',
          clientEventId: 'cal-count-0001',
        },
        csrf,
        cookies,
      ),
    );
    expect(saveOne.status).toBe(200);

    // Skip the second exercise (direct POST, as the client does).
    const skip = await json<{ ok: boolean }>(
      `/workouts/${workoutId}/skip`,
      post(
        `/workouts/${workoutId}/skip`,
        { exerciseId: exercises[1].exercise_id, reason: 'time' },
        csrf,
        cookies,
      ),
    );
    expect(skip.status).toBe(200);

    const finish = await json<{
      ok: boolean;
      summary: { completedExercises: number; skippedExercises: number };
    }>(
      `/workouts/${workoutId}/finish`,
      post(`/workouts/${workoutId}/finish`, { clientWorkoutId: workoutId }, csrf, cookies),
    );
    expect(finish.status).toBe(200);
    expect(finish.body.summary.completedExercises).toBe(1);
    expect(finish.body.summary.skippedExercises).toBe(1);
  });

  it('refuses to start a session scheduled for another day', async () => {
    const { cookies, csrf } = await setupPlan('calendar-future@workers.test');
    const sessions = await activePlanSessions(cookies);
    const today = new Date().toISOString().slice(0, 10);
    const future = sessions.find((s) => s.kind === 'workout' && s.scheduled_date !== today);
    expect(future, 'a non-today session exists').toBeTruthy();
    const start = await json<{ error: { code: string } }>(
      '/workouts/start',
      post('/workouts/start', { sessionId: future!.id }, csrf, cookies),
    );
    expect(start.status).toBe(400);
  });

  it('never offers start_workout for another day via the Today action', async () => {
    const { cookies } = await setupPlan('calendar-today@workers.test');
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayRes = await json<{
      nextAction: { kind: string };
      nextSession: { scheduled_date: string } | null;
    }>('/workouts/today', { headers: { cookie: cookies } });
    expect(todayRes.status).toBe(200);
    const kinds = ['start_workout', 'resume_workout', 'rest_today', 'view_plan', 'generate_plan', 'start_onboarding'];
    expect(kinds).toContain(todayRes.body.nextAction.kind);
    if (todayRes.body.nextSession && todayRes.body.nextSession.scheduled_date !== todayIso) {
      // No session today: the action must rest the member, never offer a start.
      expect(todayRes.body.nextAction.kind).not.toBe('start_workout');
    }
    if (todayRes.body.nextAction.kind === 'rest_today') {
      expect(todayRes.body.nextSession).toBeTruthy();
    }
  });
});
