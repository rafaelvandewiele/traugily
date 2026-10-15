import {
  DEFAULT_ADAPTATION_RULES,
  comfortableCompletionCount,
  missedTargetCount,
  type AdaptationInput,
  type AdaptationProposal,
} from './adaptation-types';

export * from './adaptation-types';

/**
 * Evaluate signals and return conservative, explainable proposals.
 * Safety outranks progression: when pain was reported for an exercise, no increase
 * is proposed and a safety block with rule id is recorded instead.
 * Never edits closed historical workouts — proposals apply to future dates only.
 */
export function evaluateAdaptations(input: AdaptationInput): AdaptationProposal[] {
  const rules = input.rules ?? DEFAULT_ADAPTATION_RULES;
  const proposals: AdaptationProposal[] = [];
  const effectiveDate = input.upcomingDates[0] ?? new Date().toISOString().slice(0, 10);

  const painExercises = new Set(
    input.history.filter((h) => h.painReported).flatMap((h) => h.sets.map((s) => s.exerciseId)),
  );

  for (const planned of input.currentPlan.exercises) {
    if (painExercises.has(planned.exerciseId)) {
      proposals.push({
        triggerCode: 'safety_block_no_increase',
        reasonKey: 'adaptation.reason.safety_block',
        changedFields: [],
        effectiveDate,
        explanationKey: 'adaptation.explain.safety_block',
        explanationParams: { exercise: planned.exerciseId },
        signals: [{ signalCode: 'pain_reported', data: { exerciseId: planned.exerciseId } }],
        blockedBySafetyRule: 'sr_pain_reported',
      });
      continue;
    }

    const { missed, totalSessions } = missedTargetCount(planned.exerciseId, input.history);
    if (totalSessions >= rules.repeatedMissedThreshold && missed >= rules.repeatedMissedThreshold) {
      // Repeated inability → retain or reduce; technique guidance, no catch-up volume.
      const reduceLoad =
        planned.plannedWeightKg != null
          ? Math.round(
              planned.plannedWeightKg * (1 - rules.maxSingleProgressionPercent / 100) * 2,
            ) / 2
          : null;
      proposals.push({
        triggerCode: 'repeated_missed_targets',
        reasonKey: 'adaptation.reason.missed_targets',
        changedFields: [
          {
            exerciseId: planned.exerciseId,
            field: 'plannedWeightKg',
            before: planned.plannedWeightKg,
            after: reduceLoad,
            scope: 'exercise',
          },
          {
            exerciseId: planned.exerciseId,
            field: 'plannedReps',
            before: planned.plannedReps,
            after: planned.plannedReps != null ? Math.max(5, planned.plannedReps - 2) : null,
            scope: 'exercise',
          },
        ],
        effectiveDate,
        explanationKey: 'adaptation.explain.missed_targets',
        explanationParams: {
          exercise: planned.exerciseId,
          missedSessions: missed,
          observedSessions: totalSessions,
        },
        signals: [
          {
            signalCode: 'missed_targets',
            data: { exerciseId: planned.exerciseId, missed, totalSessions },
          },
        ],
      });
      continue;
    }

    const comfortable = comfortableCompletionCount(planned.exerciseId, input.history);
    if (comfortable >= rules.comfortableCompletionThreshold) {
      // Consistent comfortable completion → small progression in ONE dimension only.
      const dimension = rules.progressionDimensions[0] ?? 'reps';
      if (dimension === 'load' && planned.plannedWeightKg != null) {
        const after =
          Math.round(planned.plannedWeightKg * (1 + rules.maxSingleProgressionPercent / 100) * 2) /
          2;
        proposals.push({
          triggerCode: 'comfortable_completion',
          reasonKey: 'adaptation.reason.comfortable',
          changedFields: [
            {
              exerciseId: planned.exerciseId,
              field: 'plannedWeightKg',
              before: planned.plannedWeightKg,
              after,
              scope: 'exercise',
            },
          ],
          effectiveDate,
          explanationKey: 'adaptation.explain.comfortable_load',
          explanationParams: {
            exercise: planned.exerciseId,
            percent: rules.maxSingleProgressionPercent,
            comfortableSessions: comfortable,
          },
          signals: [
            {
              signalCode: 'comfortable_completion',
              data: { exerciseId: planned.exerciseId, comfortableSessions: comfortable },
            },
          ],
        });
      } else if (planned.plannedReps != null) {
        proposals.push({
          triggerCode: 'comfortable_completion',
          reasonKey: 'adaptation.reason.comfortable',
          changedFields: [
            {
              exerciseId: planned.exerciseId,
              field: 'plannedReps',
              before: planned.plannedReps,
              after: planned.plannedReps + 1,
              scope: 'exercise',
            },
          ],
          effectiveDate,
          explanationKey: 'adaptation.explain.comfortable_reps',
          explanationParams: { exercise: planned.exerciseId, comfortableSessions: comfortable },
          signals: [
            {
              signalCode: 'comfortable_completion',
              data: { exerciseId: planned.exerciseId, comfortableSessions: comfortable },
            },
          ],
        });
      }
    }
  }

  // Skipped exercises → replace/reschedule the objective; never unrealistic catch-up.
  const skipCounts = new Map<string, number>();
  for (const s of input.history) {
    for (const sk of s.skips) {
      skipCounts.set(sk.exerciseId, (skipCounts.get(sk.exerciseId) ?? 0) + 1);
    }
  }
  for (const [exerciseId, count] of skipCounts) {
    if (count >= 2) {
      proposals.push({
        triggerCode: 'skipped_exercise',
        reasonKey: 'adaptation.reason.skipped',
        changedFields: [
          {
            exerciseId,
            field: 'sessionAssignment',
            before: 'same_session',
            after: 'reassigned_or_replaced',
            scope: 'session',
          },
        ],
        effectiveDate,
        explanationKey: 'adaptation.explain.skipped',
        explanationParams: { exercise: exerciseId, times: count },
        signals: [{ signalCode: 'skips', data: { exerciseId, count } }],
      });
    }
  }

  // Missed workout → replan the week while retaining rest days.
  const missedWorkouts = input.history.filter((s) => s.sets.every((x) => x.status === 'skipped'));
  if (missedWorkouts.length >= rules.repeatedMissedThreshold) {
    proposals.push({
      triggerCode: 'missed_workout',
      reasonKey: 'adaptation.reason.missed_workout',
      changedFields: [
        {
          field: 'weekSchedule',
          before: 'as_planned',
          after: 'replanned_with_rest_days_retained',
          scope: 'week',
        },
      ],
      effectiveDate,
      explanationKey: 'adaptation.explain.missed_workout',
      explanationParams: { missedCount: missedWorkouts.length },
      signals: [{ signalCode: 'missed_workouts', data: { count: missedWorkouts.length } }],
    });
  }

  // Weight trend divergence → gradual multi-measurement review, never a conclusion.
  const trend = input.weightTrend ?? [];
  if (trend.length >= 4) {
    const half = Math.floor(trend.length / 2);
    const firstHalf = trend.slice(0, half);
    const secondHalf = trend.slice(half);
    const avg = (arr: Array<{ weightKg: number }>) =>
      arr.reduce((a, b) => a + b.weightKg, 0) / Math.max(1, arr.length);
    const delta = avg(secondHalf) - avg(firstHalf);
    const wantsLoss =
      input.goalTypes.includes('weight_loss') || input.goalTypes.includes('fat_loss');
    const diverges = (wantsLoss && delta > 0.3) || (!wantsLoss && delta < -0.3);
    if (diverges) {
      proposals.push({
        triggerCode: 'weight_trend_divergence',
        reasonKey: 'adaptation.reason.weight_trend',
        changedFields: [
          {
            field: 'nutritionFramework.review',
            before: 'unchanged',
            after: 'gradual_review_suggested',
            scope: 'week',
          },
        ],
        effectiveDate,
        explanationKey: 'adaptation.explain.weight_trend',
        explanationParams: {
          deltaKg: Math.round(delta * 10) / 10,
          direction: delta > 0 ? 'up' : 'down',
        },
        signals: [
          {
            signalCode: 'weight_trend',
            data: { deltaKg: Math.round(delta * 10) / 10, dataPoints: trend.length },
          },
        ],
      });
    }
  }

  return proposals;
}
