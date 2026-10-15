/** Unit tests: plan engine determinism, rest-day rules, exclusions, load invention. */

import { describe, expect, it } from 'vitest';
import { generatePlan } from '../../src/domain/plan-engine';
import { validatePlanDraft } from '../../src/domain/plan-validate';
import type { CatalogExercise } from '../../src/domain/plan-types';

const catalogue: CatalogExercise[] = [
  {
    id: 'ex_squat',
    slug: 'squat',
    nameEn: 'Squat',
    movementPattern: 'squat',
    primaryMuscles: ['quads', 'glutes'],
    equipment: ['bodyweight'],
    skillLevel: 'beginner',
    replacementGroup: 'rg_squat',
    safetyFlags: [],
  },
  {
    id: 'ex_bench',
    slug: 'bench',
    nameEn: 'Bench',
    movementPattern: 'horizontal_push',
    primaryMuscles: ['chest'],
    equipment: ['barbells'],
    skillLevel: 'intermediate',
    replacementGroup: 'rg_horizontal_push',
    safetyFlags: [],
  },
  {
    id: 'ex_row',
    slug: 'row',
    nameEn: 'Row',
    movementPattern: 'horizontal_pull',
    primaryMuscles: ['back'],
    equipment: ['dumbbells'],
    skillLevel: 'beginner',
    replacementGroup: 'rg_horizontal_pull',
    safetyFlags: [],
  },
  {
    id: 'ex_rdl',
    slug: 'rdl',
    nameEn: 'RDL',
    movementPattern: 'hinge',
    primaryMuscles: ['hamstrings'],
    equipment: ['barbells'],
    skillLevel: 'intermediate',
    replacementGroup: 'rg_hinge',
    safetyFlags: [],
  },
  {
    id: 'ex_plank',
    slug: 'plank',
    nameEn: 'Plank',
    movementPattern: 'core_anti_rotation',
    primaryMuscles: ['core'],
    equipment: ['bodyweight'],
    skillLevel: 'beginner',
    replacementGroup: 'rg_core',
    safetyFlags: [],
  },
  {
    id: 'ex_bike',
    slug: 'bike',
    nameEn: 'Bike',
    movementPattern: 'cardio_steady',
    primaryMuscles: ['cardio'],
    equipment: ['cardio'],
    skillLevel: 'beginner',
    replacementGroup: 'rg_cardio',
    safetyFlags: [],
  },
  {
    id: 'ex_ohp',
    slug: 'ohp',
    nameEn: 'OHP',
    movementPattern: 'vertical_push',
    primaryMuscles: ['shoulders'],
    equipment: ['barbells'],
    skillLevel: 'intermediate',
    replacementGroup: 'rg_vertical_push',
    safetyFlags: [],
  },
  {
    id: 'ex_pulldown',
    slug: 'pulldown',
    nameEn: 'Pulldown',
    movementPattern: 'vertical_pull',
    primaryMuscles: ['lats'],
    equipment: ['cables'],
    skillLevel: 'beginner',
    replacementGroup: 'rg_vertical_pull',
    safetyFlags: [],
  },
  {
    id: 'ex_lunge',
    slug: 'lunge',
    nameEn: 'Lunge',
    movementPattern: 'lunge',
    primaryMuscles: ['quads'],
    equipment: ['bodyweight'],
    skillLevel: 'beginner',
    replacementGroup: 'rg_lunge',
    safetyFlags: [],
  },
];

function makeInput(overrides: Partial<Parameters<typeof generatePlan>[0]> = {}) {
  return {
    startDate: '2026-01-05', // Monday
    goalDurationWeeks: 12,
    experienceLevel: 'new' as const,
    preferredWeekdays: [1, 3, 5],
    minutesPerSession: 45,
    sessionsPerWeek: 3,
    goalTypes: ['muscle_gain'],
    equipmentCategories: ['bodyweight', 'barbells', 'dumbbells', 'cables', 'cardio'],
    exclusions: [],
    sex: 'male' as const,
    heightCm: 178,
    weightKg: 80,
    activityLevel: 'moderate',
    catalogue,
    replacementRules: [],
    ...overrides,
  };
}

describe('generatePlan', () => {
  it('is deterministic: same input yields identical plan', () => {
    const a = generatePlan(makeInput());
    const b = generatePlan(makeInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('always keeps at least one full rest day per week', () => {
    const draft = generatePlan(makeInput());
    expect(draft.restDaysPerWeek).toBeGreaterThanOrEqual(1);
    expect(draft.weeklySchedule.filter((w) => w.kind === 'training').length).toBe(3);
  });

  it('produces 36 sessions with planned sets for a 12-week plan', () => {
    const draft = generatePlan(makeInput());
    expect(draft.goalDurationWeeks).toBe(12);
    expect(draft.sessions.length).toBe(36);
    const firstSet = draft.sessions[0].exercises[0].sets[0];
    expect(firstSet.setIndex).toBe(1);
    expect(firstSet.plannedReps).toBeGreaterThan(0);
  });

  it('never invents load for bodyweight-only movements', () => {
    const draft = generatePlan(makeInput({ equipmentCategories: ['bodyweight'] }));
    const anyLoaded = draft.sessions.some((s) =>
      s.exercises.some((e) =>
        e.sets.some((set) => {
          const ex = catalogue.find((c) => c.id === e.exerciseId);
          return set.plannedWeightKg != null && ex?.equipment.includes('bodyweight');
        }),
      ),
    );
    expect(anyLoaded).toBe(false);
  });

  it('excluded exercises never appear in the plan', () => {
    const draft = generatePlan(makeInput({ exclusions: [{ exerciseId: 'ex_bench' }] }));
    const found = draft.sessions.some((s) => s.exercises.some((e) => e.exerciseId === 'ex_bench'));
    expect(found).toBe(false);
  });

  it('validates a generated plan with no violations', () => {
    const draft = generatePlan(makeInput());
    expect(validatePlanDraft(draft, makeInput())).toEqual([]);
  });

  it('keeps the guaranteed rest day even with 6 sessions/week', () => {
    const input = makeInput({ preferredWeekdays: [1, 2, 3, 4, 5, 6], sessionsPerWeek: 6 });
    const draft = generatePlan(input);
    expect(draft.restDaysPerWeek).toBe(1);
    const violations = validatePlanDraft(draft, input);
    expect(violations.every((v) => v.rule !== 'min_rest_days')).toBe(true);
  });

  it('computes nutrition targets with gradual phase shifts (≤6%)', () => {
    const draft = generatePlan(makeInput());
    const base = draft.nutritionFramework.energyKcal;
    expect(base).toBeGreaterThan(1000);
    for (const shift of draft.nutritionFramework.phaseShifts) {
      expect(Math.abs(shift.energyKcal - base) / base).toBeLessThanOrEqual(0.06);
    }
  });

  it('shorter plans have fewer phases', () => {
    const short = generatePlan(makeInput({ goalDurationWeeks: 6 }));
    const long = generatePlan(makeInput({ goalDurationWeeks: 24 }));
    expect(short.phases.length).toBeLessThanOrEqual(3);
    expect(long.phases.length).toBeGreaterThan(short.phases.length);
  });
});
