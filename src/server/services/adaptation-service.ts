/** Adaptation evaluation: run domain engine on completed workouts, persist proposals. */

import type { Env } from '../env';
import {
  evaluateAdaptations,
  type AdaptationProposal,
  type CompletedSessionSignal,
  type CompletedSetSignal,
} from '../../domain/adaptation-engine';
import { newId, nowIso, todayIso } from '../lib/ids';

export async function runAdaptationEvaluation(
  env: Env,
  userId: string,
): Promise<AdaptationProposal[]> {
  const db = env.DB;
  const flag = await db
    .prepare(`SELECT enabled FROM feature_flags WHERE key = 'adaptation_proposals'`)
    .first<{ enabled: number }>();
  if (!flag?.enabled) return [];

  // Only completed, closed workouts are read as signals — never edited.
  const workouts = await db
    .prepare(
      `SELECT id, started_at FROM workout_executions
       WHERE user_id = ? AND state = 'completed'
       ORDER BY started_at DESC LIMIT 6`,
    )
    .bind(userId)
    .all<{ id: string; started_at: string }>();

  const history: CompletedSessionSignal[] = [];
  for (const w of workouts.results) {
    const [sets, skips, pain, discomfort] = await Promise.all([
      db
        .prepare(
          `SELECT sl.set_index, ps.planned_reps, ps.planned_weight_kg, sl.actual_weight_kg,
                  sl.actual_reps, sl.status, sl.actual_rpe, pe.exercise_id
           FROM set_logs sl
           JOIN performed_exercises pe ON pe.id = sl.performed_exercise_id
           LEFT JOIN planned_sets ps ON ps.id = sl.planned_set_id
           WHERE sl.workout_id = ?`,
        )
        .bind(w.id)
        .all<{
          set_index: number;
          planned_reps: number | null;
          planned_weight_kg: number | null;
          actual_weight_kg: number | null;
          actual_reps: number | null;
          status: string;
          actual_rpe: number | null;
          exercise_id: string;
        }>(),
      db
        .prepare(
          `SELECT exercise_id, skip_reason FROM performed_exercises
           WHERE workout_id = ? AND status = 'skipped'`,
        )
        .bind(w.id)
        .all<{ exercise_id: string; skip_reason: string | null }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM pain_reports
           WHERE workout_id = ? AND severity IN ('pain','urgent')`,
        )
        .bind(w.id)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM pain_reports WHERE workout_id = ? AND severity = 'discomfort'`,
        )
        .bind(w.id)
        .first<{ n: number }>(),
    ]);

    const setSignals: CompletedSetSignal[] = sets.results.map((s) => ({
      exerciseId: s.exercise_id,
      setIndex: s.set_index,
      plannedReps: s.planned_reps,
      plannedWeightKg: s.planned_weight_kg,
      actualReps: s.actual_reps,
      actualWeightKg: s.actual_weight_kg,
      status: s.status as CompletedSetSignal['status'],
      actualRpe: s.actual_rpe,
    }));

    history.push({
      workoutId: w.id,
      date: w.started_at.slice(0, 10),
      sets: setSignals,
      skips: skips.results.map((s) => ({
        exerciseId: s.exercise_id,
        reason: s.skip_reason ?? 'no_reason',
      })),
      reportedDiscomfort: (discomfort?.n ?? 0) > 0,
      painReported: (pain?.n ?? 0) > 0,
      energyRating: null,
    });
  }

  const plan = await db
    .prepare(
      `SELECT id, current_version_id FROM plans WHERE user_id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(userId)
    .first<{ id: string; current_version_id: string | null }>();
  if (!plan?.current_version_id) return [];

  const [upcoming, currentPlanSets, weightTrend, goals] = await Promise.all([
    db
      .prepare(
        `SELECT scheduled_date FROM scheduled_sessions
         WHERE version_id = ? AND kind = 'workout' AND status = 'planned' AND scheduled_date >= ?
         ORDER BY scheduled_date LIMIT 8`,
      )
      .bind(plan.current_version_id, todayIso())
      .all<{ scheduled_date: string }>(),
    db
      .prepare(
        `SELECT ps.planned_reps, ps.planned_weight_kg, se.exercise_id
         FROM scheduled_sessions ss
         JOIN session_exercises se ON se.session_id = ss.id
         JOIN planned_sets ps ON ps.session_exercise_id = se.id
         WHERE ss.version_id = ? AND ss.scheduled_date >= ? AND ss.status = 'planned'`,
      )
      .bind(plan.current_version_id, todayIso())
      .all<{
        planned_reps: number | null;
        planned_weight_kg: number | null;
        exercise_id: string;
      }>(),
    db
      .prepare(
        `SELECT entry_date, weight_kg FROM weigh_ins
         WHERE user_id = ? AND skipped = 0 ORDER BY entry_date DESC LIMIT 8`,
      )
      .bind(userId)
      .all<{ entry_date: string; weight_kg: number }>(),
    db
      .prepare(`SELECT goal_type FROM goals WHERE user_id = ? ORDER BY priority`)
      .bind(userId)
      .all<{ goal_type: string }>(),
  ]);

  const byExercise = new Map<
    string,
    {
      exerciseId: string;
      plannedReps: number | null;
      plannedWeightKg: number | null;
      setsPerExercise: number;
    }
  >();
  for (const row of currentPlanSets.results) {
    const entry = byExercise.get(row.exercise_id) ?? {
      exerciseId: row.exercise_id,
      plannedReps: row.planned_reps,
      plannedWeightKg: row.planned_weight_kg,
      setsPerExercise: 0,
    };
    entry.setsPerExercise += 1;
    byExercise.set(row.exercise_id, entry);
  }

  const proposals = evaluateAdaptations({
    history,
    upcomingDates: upcoming.results.map((u) => u.scheduled_date),
    currentPlan: { exercises: [...byExercise.values()] },
    weightTrend: weightTrend.results
      .map((w) => ({ date: w.entry_date, weightKg: w.weight_kg }))
      .reverse(),
    goalTypes: goals.results.map((g) => g.goal_type),
  });

  // Persist proposals idempotently: skip when an identical pending proposal exists.
  const now = nowIso();
  for (const proposal of proposals) {
    const exists = await db
      .prepare(
        `SELECT id FROM adaptation_proposals
         WHERE user_id = ? AND trigger_code = ? AND status = 'pending'
           AND created_at > datetime('now', '-1 day')`,
      )
      .bind(userId, proposal.triggerCode)
      .first<{ id: string }>();
    if (exists) continue;
    const proposalId = newId('ada');
    await db
      .prepare(
        `INSERT INTO adaptation_proposals (id, user_id, plan_id, trigger_code, reason_key,
           changed_fields, effective_date, plan_version_at_creation, explanation_key,
           explanation_params, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .bind(
        proposalId,
        userId,
        plan.id,
        proposal.triggerCode,
        proposal.reasonKey,
        JSON.stringify(proposal.changedFields),
        proposal.effectiveDate,
        plan.current_version_id,
        proposal.explanationKey,
        JSON.stringify(proposal.explanationParams),
        now,
      )
      .run();
    for (const signal of proposal.signals) {
      await db
        .prepare(
          `INSERT INTO adaptation_source_signals (id, proposal_id, signal_code, signal_data, observed_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(newId('sig'), proposalId, signal.signalCode, JSON.stringify(signal.data), now)
        .run();
    }
  }

  return proposals;
}
