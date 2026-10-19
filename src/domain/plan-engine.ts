import { addDaysISO, weekdayOf } from '../shared/units';
import type {
  PlanDraft,
  PlanPhase,
  PlannedSet,
  ScheduledSessionPlan,
  SessionExercisePlan,
} from '../shared/contracts';
import {
  DEFAULT_PLAN_RULES,
  equipmentAvailable,
  isExcluded,
  phaseLayout,
  type CatalogExercise,
  type PlanGeneratorInput,
} from './plan-types';
import { estimateBmr } from './nutrition-targets';

/** Deterministic PRNG so the same input always yields the same plan (testable + stable). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function byPattern(
  patterns: string[],
  input: PlanGeneratorInput,
  usedRecently: string[],
): CatalogExercise[] {
  return input.catalogue.filter(
    (c) =>
      patterns.includes(c.movementPattern) &&
      equipmentAvailable(c, input.equipmentCategories) &&
      !isExcluded(c, input) &&
      !usedRecently.includes(c.id) &&
      (c.skillLevel !== 'advanced' || input.experienceLevel === 'experienced'),
  );
}

const FOCUS_TEMPLATES: Record<string, string[][]> = {
  full_body: [
    ['squat'],
    ['horizontal_push'],
    ['horizontal_pull'],
    ['hinge', 'lunge'],
    ['core_anti_rotation', 'core_flexion'],
  ],
  push: [['horizontal_push'], ['vertical_push'], ['horizontal_push'], ['core_flexion'], ['core_anti_rotation']],
  pull: [['horizontal_pull'], ['vertical_pull'], ['horizontal_pull'], ['core_anti_rotation'], ['core_flexion']],
  legs: [['squat'], ['lunge'], ['hinge'], ['squat', 'lunge'], ['core_flexion']],
  cardio: [['cardio_steady', 'cardio_intervals']],
};

/** Dumbbells come in 2 kg steps (2, 4, 6, 8, …) — snap dumbbell loads to them. */
export function snapDumbbellLoad(weightKg: number | null): number | null {
  if (weightKg == null) return null;
  return Math.max(2, Math.round(weightKg / 2) * 2);
}

function usesDumbbells(ex: CatalogExercise): boolean {
  return ex.equipment.some((e) => e === 'dumbbells' || e === 'free_weights');
}

function pickSessionExercises(
  focus: string,
  input: PlanGeneratorInput,
  usedRecently: string[],
  rnd: () => number,
): CatalogExercise[] {
  const selected: CatalogExercise[] = [];
  for (const patterns of FOCUS_TEMPLATES[focus] ?? FOCUS_TEMPLATES.full_body) {
    // Also exclude picks made earlier in THIS session: a repeated pattern in the
    // template must select a different exercise (session_exercises is unique on
    // (session_id, exercise_id)).
    const pool = byPattern(patterns, input, [...usedRecently, ...selected.map((s) => s.id)]);
    const pick = pool.length > 0 ? pool[Math.floor(rnd() * pool.length)] : null;
    if (pick) selected.push(pick);
  }
  return selected;
}

function startingLoad(
  input: PlanGeneratorInput,
  ex: CatalogExercise,
  setIndex: number,
): { reps: number; weightKg: number | null; rir: number; restSeconds: number } {
  // Conservative defaults: beginners get higher RIR and lower density.
  const beginner = input.experienceLevel === 'new';
  const wantsMuscle = input.goalTypes.includes('muscle_gain');
  const reps = wantsMuscle ? 10 : 8;
  const rir = beginner ? 3 : 2;
  const restSeconds = input.minutesPerSession <= 30 ? 60 : 90;
  // Never invent heavy loads: load only when the exercise uses external equipment
  // and the member provided a bodyweight reference.
  const usesExternal = ex.equipment.some((e) =>
    ['free_weights', 'barbells', 'cables', 'machines'].includes(e),
  );
  let weightKg: number | null = null;
  if (usesExternal && input.weightKg) {
    const baseRatio =
      ex.skillLevel === 'beginner' ? 0.2 : ex.skillLevel === 'intermediate' ? 0.35 : 0.5;
    const raw = input.weightKg * baseRatio * (setIndex === 1 ? 0.85 : 1);
    weightKg = Math.round(raw * 2) / 2; // round to 0.5 kg
    // Dumbbells only come in 2 kg steps.
    if (usesDumbbells(ex)) weightKg = snapDumbbellLoad(weightKg);
  }
  return { reps, weightKg, rir, restSeconds };
}

