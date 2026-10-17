/** Offline-safe workout sync: idempotent event application + visible conflict detection. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { syncWorkoutSchema } from '../../shared/contracts';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { recordOperationalEvent } from '../lib/audit';
import { applySyncEvent } from '../services/workout-sync';

export const workoutSyncRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

workoutSyncRoutes.post('/:id/sync', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const workoutId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = syncWorkoutSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Sync payload is invalid. Please retry from the app.');

  const workout = await c.env.DB.prepare(
    `SELECT id, user_id, server_version, state FROM workout_executions WHERE id = ?`,
  )
    .bind(workoutId)
    .first<{ id: string; user_id: string; server_version: number; state: string }>();
  if (!workout || workout.user_id !== auth.user.id) throw notFound('Workout not found.');
  if (workout.state !== 'in_progress') {
    throw conflict(
      'This workout is already finished. New changes are not accepted.',
      'workout_closed',
    );
  }

  const baseVersion = parsed.data.baseServerVersion;
  const rebase = parsed.data.rebase === true;
  if (baseVersion !== workout.server_version && !rebase) {
    // Never silently overwrite: return server state so the client resolves visibly.
    const serverState = await loadWorkoutState(c.env, workout.id);
    await recordOperationalEvent(c.env.DB, {
      kind: 'sync_conflict',
      severity: 'warning',
      subject: workout.id,
      detail: {
        baseVersion,
        serverVersion: workout.server_version,
        eventCount: parsed.data.events.length,
      },
      requestId: c.get('requestId'),
    });
    return c.json(
      {
        error: {
          code: 'version_conflict',
          message:
            'This workout changed on another device. Nothing was overwritten — choose which version to keep.',
        },
        conflict: {
          clientBaseVersion: baseVersion,
          serverVersion: workout.server_version,
          serverState,
        },
      },
      409,
    );
  }
  if (rebase && baseVersion !== workout.server_version) {
    // The member explicitly chose "keep this device's changes" after seeing
    // the conflict — auditable, never a silent overwrite.
    await recordOperationalEvent(c.env.DB, {
      kind: 'sync_rebased',
      severity: 'info',
      subject: workout.id,
      detail: {
        baseVersion,
        serverVersion: workout.server_version,
        eventCount: parsed.data.events.length,
        resolution: 'local_device',
      },
      requestId: c.get('requestId'),
    });
  }

  const results = [];
  let newVersion = workout.server_version;
  for (const event of parsed.data.events) {
    const applied = await applySyncEvent(c.env.DB, workout.id, event);
    if (applied.applied) newVersion += 1;
    results.push({
      clientEventId: event.clientEventId,
      applied: applied.applied,
      note: applied.note,
    });
  }

  if (parsed.data.draftState) {
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO workout_drafts (id, user_id, client_draft_id, state, device_state, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?)
       ON CONFLICT(user_id, client_draft_id) DO UPDATE SET device_state = excluded.device_state,
         updated_at = excluded.updated_at`,
    )
      .bind(
        newId('drf'),
        auth.user.id,
        `${workoutId}-draft`,
        JSON.stringify(parsed.data.draftState),
        now,
        now,
      )
      .run();
  }

  return c.json({ workoutId: workout.id, serverVersion: newVersion, events: results });
});

async function loadWorkoutState(env: Env, workoutId: string) {
  const exercises = await env.DB.prepare(
    `SELECT pe.id, pe.exercise_id, pe.actual_position, pe.status, pe.skip_reason, e.name_en
     FROM performed_exercises pe JOIN exercises e ON e.id = pe.exercise_id
     WHERE pe.workout_id = ? ORDER BY pe.actual_position`,
  )
    .bind(workoutId)
    .all();
  const sets = await env.DB.prepare(
    `SELECT id, performed_exercise_id, set_index, actual_weight_kg, actual_reps, status
     FROM set_logs WHERE workout_id = ? ORDER BY performed_exercise_id, set_index`,
  )
    .bind(workoutId)
    .all();
  return { exercises: exercises.results, sets: sets.results };
}
