/** Unit tests: safety rule evaluation — urgent signals stop training; no diagnosis. */

import { describe, expect, it } from 'vitest';
import { evaluateSafetyReport, blockAiRecommendation } from '../../src/domain/safety-rules';

describe('evaluateSafetyReport', () => {
  it('urgent keyword signals → stop + urgent guidance + AI blocked', () => {
    const result = evaluateSafetyReport({
      severity: 'discomfort',
      note: 'feeling chest pain during the set',
      bodyArea: 'chest',
    });
    expect(result.severity).toBe('urgent');
    expect(result.stopTraining).toBe(true);
    expect(result.guidanceKey).toBe('safety.guidance.urgent');
    expect(result.matchedRuleId).toBe('sr_urgent_signals');
  });

  it('pain severity → block + professional help guidance', () => {
    const result = evaluateSafetyReport({ severity: 'pain', bodyArea: 'knee' });
    expect(result.severity).toBe('block');
    expect(result.stopTraining).toBe(true);
    expect(result.guidanceKey).toBe('safety.guidance.pain');
  });

  it('discomfort severity → advisory, no forced stop, no diagnosis', () => {
    const result = evaluateSafetyReport({ severity: 'discomfort', bodyArea: 'shoulder' });
    expect(result.severity).toBe('advisory');
    expect(result.stopTraining).toBe(false);
    expect(result.requiresFollowUp).toBe(false);
  });

  it('recurrent reports in the same area → block with follow-up', () => {
    const now = new Date('2026-01-20T10:00:00Z');
    const result = evaluateSafetyReport({
      severity: 'discomfort',
      bodyArea: 'knee',
      now,
      recentReports: [
        { severity: 'discomfort', bodyArea: 'knee', reportedAt: '2026-01-14T10:00:00Z' },
      ],
    });
    expect(result.severity).toBe('block');
    expect(result.requiresFollowUp).toBe(true);
  });

  it('no match when nothing reported', () => {
    const result = evaluateSafetyReport({ severity: 'discomfort', bodyArea: 'none' });
    expect(result.matchedRuleId).not.toBeNull();
  });
});

describe('blockAiRecommendation', () => {
  it('records the blocking rule id without exposing sensitive text', () => {
    const result = blockAiRecommendation({
      matchedRuleId: 'sr_pain_reported',
      matchedRuleCode: 'pain_reported',
      severity: 'block',
      guidanceKey: 'safety.guidance.pain',
      blockAi: true,
      requiresFollowUp: true,
      stopTraining: true,
    });
    expect(result.blocked).toBe(true);
    expect(result.ruleCode).toBe('pain_reported');
  });
});