export function generatePlan(input: PlanGeneratorInput): PlanDraft {
  const rules = input.rules ?? DEFAULT_PLAN_RULES;
  const seedInput = JSON.stringify({
    g: input.goalTypes,
    w: input.goalDurationWeeks,
    e: input.experienceLevel,
    d: input.preferredWeekdays,
    s: input.sessionsPerWeek,
    m: input.minutesPerSession,
    eq: input.equipmentCategories,
    x: input.exclusions.map((e) => e.exerciseId ?? e.replacementGroup),
  });
  const rnd = mulberry32(hashString(seedInput));

  const totalWeeks = Math.max(
    rules.shortPlanMinWeeks,
    Math.min(rules.shortPlanMaxWeeks, input.goalDurationWeeks),
  );
  const layout = phaseLayout(totalWeeks, input.goalTypes);

  const phases: PlanPhase[] = [];
  let cursor = input.startDate;
  layout.forEach((p, i) => {
    phases.push({
      id: `phase_${i + 1}`,
      phaseKey: p.key,
      titleKey: `plan.phase.${p.key}.title`,
      purpose: `plan.phase.${p.key}.purpose`,
      startDate: cursor,
      endDate: addDaysISO(cursor, p.weeks * 7 - 1),
      position: i,
    });
    cursor = addDaysISO(cursor, p.weeks * 7);
  });

  // Weekly schedule: preferred training weekdays, always at least one full rest day.
  const preferred = [...new Set(input.preferredWeekdays)].sort((a, b) => a - b);
  const trainingDays = preferred.slice(0, Math.min(input.sessionsPerWeek, 6));
  const weeklySchedule = Array.from({ length: 7 }, (_, wd) =>
    trainingDays.includes(wd)
      ? { weekday: wd, kind: 'training', labelKey: 'plan.week.training' }
      : { weekday: wd, kind: 'rest', labelKey: 'plan.week.rest' },
  );
  const restDaysPerWeek = 7 - trainingDays.length;

  const wantsStrength =
    input.goalTypes.includes('muscle_gain') || input.goalTypes.includes('strength');
  const focusRotation = wantsStrength
    ? ['push', 'pull', 'legs', 'full_body']
    : ['full_body', 'cardio', 'full_body', 'legs'];

  const sessions: ScheduledSessionPlan[] = [];
  const recentExerciseIds: string[] = [];
  const weekExerciseLoads = new Map<string, number>(); // exerciseId -> load used this week
  const startWeekday = weekdayOf(input.startDate);
  let sessionCounter = 0;

  for (let week = 0; week < totalWeeks; week++) {
    const weekStart = addDaysISO(input.startDate, week * 7);
    const weekPhase = phases.find((p) => weekStart >= p.startDate && weekStart <= p.endDate);
    const isDeload = weekPhase?.phaseKey === 'review' && week === totalWeeks - 1;
    // Reset per-week load tracking so repeat exercises get varied loads each week.
    weekExerciseLoads.clear();
    for (const wd of trainingDays) {
      const offset = (wd - startWeekday + 7) % 7;
      const date = addDaysISO(weekStart, offset);
      if (date >= addDaysISO(input.startDate, totalWeeks * 7)) continue;
      const sessionId = `sess_${date}_${wd}`;
      const focus = focusRotation[sessionCounter % focusRotation.length];
      sessionCounter++;
      const picked = pickSessionExercises(focus, input, recentExerciseIds, rnd);
      for (const p of picked) {
        recentExerciseIds.push(p.id);
        if (recentExerciseIds.length > 10) recentExerciseIds.shift();
      }
      const setCount = isDeload ? 2 : input.minutesPerSession <= 30 ? 2 : 3;
      const exercises: SessionExercisePlan[] = picked.map((ex, idx) => {
        // Varied load when the same exercise repeats within a week so it isn't
        // identical every time (keeps progression honest when a set feels too easy).
        const baseLoad = startingLoad(input, ex, 1);
        const priorLoad = weekExerciseLoads.get(ex.id);
        const loadVariation = priorLoad != null ? (0.85 + rnd() * 0.3) : 1; // ±15%
        let exerciseWeight = baseLoad.weightKg;
        if (exerciseWeight != null && priorLoad != null) {
          exerciseWeight = usesDumbbells(ex)
            ? snapDumbbellLoad(exerciseWeight * loadVariation)
            : Math.max(1, Math.round(exerciseWeight * loadVariation * 2) / 2);
        }
        if (exerciseWeight != null) weekExerciseLoads.set(ex.id, exerciseWeight);

        const sets: PlannedSet[] = Array.from({ length: setCount }, (_, s) => {
          return {
            id: `set_${sessionId}_${ex.id}_${s + 1}`,
            setIndex: s + 1,
            plannedReps: isDeload ? Math.max(5, baseLoad.reps - 2) : baseLoad.reps,
            plannedWeightKg: exerciseWeight,
            plannedDurationSeconds:
              ex.movementPattern.startsWith('cardio') ? input.minutesPerSession * 6 : null,
            plannedRpe: isDeload ? 6 : 7,
            plannedRir: baseLoad.rir,
            restSeconds: baseLoad.restSeconds,
            setType: s === 0 && input.experienceLevel === 'new' ? 'warmup' : 'working',
          };
        });
        return {
          id: `se_${sessionId}_${ex.id}`,
          exerciseId: ex.id,
          nameEn: ex.nameEn,
          position: idx + 1,
          plannedOrder: idx + 1,
          sets,
        };
      });
      sessions.push({
        id: sessionId,
        scheduledDate: date,
        weekday: wd,
        kind: 'workout',
        titleKey: `plan.session.${focus}.title`,
        focusKey: `plan.session.${focus}.focus`,
        durationMinutes: input.minutesPerSession,
        exercises,
      });
    }
  }

  // Nutrition framework estimate; floors enforced when targets are persisted server-side.
  const bmr = estimateBmr(input.sex, input.heightCm, input.weightKg);
  const activityFactor: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    high: 1.725,
    very_high: 1.9,
  };
  const tdee = bmr * (activityFactor[input.activityLevel] ?? 1.375);
  const wantsFatLoss =
    input.goalTypes.includes('fat_loss') || input.goalTypes.includes('weight_loss');
  const energy = Math.round((wantsFatLoss ? tdee * 0.85 : tdee * 1.05) / 10) * 10;
  const proteinG = Math.round((input.weightKg ?? 75) * (wantsFatLoss ? 1.8 : 1.6));
  const fatG = Math.round((energy * 0.27) / 9);
  const carbsG = Math.round((energy - proteinG * 4 - fatG * 9) / 4);

  const phaseShifts = layout.map((p, i) => {
    const shift = i === 0 ? 0.95 : p.key === 'consolidation' ? 0.98 : 1;
    return {
      phaseKey: p.key,
      energyKcal: Math.round((energy * shift) / 10) * 10,
      proteinG,
      carbsG: Math.round((carbsG * shift) / 5) * 5,
      fatG,
    };
  });

  return {
    goalDurationWeeks: totalWeeks,
    phases,
    weeklySchedule,
    sessions,
    nutritionFramework: {
      energyKcal: energy,
      proteinG,
      carbsG,
      fatG,
      detailLevel: 'coarse',
      phaseShifts,
    },
    assumptions: [
      `plan.assumption.weekly_sessions:${input.sessionsPerWeek}`,
      `plan.assumption.session_minutes:${input.minutesPerSession}`,
      `plan.assumption.rest_days:${restDaysPerWeek}`,
      'plan.assumption.conservative_start',
      'plan.assumption.no_medical_advice',
    ],
    decisions: [
      { key: 'decision.start_conservative', params: { experience: input.experienceLevel } },
      { key: 'decision.rest_day_guaranteed', params: { restDays: restDaysPerWeek } },
      {
        key: 'decision.equipment_matched',
        params: { equipment: input.equipmentCategories.join(',') },
      },
    ],
    restDaysPerWeek,
  };
}

