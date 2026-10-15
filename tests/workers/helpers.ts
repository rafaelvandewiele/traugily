/** Shared test helpers for workerd integration tests. */

import { SELF } from 'cloudflare:test';
import { expect } from 'vitest';

export async function json<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await SELF.fetch(`http://localhost/api/v1${path}`, init);
  return { status: res.status, body: (await res.json()) as T };
}

export function post(_path: string, body: unknown, csrf = 'test-csrf', cookies = '') {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrf,
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: JSON.stringify(body),
  };
}

export async function signupAndCookies(email: string): Promise<{ cookies: string; csrf: string }> {
  const res = await SELF.fetch(
    'http://localhost/api/v1/auth/signup',
    post('/auth/signup', {
      email,
      password: 'Testing1234',
    }),
  );
  expect(res.status).toBe(201);
  const setCookies = res.headers.getSetCookie();
  const session = setCookies.find((c) => c.startsWith('tg_session='))!.split(';')[0];
  const csrfRaw = setCookies.find((c) => c.startsWith('tg_csrf='))!;
  const csrf = decodeURIComponent(csrfRaw.slice('tg_csrf='.length).split(';')[0]);
  return { cookies: session, csrf };
}

export const ONBOARDING = {
  basics: { sex: 'male', heightCm: 178, weightKg: 80 },
  goals: {
    goals: [{ goalType: 'muscle_gain', priority: 1 }],
    targetWeeks: 12,
    acknowledgedRange: true,
  },
  training: {
    experienceLevel: 'new',
    preferredWeekdays: [1, 3, 5],
    minutesPerSession: 45,
    sessionsPerWeek: 3,
    locations: ['gym'],
    equipment: [
      { category: 'barbells', status: 'available' },
      { category: 'free_weights', status: 'available' },
      { category: 'machines', status: 'available' },
      { category: 'cables', status: 'available' },
    ],
    exclusions: [],
    blockedDates: [],
  },
  lifestyle: {
    activityLevel: 'moderate',
    workPattern: 'desk',
    sleepIndicator: 'good',
    stressIndicator: 'moderate',
  },
  nutrition: {
    eatingPattern: 'no_preference',
    allergies: [],
    avoidIngredients: [],
    budgetLevel: 'moderate',
    cookingTime: 'some',
    mealCount: 3,
    trackingDetail: 'coarse',
  },
  safety: { acknowledgedNoDiagnosis: true, acknowledgedProfessionalHelp: true },
} as const;

export async function completeOnboarding(cookies: string, csrf: string): Promise<void> {
  for (const [step, body] of Object.entries(ONBOARDING)) {
    const res = await SELF.fetch(`http://localhost/api/v1/onboarding/${step}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
      body: JSON.stringify(body),
    });
    expect(res.status, `onboarding ${step}`).toBe(200);
  }
}
