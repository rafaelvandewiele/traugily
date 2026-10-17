/** E2E: offline logging → IndexedDB persistence → reconnect → conflict → explicit resolution. */

import { test, expect } from '@playwright/test';
import { setupMemberWithPlan, loginInPage } from './helpers';

type StateBody = {
  exercises: Array<{
    exercise_id: string;
    sets: Array<{ set_index: number; actual_weight_kg: number | null; actual_reps: number | null }>;
  }>;
};

test.describe('offline workout sync (scenario #3)', () => {
  test('persists offline sets, surfaces conflicts, and resolves without silent overwrites', async ({
    page,
    request,
    context,
  }) => {
    const email = `e2e-offline-${Date.now()}@test.dev`;
    const { cookieHeader, csrf } = await setupMemberWithPlan(request, email);
    await loginInPage(page, cookieHeader);

    // Start from Today (≤2 interactions).
    await page.getByTestId('begin-workout').click();
    await expect(page.getByTestId('workout-player')).toBeVisible();
    const workoutId = new URL(page.url()).pathname.split('/').pop()!;

    const apiHeaders = {
      cookie: cookieHeader,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    };
    const fetchState = async (): Promise<StateBody> => {
      const res = await request.get(`/api/v1/workouts/${workoutId}/state`, {
        headers: { cookie: cookieHeader },
      });
      expect(res.status()).toBe(200);
      return (await res.json()) as StateBody;
    };

    const initial = await fetchState();
    const exerciseId = initial.exercises[0].exercise_id;

    // "Another device" logs set 2 while we are still online (server version bumps).
    const otherDevice = await request.post(`/api/v1/workouts/${workoutId}/sets`, {
      headers: apiHeaders,
      data: {
        exerciseId,
        setIndex: 2,
        actualWeightKg: 60,
        actualReps: 8,
        status: 'completed',
        clientEventId: `evt-other-${workoutId}-s2`,
      },
    });
    expect(otherDevice.status()).toBe(200);

    // --- Go offline: log set 1 from the UI ---
    await context.setOffline(true);
    await page
      .getByLabel(/weight kg/)
      .first()
      .fill('42');
    await page.getByLabel('Set 1 reps').fill('5');
    await page.getByTestId('save-set-1').click();
    await expect(page.getByTestId('sync-status-local')).toBeVisible();

    // Explicit local persistence: the event queue exists in IndexedDB.
    const queuedCount = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('traugily');
          open.onsuccess = () => {
            const db = open.result;
            try {
              const tx = db.transaction('events', 'readonly');
              const count = tx.objectStore('events').count();
              count.onsuccess = () => {
                resolve(count.result);
                db.close();
              };
              count.onerror = () => resolve(-1);
            } catch {
              resolve(-1);
            }
          };
          open.onerror = () => resolve(-1);
        }),
    );
    expect(queuedCount).toBeGreaterThan(0);

    // --- Reconnect: stale base version → visible conflict, nothing overwritten ---
    await context.setOffline(false);
    await expect(page.getByTestId('sync-status-attention')).toBeVisible();
    await expect(page.getByTestId('sync-conflict')).toBeVisible();

    const conflicted = await fetchState();
    const cSets = conflicted.exercises[0].sets;
    expect(cSets.find((s) => s.set_index === 2)?.actual_weight_kg).toBe(60); // other device intact
    expect(cSets.find((s) => s.set_index === 1)?.actual_weight_kg).toBeNull(); // ours not pushed yet

    // --- Resolution A: keep this device's changes (explicit rebase) ---
    await page.getByTestId('conflict-keep-local').click();
    await expect(page.getByTestId('sync-status-synced')).toBeVisible();
    await expect(page.getByTestId('sync-conflict')).toBeHidden();

    const afterKeepLocal = await fetchState();
    const aSets = afterKeepLocal.exercises[0].sets;
    expect(aSets.find((s) => s.set_index === 1)?.actual_weight_kg).toBe(42); // ours
    expect(aSets.find((s) => s.set_index === 2)?.actual_weight_kg).toBe(60); // theirs kept too

    // --- Second conflict: resolve the other way (keep the other device) ---
    // Other device updates set 1 (server version bumps again).
    const otherUpdate = await request.post(`/api/v1/workouts/${workoutId}/sets`, {
      headers: apiHeaders,
      data: {
        exerciseId,
        setIndex: 1,
        actualWeightKg: 50,
        actualReps: 6,
        status: 'completed',
        clientEventId: `evt-other-${workoutId}-s1-v2`,
      },
    });
    expect(otherUpdate.status()).toBe(200);

    await context.setOffline(true);
    await page
      .getByLabel(/weight kg/)
      .first()
      .fill('45');
    await page.getByLabel('Set 1 reps').fill('6');
    await page.getByTestId('save-set-1').click();
    await expect(page.getByTestId('sync-status-local')).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByTestId('sync-conflict')).toBeVisible();

    // Two-step destructive choice requires confirmation before discarding.
    await page.getByTestId('conflict-keep-remote').click();
    await expect(page.getByTestId('conflict-confirm-remote')).toBeVisible();
    await page.getByTestId('conflict-confirm-remote').click();
    await expect(page.getByTestId('sync-status-synced')).toBeVisible();
    await expect(page.getByTestId('sync-conflict')).toBeHidden();

    // The other device's value wins as explicitly chosen; our queued value is gone.
    const afterKeepRemote = await fetchState();
    expect(afterKeepRemote.exercises[0].sets.find((s) => s.set_index === 1)?.actual_weight_kg).toBe(
      50,
    );

    // Queue fully drained — reconnecting produces no further conflict.
    await context.setOffline(true);
    await context.setOffline(false);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('sync-conflict')).toBeHidden();
  });
});