/**
 * Before/after diff for a plan length change. Recomputes dates, phase lengths and
 * milestones; the member confirms explicitly before anything changes.
 */
export function diffPlanLength(
  currentWeeks: number,
  newWeeks: number,
  startDate: string,
  goalTypes: string[],
) {
  const layoutFor = (w: number) => {
    const layout = phaseLayout(w, goalTypes);
    let c = startDate;
    return layout.map((p) => {
      const start = c;
      const end = addDaysISO(c, p.weeks * 7 - 1);
      c = addDaysISO(c, p.weeks * 7);
      return { key: p.key as string, weeks: p.weeks, startDate: start, endDate: end };
    });
  };
  const before = layoutFor(currentWeeks);
  const after = layoutFor(newWeeks);
  const changed: Array<{ field: string; before: string | number; after: string | number }> = [
    { field: 'goalDurationWeeks', before: currentWeeks, after: newWeeks },
  ];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const b = before[i];
    const a = after[i];
    if (!b || !a) {
      changed.push({ field: `phases[${i}]`, before: b?.key ?? '—', after: a?.key ?? '—' });
      continue;
    }
    if (b.key !== a.key || b.weeks !== a.weeks || b.endDate !== a.endDate) {
      changed.push({
        field: `phase_${i}`,
        before: `${b.key} (${b.weeks}w, ends ${b.endDate})`,
        after: `${a.key} (${a.weeks}w, ends ${a.endDate})`,
      });
    }
  }
  return {
    before: { weeks: currentWeeks, phases: before },
    after: { weeks: newWeeks, phases: after },
    changed,
  };
}
