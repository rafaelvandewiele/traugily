/** Deterministic, idempotent application of sync events to workout state. */

import { newId, nowIso } from '../lib/ids';

export type SyncEvent = {
  clientEventId: string;
  eventType:
    | 'set_logged'
    | 'exercise_skipped'
    | 'exercise_reordered'
    | 'rest_started'
    | 'rest_ended'
    | 'workout_paused'
    | 'workout_resumed'
    | 'draft_note';
  payload: Record<string, unknown>;
  occurredAt: string;
  serverVersion: number;
};

export async function applySyncEvent(
  db: D1Database,
  workoutId: string,
  event: SyncEvent,
): Promise<{ applied: boolean; note?: string }> {
  const existing = await db
    .prepare(`SELECT id FROM workout_sync_events WHERE workout_id = ? AND client_event_id = ?`)
    .bind(workoutId, event.clientEventId)
    .first<{ id: string }>();
  if (existing) return { applied: false, note: 'duplicate_event' };

  const now = nowIso();

  switch (event.eventType) {
    case 'set_logged': {
      const p = event.payload as {
        performedExerciseId?: string;
        exerciseId?: string;
        setIndex?: number;
        weightKg?: number | null;
        reps?: number | null;
        rpe?: number | null;
        rir?: number | null;
        status?: string;
        note?: string | null;
      };
      let peId = p.performedExerciseId;
      if (!peId && p.exerciseId) {
        const pe = await db
          .prepare(`SELECT id FROM performed_exercises WHERE workout_id = ? AND exercise_id = ?`)
          .bind(workoutId, p.exerciseId)
          .first<{ id: string }>();
        peId = pe?.id;
      }
      if (!peId || !p.setIndex) {
        await recordEvent(db, workoutId, event, now);
        return { applied: false, note: 'missing_reference' };
      }
      // Planned values (planned_set_id) are preserved; actuals are stored separately.
      await db
        .prepare(
          `INSERT INTO set_logs (id, workout_id, performed_exercise_id, set_index, actual_weight_kg,
             actual_reps, actual_rpe, actual_rir, status, note, client_event_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workout_id, performed_exercise_id, set_index) DO UPDATE SET
             actual_weight_kg = excluded.actual_weight_kg, actual_reps = excluded.actual_reps,
             actual_rpe = excluded.actual_rpe, actual_rir = excluded.actual_rir,
             status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
        )
        .bind(
          newId('stl'),
          workoutId,
          peId,
          p.setIndex,
          p.weightKg ?? null,
          p.reps ?? null,
          p.rpe ?? null,
          p.rir ?? null,
          p.status ?? 'completed',
          p.note ?? null,
          event.clientEventId,
          now,
          now,
        )
        .run();
      if ((p.reps ?? 0) > 0 || (p.weightKg ?? 0) > 0) {
        await db
          .prepare(
            `UPDATE performed_exercises SET status = 'completed' WHERE id = ? AND status = 'pending'`,
          )
          .bind(peId)
          .run();
      }
      break;
    }

    case 'exercise_skipped': {
      const p = event.payload as { exerciseId?: string; reason?: string; note?: string };
      if (p.exerciseId) {
        await db
          .prepare(
            `UPDATE performed_exercises SET status = 'skipped', skip_reason = ?, skip_note = ?
             WHERE workout_id = ? AND exercise_id = ?`,
          )
          .bind(p.reason ?? 'no_reason', p.note ?? null, workoutId, p.exerciseId)
          .run();
      }
      break;
    }

    case 'exercise_reordered': {
      const order = (event.payload.order as string[] | undefined) ?? [];
      for (let i = 0; i < order.length; i++) {
        await db
          .prepare(
            `UPDATE performed_exercises SET actual_position = ?
             WHERE workout_id = ? AND exercise_id = ?`,
          )
          .bind(i + 1, workoutId, order[i])
          .run();
      }
      break;
    }

    case 'rest_started': {
      const p = event.payload as { setLogId?: string; plannedSeconds?: number };
      await db
        .prepare(
          `INSERT INTO rest_logs (id, workout_id, set_log_id, planned_seconds, started_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          newId('rst'),
          workoutId,
          p.setLogId ?? null,
          p.plannedSeconds ?? null,
          event.occurredAt,
        )
        .run();
      break;
    }

    case 'rest_ended': {
      const p = event.payload as {
        restLogId?: string;
        actualSeconds?: number;
        pausedSeconds?: number;
        adjusted?: boolean;
        skipped?: boolean;
      };
      if (p.restLogId) {
        await db
          .prepare(
            `UPDATE rest_logs SET ended_at = ?, actual_seconds = ?, paused_seconds = ?,
               adjusted = ?, skipped = ? WHERE id = ? AND workout_id = ?`,
          )
          .bind(
            event.occurredAt,
            p.actualSeconds ?? null,
            p.pausedSeconds ?? 0,
            p.adjusted ? 1 : 0,
            p.skipped ? 1 : 0,
            p.restLogId,
            workoutId,
          )
          .run();
      }
      break;
    }

    case 'workout_paused':
    case 'workout_resumed':
    case 'draft_note':
      break;
  }

  await recordEvent(db, workoutId, event, now);
  await db
    .prepare(
      `UPDATE workout_executions SET updated_at = ?, server_version = server_version + 1 WHERE id = ?`,
    )
    .bind(now, workoutId)
    .run();
  return { applied: true };
}

async function recordEvent(
  db: D1Database,
  workoutId: string,
  event: SyncEvent,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workout_sync_events (id, workout_id, client_event_id, event_type, payload, applied_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('wse'),
      workoutId,
      event.clientEventId,
      event.eventType,
      JSON.stringify(event.payload),
      now,
    )
    .run();
}
