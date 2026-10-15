/**
 * Nutrition targets: estimates only, never medical precision.
 * Floors come from product_settings (see migrations) and are enforced here so the
 * engine can never produce a target below the configured floor.
 */

export type NutritionFloors = {
  kcalFemale: number;
  kcalMale: number;
  kcalUnspecified: number;
};

export const DEFAULT_NUTRITION_FLOORS: NutritionFloors = {
  kcalFemale: 1200,
  kcalMale: 1500,
  kcalUnspecified: 1400,
};

export function estimateBmr(
  sex: 'female' | 'male' | 'intersex' | 'prefer_not_to_say' | undefined,
  heightCm: number | null,
  weightKg: number | null,
): number {
  // Mifflin-St Jeor style estimate with generic fallbacks; always labelled an estimate.
  const h = heightCm ?? 170;
  const w = weightKg ?? 75;
  const base = 10 * w + 6.25 * h - 5 * 25;
  if (sex === 'male') return Math.round(base + 5);
  if (sex === 'female') return Math.round(base - 161);
  return Math.round(base - 78);
}

export type PhaseNutrition = {
  phaseKey: string;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export function applyNutritionFloors(
  target: { energyKcal: number; proteinG: number; carbsG: number; fatG: number },
  sex: 'female' | 'male' | 'intersex' | 'prefer_not_to_say' | undefined,
  floors: NutritionFloors = DEFAULT_NUTRITION_FLOORS,
): { target: typeof target; floored: boolean } {
  const floor =
    sex === 'female'
      ? floors.kcalFemale
      : sex === 'male'
        ? floors.kcalMale
        : floors.kcalUnspecified;
  if (target.energyKcal >= floor) return { target, floored: false };
  const ratio = floor / Math.max(1, target.energyKcal);
  return {
    target: {
      energyKcal: floor,
      proteinG: Math.round(target.proteinG * Math.min(1, ratio) * 10) / 10,
      carbsG: Math.round(target.carbsG * Math.min(1, ratio) * 10) / 10,
      fatG: Math.round(target.fatG * Math.min(1, ratio) * 10) / 10,
    },
    floored: true,
  };
}

/**
 * Shift macros gradually between phases. Rest-day distribution may differ, but the
 * weekly framework stays coherent: the weekly average stays within ±5% of the phase target.
 */
export function phaseNutritionShifts(
  base: { energyKcal: number; proteinG: number; carbsG: number; fatG: number },
  phaseKeys: string[],
): PhaseNutrition[] {
  return phaseKeys.map((phaseKey, i) => {
    const shift = i === 0 ? 0.95 : phaseKey === 'consolidation' ? 0.98 : 1;
    return {
      phaseKey,
      energyKcal: Math.round((base.energyKcal * shift) / 10) * 10,
      proteinG: base.proteinG,
      carbsG: Math.round((base.carbsG * shift) / 5) * 5,
      fatG: base.fatG,
    };
  });
}

/**
 * A missed or changed meal never triggers extreme compensation. At most we offer a
 * calm, optional within-week adjustment that redistributes rather than restricts.
 */
export function withinWeekAdjustment(
  weekLoggedKcal: number[],
  phaseTargetKcal: number,
): { suggestedDailyKcal: number; deltaPercent: number; messageKey: string } | null {
  const loggedDays = weekLoggedKcal.filter((k) => k > 0);
  if (loggedDays.length < 3) return null;
  const avg = loggedDays.reduce((a, b) => a + b, 0) / loggedDays.length;
  const deltaPercent = Math.round(((avg - phaseTargetKcal) / phaseTargetKcal) * 100);
  // Only surface an adjustment when the deviation is meaningful but moderate.
  if (Math.abs(deltaPercent) < 8 || Math.abs(deltaPercent) > 25) return null;
  const suggestedDailyKcal =
    Math.round((phaseTargetKcal + (avg - phaseTargetKcal) * 0.3) / 10) * 10;
  return {
    suggestedDailyKcal,
    deltaPercent,
    messageKey: 'nutrition.adjustment.within_week',
  };
}
