/** Unit tests: phase layout, plan-length diff, BMR estimate. */

import { describe, expect, it } from 'vitest';
import { phaseLayout } from '../../src/domain/plan-types';
import { diffPlanLength } from '../../src/domain/plan-engine';
import { estimateBmr } from '../../src/domain/nutrition-targets';

describe('phaseLayout', () => {
  it('orientation first, review last, weeks sum correctly', () => {
    for (const weeks of [6, 12, 16, 20, 24, 52]) {
      const layout = phaseLayout(weeks, ['fitness']);
      expect(layout[0].key).toBe('orientation');
      expect(layout[layout.length - 1].key).toBe('review');
      expect(layout.reduce((a, p) => a + p.weeks, 0)).toBe(weeks);
    }
  });

  it('strength goals include a progression phase', () => {
    const layout = phaseLayout(16, ['strength']);
    expect(layout.map((p) => p.key)).toContain('progression');
  });
});

describe('diffPlanLength', () => {
  it('shows before/after changes with recomputed dates', () => {
    const diff = diffPlanLength(12, 16, '2026-01-05', ['muscle_gain']);
    expect(diff.changed[0]).toEqual({ field: 'goalDurationWeeks', before: 12, after: 16 });
    expect(diff.changed.length).toBeGreaterThan(1);
    const lastBefore = diff.before.phases[diff.before.phases.length - 1].endDate;
    const lastAfter = diff.after.phases[diff.after.phases.length - 1].endDate;
    expect(lastAfter > lastBefore).toBe(true);
  });

  it('handles shrinking plans', () => {
    const diff = diffPlanLength(16, 8, '2026-01-05', ['fitness']);
    expect(diff.changed[0]).toEqual({ field: 'goalDurationWeeks', before: 16, after: 8 });
    const lastAfter = diff.after.phases[diff.after.phases.length - 1].endDate;
    expect(lastAfter < '2026-03-05').toBe(true);
  });
});

describe('estimateBmr', () => {
  it('is higher for males than females at identical stats', () => {
    expect(estimateBmr('male', 178, 80)).toBeGreaterThan(estimateBmr('female', 178, 80));
  });

  it('scales with weight', () => {
    expect(estimateBmr('male', 178, 90)).toBeGreaterThan(estimateBmr('male', 178, 70));
  });
});
