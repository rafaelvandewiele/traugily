/** Canonical internal units: kg, cm, UTC ISO-8601 strings. Display conversions are pure. */

export type UnitSystem = 'metric' | 'imperial';

export function kgToDisplay(kg: number, system: UnitSystem): { value: number; unit: 'kg' | 'lb' } {
  if (system === 'metric') return { value: round1(kg), unit: 'kg' };
  return { value: round1(kg * 2.2046226218), unit: 'lb' };
}

export function displayToKg(value: number, system: UnitSystem): number {
  if (system === 'metric') return value;
  return round2(value / 2.2046226218);
}

export function cmToDisplay(cm: number, system: UnitSystem): { value: number; unit: 'cm' | 'in' } {
  if (system === 'metric') return { value: round1(cm), unit: 'cm' };
  return { value: round1(cm / 2.54), unit: 'in' };
}

export function displayToCm(value: number, system: UnitSystem): number {
  if (system === 'metric') return value;
  return round2(value * 2.54);
}

export function formatWeightForLocale(kg: number, system: UnitSystem, locale: string): string {
  const { value, unit } = kgToDisplay(kg, system);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) + ' ' + unit;
}

export function formatDateForLocale(isoDate: string, locale: string): string {
  const d = new Date(isoDate + (isoDate.length === 10 ? 'T00:00:00Z' : ''));
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export function formatDateTimeForLocale(iso: string, locale: string, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/**
 * Locale changes display conventions only — stored numeric meaning never changes.
 * This helper documents that contract for tests and callers.
 */
export function convertForDisplay(value: number, unit: UnitSystem, locale: string): number {
  void locale; // locale affects separators/formatting, handled by Intl at render time
  return unit === 'metric' ? round1(value) : round1(value * 2.2046226218);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(dateISO: string): number {
  return new Date(dateISO + 'T00:00:00Z').getUTCDay();
}

export function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (Date.parse(bISO + 'T00:00:00Z') - Date.parse(aISO + 'T00:00:00Z')) / 86_400_000,
  );
}
