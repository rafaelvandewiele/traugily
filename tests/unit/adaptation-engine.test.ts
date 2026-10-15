/** Unit tests: adaptation engine — safety outranks progression, conservative proposals. */

import { describe, expect, it } from 'vitest';
import {
  evaluateAdaptations,
  type CompletedSessionSignal,
} from '../../src/domain/adaptation-engine';

function session(overrides: Partial<CompletedSessionSignal> = {}): CompletedSessionSignal {
  return {
    workoutId: 'w1',
    date: '2026-01-12',
    sets: [
      {
        exerciseId: 'ex_bench',
        setIndex: 1,
        plannedReps: 8,
        plannedWeightKg: 60,
        actualReps: 8,
        actualWeightKg: 60,
        status: 'completed',
        actualRpe: 8,
      },
    ],
    skips: [],
    reportedDiscomfort: false,
    painReported: false,
    energyRating: null,
    ...overrides,
  };
}

const plan = {
  exercises: [{ exerciseId: 'ex_bench', plannedReps: 8, plannedWeightKg: 60, setsPerExercise: 3 }],
};

describe('evaluateAdaptations', () => {
  it('blocks all progression when pain was reported for an exercise', () => {
    const proposals = evaluateAdaptations({
      history: [session({ painReported: true })],
      upcomingDates: ['2026-01-19'],
      currentPlan: plan,
      goalTypes: ['muscle_gain'],
    });
    const forBench = proposals.find((p) => p.triggerCode === 'safety_block_no_increase');
    expect(forBench).toBeDefined();
    expect(forBench?.blockedBySafetyRule).toBe('sr_pain_reported');
    expect(forBench?.changedFields).toEqual([]);
  });

  it('proposes small single-dimension progression after comfortable completion', () => {
    const history = Array.from({ length: 3 }, (_, i) =>
      session({
        workoutId: `w${i}`,
        sets: [
          {
            exerciseId: 'ex_bench',
            setIndex: 1,
            plannedReps: 8,
            plannedWeightKg: 60,
            actualReps: 8,
            actualWeightKg: 60,
            status: 'completed',
            actualRpe: 7,
          },
        ],
      }),
    );
    const proposals = evaluateAdaptations({
      history,
      upcomingDates: ['2026-01-19'],
      currentPlan: plan,
      goalTypes: ['muscle_gain'],
    });
    const progression = proposals.find((p) => p.triggerCode === 'comfortable_completion');
    expect(progression).toBeDefined();
    expect(progression!.changedFields).toHaveLength(1); // single dimension only
    expect(progression!.changedFields[0].after).toBe(63); // +5% of 60 kg (max single step)
  });

  it('proposes retention/reduction after repeated missed targets', () => {
    const history = Array.from({ length: 3 }, (_, i) =>
      session({
        workoutId: `w${i}`,
        sets: [
          {
            exerciseId: 'ex_bench',
            setIndex: 1,
            plannedReps: 8,
            plannedWeightKg: 60,
            actualReps: 3,
            actualWeightKg: 60,
            status: 'partial',
            actualRpe: 9,
          },
        ],
      }),
    );
    const proposals = evaluateAdaptations({
      history,
      upcomingDates: ['2026-01-19'],
      currentPlan: plan,
      goalTypes: ['muscle_gain'],
    });
    const missed = proposals.find((p) => p.triggerCode === 'repeated_missed_targets');
    expect(missed).toBeDefined();
    const loadChange = missed!.changedFields.find((c) => c.field === 'plannedWeightKg');
    expect(loadChange!.after!).toBeLessThan(60); // retained or reduced, never increased
  });

  it('proposes replacement after repeated skips', () => {
    const history = [
      session({
        workoutId: 'w1',
        skips: [{ exerciseId: 'ex_bench', reason: 'equipment_unavailable' }],
      }),
      session({
        workoutId: 'w2',
        skips: [{ exerciseId: 'ex_bench', reason: 'equipment_unavailable' }],
      }),
    ];
    const proposals = evaluateAdaptations({
      history,
      upcomingDates: ['2026-01-19'],
      currentPlan: plan,
      goalTypes: ['muscle_gain'],
    });
    const skipped = proposals.find((p) => p.triggerCode === 'skipped_exercise');
    expect(skipped).toBeDefined();
    expect(skipped!.explanationParams.exercise).toBe('ex_bench');
  });

  it('flags weight-trend divergence only with enough data points', () => {
    const trend = [
      { date: '2026-01-01', weightKg: 80 },
      { date: '2026-01-04', weightKg: 80.2 },
      { date: '2026-01-08', weightKg: 81.5 },
      { date: '2026-01-12', weightKg: 82.5 },
    ];
    const proposals = evaluateAdaptations({
      history: [session()],
      upcomingDates: ['2026-01-19'],
      currentPlan: plan,
      weightTrend: trend,
      goalTypes: ['weight_loss'],
    });
    expect(proposals.some((p) => p.triggerCode === 'weight_trend_divergence')).toBe(true);
  });

  it('no proposals without signals', () => {
    const proposals = evaluateAdaptations({
      history: [session()],
      upcomingDates: ['2026-01-19'],
      currentPlan: plan,
      goalTypes: ['muscle_gain'],
    });
    expect(proposals).toHaveLength(0);
  });
});
