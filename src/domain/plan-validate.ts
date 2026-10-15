import {
  DEFAULT_PLAN_RULES,
  equipmentAvailable,
  isExcluded,
  type CatalogExercise,
  type PlanGeneratorInput,
  type PlanRuleViolation,
  type PlanRules,
  type ReplacementRule,
} from './plan-types';
import type { PlanDraft } from '../shared/contracts';

/** Pick a safe replacement using replacement-group rules; null when none exists. */
export function findReplacement(
  exerciseId: string,
  input: {
    catalogue: CatalogExercise[];
    replacementRules: ReplacementRule[];
    equipmentCategories: string[];
  },
): CatalogExercise | null {
  const candidates = input.replacementRules
    .filter((r) => r.exerciseId === exerciseId)
    .sort((a, b) => b.priority - a.priority)
    .map((r) => input.catalogue.find((c) => c.id === r.replacementExerciseId))
    .filter((c): c is CatalogExercise => !!c)
    .filter((c) => equipmentAvailable(c, input.equipmentCategories));
  return candidates[0] ?? null;
}

/**
 * Validate a generated plan against deterministic safety rules.
 * Returns human-readable (i18n key) violations; empty array means the plan is allowed.
 */
export function validatePlanDraft(
  draft: PlanDraft,
  input: Pick<
    PlanGeneratorInput,
    'sessionsPerWeek' | 'equipmentCategories' | 'catalogue' | 'replacementRules' | 'exclusions'
  >,
  rules: PlanRules = DEFAULT_PLAN_RULES,
): PlanRuleViolation[] {
  const violations: PlanRuleViolation[] = [];

  if (draft.restDaysPerWeek < rules.minRestDaysPerWeek) {
    violations.push({
      rule: 'min_rest_days',
      messageKey: 'plan.violation.min_rest_days',
      params: { required: rules.minRestDaysPerWeek },
    });
  }

  // No same large-muscle-group heavy training on consecutive days.
  const heavyDays = draft.sessions
    .filter((s) => s.kind === 'workout')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const muscleByDate = new Map<string, Set<string>>();
  for (const s of heavyDays) {
    const set = new Set<string>();
    for (const ex of s.exercises) {
      const cat = input.catalogue.find((c) => c.id === ex.exerciseId);
      if (cat) for (const m of cat.primaryMuscles) set.add(m);
    }
    muscleByDate.set(s.scheduledDate, set);
  }
  const dates = [...muscleByDate.keys()].sort();
  for (let i = 1; i < dates.length; i++) {
    const prev = Date.parse(dates[i - 1] + 'T00:00:00Z');
    const cur = Date.parse(dates[i] + 'T00:00:00Z');
    if (cur - prev === 86_400_000) {
      const a = muscleByDate.get(dates[i - 1])!;
      const b = muscleByDate.get(dates[i])!;
      const overlap = [...a].filter((m) => b.has(m));
      if (overlap.length >= 2) {
        violations.push({
          rule: 'consecutive_heavy_same_group',
          messageKey: 'plan.violation.consecutive_heavy',
          params: { muscles: overlap.slice(0, 3).join(', ') },
        });
      }
    }
  }

  // Excluded exercises must never appear in a generated plan.
  for (const s of draft.sessions) {
    for (const ex of s.exercises) {
      if (input.exclusions.some((x) => x.exerciseId === ex.exerciseId)) {
        violations.push({
          rule: 'excluded_exercise_present',
          messageKey: 'plan.violation.excluded_present',
          params: { exercise: ex.nameEn },
        });
      }
      const cat = input.catalogue.find((c) => c.id === ex.exerciseId);
      if (cat && !isExcluded(cat, input)) continue;
      if (cat && isExcluded(cat, input)) {
        violations.push({
          rule: 'excluded_exercise_present',
          messageKey: 'plan.violation.excluded_present',
          params: { exercise: ex.nameEn },
        });
      }
    }
  }

  return violations;
}
