/** Shared types + helpers for the deterministic adaptation engine. */

export type CompletedSetSignal = {
  exerciseId: string;
  setIndex: number;
  plannedReps: number | null;
  plannedWeightKg: number | null;
  actualReps: number | null;
  actualWeightKg: number | null;
  status: 'completed' | 'skipped' | 'partial';
  actualRpe: number | null;
};

export type CompletedSessionSignal = {
  workoutId: string;
  date: string;
  sets: CompletedSetSignal[];
  skips: Array<{ exerciseId: string; reason: string }>;
  reportedDiscomfort: boolean;
  painReported: boolean;
  energyRating: number | null;
};

export type AdaptationRuleConfig = {
  repeatedMissedThreshold: number;
  comfortableCompletionThreshold: number;
  progressionDimensions: Array<'load' | 'reps' | 'sets'>;
  maxSingleProgressionPercent: number;
};

export const DEFAULT_ADAPTATION_RULES: AdaptationRuleConfig = {
  repeatedMissedThreshold: 2,
  comfortableCompletionThreshold: 3,
  progressionDimensions: ['load', 'reps', 'sets'],
  maxSingleProgressionPercent: 5,
};

export type AdaptationProposal = {
  triggerCode: string;
  reasonKey: string;
  changedFields: Array<{
    exerciseId?: string;
    field: string;
    before: number | string | null;
    after: number | string | null;
    scope: 'exercise' | 'session' | 'week';
  }>;
  effectiveDate: string;
  explanationKey: string;
  explanationParams: Record<string, string | number>;
  signals: Array<{ signalCode: string; data: Record<string, number | string> }>;
  blockedBySafetyRule?: string;
};

export type AdaptationInput = {
  history: CompletedSessionSignal[];
  upcomingDates: string[];
  currentPlan: {
    exercises: Array<{
      exerciseId: string;
      plannedReps: number | null;
      plannedWeightKg: number | null;
      setsPerExercise: number;
    }>;
  };
  weightTrend?: Array<{ date: string; weightKg: number }>;
  goalTypes: string[];
  rules?: AdaptationRuleConfig;
};

/** True when a member repeatedly misses planned targets for the same exercise. */
export function missedTargetCount(
  exerciseId: string,
  history: CompletedSessionSignal[],
): { missed: number; totalSessions: number } {
  let missed = 0;
  let totalSessions = 0;
  for (const s of history) {
    const sets = s.sets.filter((x) => x.exerciseId === exerciseId);
    if (sets.length === 0) continue;
    totalSessions++;
    const completed = sets.filter((x) => x.status === 'completed');
    const metPlanned = completed.filter(
      (x) =>
        x.plannedReps != null &&
        x.actualReps != null &&
        x.actualReps >= x.plannedReps &&
        (x.plannedWeightKg == null ||
          (x.actualWeightKg != null && x.actualWeightKg >= x.plannedWeightKg - 0.01)),
    );
    if (metPlanned.length < sets.length) missed++;
  }
  return { missed, totalSessions };
}

/** True when the member comfortably hits targets across recent sessions. */
export function comfortableCompletionCount(
  exerciseId: string,
  history: CompletedSessionSignal[],
): number {
  let count = 0;
  for (const s of history.slice(-5)) {
    const sets = s.sets.filter((x) => x.exerciseId === exerciseId && x.status === 'completed');
    if (sets.length === 0) continue;
    const allMet = sets.every(
      (x) =>
        x.plannedReps != null &&
        x.actualReps != null &&
        x.actualReps >= x.plannedReps &&
        x.actualRpe != null &&
        x.actualRpe <= 8,
    );
    if (allMet) count++;
  }
  return count;
}
