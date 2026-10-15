/** Unit tests: nutrition floors + calm within-week adjustment (no extreme compensation). */

import { describe, expect, it } from 'vitest';
import {
  applyNutritionFloors,
  withinWeekAdjustment,
  phaseNutritionShifts,
} from '../../src/domain/nutrition-targets';

describe('applyNutritionFloors', () => {
  it('raises below-floor targets to the configured floor', () => {
    const result = applyNutritionFloors(
      { energyKcal: 900, proteinG: 120, carbsG: 90, fatG: 30 },
      'male',
    );
    expect(result.target.energyKcal).toBe(1500);
    expect(result.floored).toBe(true);
  });

  it('leaves adequate targets untouched', () => {
    const result = applyNutritionFloors(
      { energyKcal: 2200, proteinG: 140, carbsG: 220, fatG: 60 },
      'male',
    );
    expect(result.target.energyKcal).toBe(2200);
    expect(result.floored).toBe(false);
  });

  it('uses the female floor for female members', () => {
    const result = applyNutritionFloors(
      { energyKcal: 1000, proteinG: 90, carbsG: 100, fatG: 35 },
      'female',
    );
    expect(result.target.energyKcal).toBe(1200);
  });
});

describe('withinWeekAdjustment', () => {
  it('never suggests extreme compensation for extreme deviation', () => {
    const week = [3200, 3200, 3300, 0, 0, 0, 0]; // 60% overshoot — beyond moderate range
    const adjustment = withinWeekAdjustment(week, 2000);
    // >25% deviation → no automatic suggestion at all (safer than any crash diet)
    expect(adjustment).toBeNull();
  });

  it('suggests a calm adjustment for moderate overshoot', () => {
    const week = [2200, 2250, 2210, 2180, 0, 0, 0]; // ~11% over target
    const adjustment = withinWeekAdjustment(week, 2000);
    expect(adjustment).not.toBeNull();
    expect(adjustment!.suggestedDailyKcal).toBeLessThan(2200);
    expect(adjustment!.suggestedDailyKcal).toBeGreaterThan(1800);
  });

  it('offers nothing when logs are sparse', () => {
    expect(withinWeekAdjustment([2100, 0, 0], 2000)).toBeNull();
  });

  it('offers nothing when tracking is on target', () => {
    expect(withinWeekAdjustment([2000, 2010, 1990, 2020], 2000)).toBeNull();
  });

  it('offers a gentle lift after under-eating', () => {
    const week = [1600, 1620, 1580, 1610, 0, 0, 0];
    const adjustment = withinWeekAdjustment(week, 2000);
    expect(adjustment).not.toBeNull();
    expect(adjustment!.suggestedDailyKcal).toBeGreaterThan(1600);
    expect(adjustment!.suggestedDailyKcal).toBeLessThan(2100);
  });
});

describe('phaseNutritionShifts', () => {
  it('shifts gradually between phases and keeps a coherent weekly framework', () => {
    const shifts = phaseNutritionShifts(
      { energyKcal: 2200, proteinG: 140, carbsG: 250, fatG: 60 },
      ['orientation', 'build_up', 'review'],
    );
    expect(shifts).toHaveLength(3);
    const energies = shifts.map((s) => s.energyKcal);
    const max = Math.max(...energies);
    const min = Math.min(...energies);
    expect((max - min) / max).toBeLessThan(0.1);
  });
});
