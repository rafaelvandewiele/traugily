/** Plan persistence: generate deterministic plan, store versions/sessions/sets/targets. */

import type { PlanDraft } from '../../shared/contracts';
import { generatePlan } from '../../domain/plan-engine';
import { validatePlanDraft } from '../../domain/plan-validate';
import type { PlanGeneratorInput, PlanRuleViolation } from '../../domain/plan-types';
import { applyNutritionFloors, DEFAULT_NUTRITION_FLOORS } from '../../domain/nutrition-targets';
import { newId, nowIso } from '../lib/ids';

export { diffPlanLength } from '../../domain/plan-engine';
export { validatePlanDraft } from '../../domain/plan-validate';

export type StoredPlan = {
  planId: string;
  versionId: string;
  version: number;
  draft: PlanDraft;
};

export async function generateAndStorePlan(
  db: D1Database,
  userId: string,
  input: PlanGeneratorInput,
  createdBy: 'system' | 'member' | 'admin',
): Promise<{ plan: StoredPlan; violations: PlanRuleViolation[] }> {
  const draft = generatePlan(input);
  const violations = validatePlanDraft(draft, input);
  const now = nowIso();

  const planId = newId('pln');
  const versionId = newId('plv');

  await db
    .prepare(
      `INSERT INTO plans (id, user_id, status, goal_duration_weeks, current_version_id,
         assessment_json, nutrition_framework, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      planId,
      userId,
      draft.goalDurationWeeks,
      versionId,
      JSON.stringify({
        experience: input.experienceLevel,
        assumptions: draft.assumptions,
        generatedAt: now,
      }),
      JSON.stringify(draft.nutritionFramework),
      now,
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO plan_versions (id, plan_id, version, reason, created_by, created_at)
       VALUES (?, ?, 1, 'initial_generation', ?, ?)`,
    )
    .bind(versionId, planId, createdBy, now)
    .run();

  await storePlanDraft(db, userId, versionId, draft);

  for (const shift of draft.nutritionFramework.phaseShifts) {
    const floored = applyNutritionFloors(
      {
        energyKcal: shift.energyKcal,
        proteinG: shift.proteinG,
        carbsG: shift.carbsG,
        fatG: shift.fatG,
      },
      input.sex,
      DEFAULT_NUTRITION_FLOORS,
    );
    const phase = draft.phases.find((p) => p.phaseKey === shift.phaseKey);
    await db
      .prepare(
        `INSERT INTO nutrition_targets (id, user_id, plan_id, phase_key, effective_from, effective_to,
           energy_kcal, protein_g, carbs_g, fat_g, detail_level, basis, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId('ntg'),
        userId,
        planId,
        shift.phaseKey,
        phase?.startDate ?? input.startDate,
        phase?.endDate ?? null,
        floored.target.energyKcal,
        floored.target.proteinG,
        floored.target.carbsG,
        floored.target.fatG,
        draft.nutritionFramework.detailLevel,
        floored.floored ? 'estimate_floored' : 'estimate',
        now,
      )
      .run();
  }

  return { plan: { planId, versionId, version: 1, draft }, violations };
}

export async function storePlanDraft(
  db: D1Database,
  userId: string,
  versionId: string,
  draft: PlanDraft,
): Promise<void> {
  const now = nowIso();

  // Engine ids are deterministic and therefore only unique within one plan
  // (e.g. `set_sess_2026-10-15_1_ex_bench_1`). The database primary keys are
  // global, so two members — or two versions of the same plan — with the same
  // start date and training weekdays would collide. Prefix every id with the
  // globally unique versionId. Mutating in place keeps the draft returned to
  // the client consistent with the persisted rows.
  for (const session of draft.sessions) {
    session.id = `${versionId}_${session.id}`;
    for (const ex of session.exercises) {
      ex.id = `${versionId}_${ex.id}`;
      for (const set of ex.sets) {
        set.id = `${versionId}_${set.id}`;
      }
    }
  }

  for (const phase of draft.phases) {
    await db
      .prepare(
        `INSERT INTO plan_phases (id, version_id, phase_key, title_key, purpose, start_date, end_date,
           position, config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
      )
      .bind(
        newId('pha'),
        versionId,
        phase.phaseKey,
        phase.titleKey,
        phase.purpose,
        phase.startDate,
        phase.endDate,
        phase.position,
      )
      .run();
  }

  for (const ws of draft.weeklySchedule) {
    await db
      .prepare(
        `INSERT INTO weekly_schedules (id, version_id, weekday, kind, label_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId('wsch'),
        versionId,
        ws.weekday,
        ws.kind === 'training' ? 'training' : 'rest',
        ws.labelKey,
        now,
      )
      .run();
  }

  for (const session of draft.sessions) {
    const sessionId = newId('scs');
    await db
      .prepare(
        `INSERT INTO scheduled_sessions (id, version_id, user_id, scheduled_date, weekday, kind,
           title_key, focus_key, duration_minutes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'workout', ?, ?, ?, 'planned', ?, ?)`,
      )
      .bind(
        sessionId,
        versionId,
        userId,
        session.scheduledDate,
        session.weekday,
        session.titleKey,
        session.focusKey,
        session.durationMinutes,
        now,
        now,
      )
      .run();

    for (const ex of session.exercises) {
      const seId = newId('sxe');
      await db
        .prepare(
          `INSERT INTO session_exercises (id, session_id, exercise_id, position, planned_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(seId, sessionId, ex.exerciseId, ex.position, ex.plannedOrder, now)
        .run();
      for (const set of ex.sets) {
        await db
          .prepare(
            `INSERT INTO planned_sets (id, session_exercise_id, set_index, planned_reps, planned_weight_kg,
               planned_duration_seconds, planned_rpe, planned_rir, rest_seconds, set_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            set.id,
            seId,
            set.setIndex,
            set.plannedReps,
            set.plannedWeightKg,
            set.plannedDurationSeconds,
            set.plannedRpe,
            set.plannedRir,
            set.restSeconds,
            set.setType,
            now,
          )
          .run();
      }
    }
  }
}
