import type { PlanDraft, PlanPhase, ScheduledSessionPlan } from '../shared/contracts';

export type CatalogExercise = {
  id: string;
  slug: string;
  nameEn: string;
  movementPattern: string;
  primaryMuscles: string[];
  equipment: string[];
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  replacementGroup: string | null;
  safetyFlags: string[];
};

export type ReplacementRule = {
  exerciseId: string;
  replacementExerciseId: string;
  groupSlug: string;
  priority: number;
};

export type PlanRules = {
  minRestDaysPerWeek: number;
  maxConsecutiveHeavySameGroup: number;
  progressionRequiresCompletionRatio: number;
  deloadAfterFatigueStreak: number;
  shortPlanMinWeeks: number;
  shortPlanMaxWeeks: number;
};

export const DEFAULT_PLAN_RULES: PlanRules = {
  minRestDaysPerWeek: 1,
  maxConsecutiveHeavySameGroup: 1,
  progressionRequiresCompletionRatio: 0.85,
  deloadAfterFatigueStreak: 3,
  shortPlanMinWeeks: 4,
  shortPlanMaxWeeks: 12,
};

export type PlanGeneratorInput = {
  startDate: string;
  goalDurationWeeks: number;
  experienceLevel: 'new' | 'returning' | 'experienced';
  preferredWeekdays: number[];
  minutesPerSession: number;
  sessionsPerWeek: number;
  goalTypes: string[];
  equipmentCategories: string[];
  exclusions: Array<{ exerciseId?: string; replacementGroup?: string }>;
  sex: 'female' | 'male' | 'intersex' | 'prefer_not_to_say' | undefined;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: string;
  catalogue: CatalogExercise[];
  replacementRules: ReplacementRule[];
  rules?: PlanRules;
};

export type PlanRuleViolation = {
  rule: string;
  messageKey: string;
  params?: Record<string, string | number>;
};

export const PHASE_ORDER = [
  'orientation',
  'build_up',
  'progression',
  'consolidation',
  'review',
] as const;
export type PhaseKey = (typeof PHASE_ORDER)[number];

/** Configurable phase defaults per goal; orientation always first, review always last. */
export function phaseLayout(
  goalDurationWeeks: number,
  goalTypes: string[],
): Array<{ key: PhaseKey; weeks: number }> {
  const total = Math.max(4, Math.min(104, Math.round(goalDurationWeeks)));
  if (total <= 4) {
    const half = Math.max(1, Math.floor(total / 2));
    return [
      { key: 'orientation', weeks: half },
      { key: 'review', weeks: total - half },
    ];
  }
  if (total <= 8) {
    return [
      { key: 'orientation', weeks: 2 },
      { key: 'build_up', weeks: total - 4 },
      { key: 'review', weeks: 2 },
    ];
  }
  const orientation = 2;
  const review = 2;
  const middle = total - orientation - review;
  const wantsStrength = goalTypes.includes('strength') || goalTypes.includes('muscle_gain');
  if (wantsStrength) {
    return [
      { key: 'orientation', weeks: orientation },
      { key: 'build_up', weeks: Math.floor(middle / 2) },
      { key: 'progression', weeks: middle - Math.floor(middle / 2) },
      { key: 'review', weeks: review },
    ];
  }
  return [
    { key: 'orientation', weeks: orientation },
    { key: 'build_up', weeks: Math.ceil(middle * 0.6) },
    { key: 'consolidation', weeks: middle - Math.ceil(middle * 0.6) },
    { key: 'review', weeks: review },
  ];
}

export function equipmentAvailable(ex: CatalogExercise, owned: string[]): boolean {
  return ex.equipment.length === 0 || ex.equipment.some((e) => owned.includes(e));
}

export function isExcluded(
  ex: CatalogExercise,
  input: Pick<PlanGeneratorInput, 'exclusions'>,
): boolean {
  return input.exclusions.some(
    (x) =>
      (x.exerciseId && x.exerciseId === ex.id) ||
      (x.replacementGroup && x.replacementGroup === ex.replacementGroup),
  );
}

export type { PlanDraft, PlanPhase, ScheduledSessionPlan };
