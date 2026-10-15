/* ------------------------- Domain output types ------------------------- */

export type PlannedSet = {
  id: string;
  setIndex: number;
  plannedReps: number | null;
  plannedWeightKg: number | null;
  plannedDurationSeconds: number | null;
  plannedRpe: number | null;
  plannedRir: number | null;
  restSeconds: number | null;
  setType: 'warmup' | 'working' | 'back_off';
};

export type SessionExercisePlan = {
  id: string;
  exerciseId: string;
  nameEn: string;
  position: number;
  plannedOrder: number;
  sets: PlannedSet[];
};

export type ScheduledSessionPlan = {
  id: string;
  scheduledDate: string;
  weekday: number;
  kind: 'workout' | 'rest' | 'recovery' | 'measurement';
  titleKey: string;
  focusKey: string;
  durationMinutes: number;
  exercises: SessionExercisePlan[];
};

export type PlanPhase = {
  id: string;
  phaseKey: string;
  titleKey: string;
  purpose: string;
  startDate: string;
  endDate: string;
  position: number;
};

export type PlanDraft = {
  goalDurationWeeks: number;
  phases: PlanPhase[];
  weeklySchedule: Array<{ weekday: number; kind: string; labelKey: string }>;
  sessions: ScheduledSessionPlan[];
  nutritionFramework: {
    energyKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    detailLevel: 'coarse' | 'moderate' | 'detailed';
    phaseShifts: Array<{
      phaseKey: string;
      energyKcal: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
    }>;
  };
  assumptions: string[];
  decisions: Array<{ key: string; params: Record<string, string | number> }>;
  restDaysPerWeek: number;
};
