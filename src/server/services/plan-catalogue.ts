/** Load catalogue, replacement rules and onboarding inputs for plan generation. */

import type { Env } from '../env';
import type { CatalogExercise, PlanGeneratorInput, ReplacementRule } from '../../domain/plan-types';

export async function loadCatalogue(db: D1Database): Promise<CatalogExercise[]> {
  const rows = await db
    .prepare(
      `SELECT id, slug, name_en, movement_pattern, primary_muscles, equipment, skill_level,
              safety_flags, replacement_group
       FROM exercises WHERE review_status = 'published' ORDER BY slug`,
    )
    .all<{
      id: string;
      slug: string;
      name_en: string;
      movement_pattern: string;
      primary_muscles: string;
      equipment: string;
      skill_level: string;
      safety_flags: string;
      replacement_group: string | null;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameEn: r.name_en,
    movementPattern: r.movement_pattern,
    primaryMuscles: JSON.parse(r.primary_muscles) as string[],
    equipment: JSON.parse(r.equipment) as string[],
    skillLevel: r.skill_level as CatalogExercise['skillLevel'],
    replacementGroup: r.replacement_group,
    safetyFlags: JSON.parse(r.safety_flags) as string[],
  }));
}

export async function loadReplacementRules(db: D1Database): Promise<ReplacementRule[]> {
  const rows = await db
    .prepare(
      `SELECT rr.exercise_id, rr.replacement_exercise_id, rg.slug, rr.priority
       FROM replacement_rules rr
       JOIN replacement_groups rg ON rg.id = rr.group_id
       WHERE rr.status = 'active'`,
    )
    .all<{
      exercise_id: string;
      replacement_exercise_id: string;
      slug: string;
      priority: number;
    }>();
  return rows.results.map((r) => ({
    exerciseId: r.exercise_id,
    replacementExerciseId: r.replacement_exercise_id,
    groupSlug: r.slug,
    priority: r.priority,
  }));
}

export async function loadPlanGeneratorInput(
  env: Env,
  userId: string,
  startDate: string,
): Promise<PlanGeneratorInput> {
  const db = env.DB;
  const [
    profile,
    goals,
    timeframe,
    training,
    availability,
    equipment,
    exclusions,
    catalogue,
    rules,
  ] = await Promise.all([
    db
      .prepare(`SELECT * FROM profiles WHERE user_id = ?`)
      .bind(userId)
      .first<Record<string, unknown>>(),
    db
      .prepare(`SELECT goal_type FROM goals WHERE user_id = ? ORDER BY priority`)
      .bind(userId)
      .all<{ goal_type: string }>(),
    db
      .prepare(`SELECT target_weeks FROM goal_timeframes WHERE user_id = ?`)
      .bind(userId)
      .first<{ target_weeks: number }>(),
    db
      .prepare(`SELECT experience_level FROM training_background WHERE user_id = ?`)
      .bind(userId)
      .first<{ experience_level: 'new' | 'returning' | 'experienced' }>(),
    db
      .prepare(`SELECT weekday, minutes FROM availability WHERE user_id = ?`)
      .bind(userId)
      .all<{ weekday: number; minutes: number | null }>(),
    db
      .prepare(`SELECT category FROM equipment WHERE user_id = ? AND status = 'available'`)
      .bind(userId)
      .all<{ category: string }>(),
    db
      .prepare(`SELECT exercise_id, replacement_group FROM exercise_exclusions WHERE user_id = ?`)
      .bind(userId)
      .all<{ exercise_id: string | null; replacement_group: string | null }>(),
    loadCatalogue(db),
    db
      .prepare(
        `SELECT snapshot FROM plan_rule_versions WHERE kind = 'plan_rules' AND status = 'active'
           ORDER BY version DESC LIMIT 1`,
      )
      .first<{ snapshot: string }>(),
  ]);

  const minutesFromAvailability = availability.results
    .map((a) => a.minutes)
    .find((m): m is number => !!m);

  return {
    startDate,
    goalDurationWeeks: timeframe?.target_weeks ?? 12,
    experienceLevel: training?.experience_level ?? 'new',
    preferredWeekdays: availability.results.map((a) => a.weekday),
    minutesPerSession: minutesFromAvailability ?? 45,
    sessionsPerWeek: Math.min(7, Math.max(2, availability.results.length)),
    goalTypes: goals.results.map((g) => g.goal_type),
    equipmentCategories: [...new Set(equipment.results.map((e) => e.category))],
    exclusions: exclusions.results.map((e) => ({
      exerciseId: e.exercise_id ?? undefined,
      replacementGroup: e.replacement_group ?? undefined,
    })),
    sex: (profile?.sex as PlanGeneratorInput['sex']) ?? undefined,
    heightCm: (profile?.height_cm as number | null) ?? null,
    weightKg: (profile?.weight_kg as number | null) ?? null,
    activityLevel: (profile?.activity_level as string) ?? 'light',
    catalogue,
    replacementRules: await loadReplacementRules(db),
    rules: rules ? parsePlanRules(rules.snapshot) : undefined,
  };
}

/**
 * Plan-rule snapshots are stored as JSON written by ops/admin tools; accept both
 * camelCase and snake_case keys so seeded content and app content both work.
 */
function parsePlanRules(raw: string): PlanGeneratorInput['rules'] {
  const j = JSON.parse(raw) as Record<string, unknown>;
  const num = (a: unknown, b: unknown, fallback: number): number => {
    const v = Number(a ?? b);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    minRestDaysPerWeek: num(j.minRestDaysPerWeek, j.min_rest_days_per_week, 1),
    maxConsecutiveHeavySameGroup: num(
      j.maxConsecutiveHeavySameGroup,
      j.max_consecutive_heavy_same_group,
      1,
    ),
    progressionRequiresCompletionRatio: num(
      j.progressionRequiresCompletionRatio,
      j.progression_requires_completion_ratio,
      0.85,
    ),
    deloadAfterFatigueStreak: num(j.deloadAfterFatigueStreak, j.deload_after_fatigue_streak, 3),
    shortPlanMinWeeks: num(j.shortPlanMinWeeks, j.short_plan_min_weeks, 4),
    shortPlanMaxWeeks: num(j.shortPlanMaxWeeks, j.short_plan_max_weeks, 12),
  };
}
