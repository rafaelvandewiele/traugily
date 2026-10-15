/** E2E helpers: fast API-based setup, then UI interactions. */

import { type APIRequestContext, type Page, expect } from '@playwright/test';

export const TEST_PASSWORD = 'Testing1234';

export async function signupViaApi(
  request: APIRequestContext,
  email: string,
): Promise<{ cookies: string; csrf: string }> {
  const res = await request.post('/api/v1/auth/signup', {
    data: { email, password: TEST_PASSWORD },
  });
  expect(res.status()).toBe(201);
  const cookies = res.headers()['set-cookie'] ?? '';
  const session = cookies.match(/tg_session=([^;]+)/)?.[1] ?? '';
  const csrf = cookies.match(/tg_csrf=([^;]+)/)?.[1] ?? '';
  return { cookies: `tg_session=${session}; tg_csrf=${csrf}`, csrf };
}

export const ONBOARDING_BODY = {
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
};

/** Complete onboarding + generate + accept a plan via API. Returns cookie header. */
export async function setupMemberWithPlan(
  request: APIRequestContext,
  email: string,
): Promise<{ cookieHeader: string; csrf: string }> {
  const { cookies, csrf } = await signupViaApi(request, email);
  for (const [step, body] of Object.entries(ONBOARDING_BODY)) {
    const res = await request.put(`/api/v1/onboarding/${step}`, {
      headers: { 'x-csrf-token': csrf },
      data: body,
    });
    expect(res.status(), `onboarding ${step}`).toBe(200);
  }
  const gen = await request.post('/api/v1/plans/generate', {
    headers: { 'x-csrf-token': csrf },
    data: {},
  });
  expect(gen.status()).toBe(200);
  const { planId } = (await gen.json()) as { planId: string };
  const accept = await request.post(`/api/v1/plans/${planId}/accept`, {
    headers: { 'x-csrf-token': csrf },
    data: { acknowledgeSafety: true },
  });
  expect(accept.status()).toBe(200);
  return { cookieHeader: cookies, csrf };
}

/** Seed the session cookie into a page so the UI renders as this user. */
export async function loginInPage(page: Page, cookieHeader: string): Promise<void> {
  await page.goto('/today');
  await page.context().addCookies(
    cookieHeader.split('; ').map((pair) => {
      const [name, ...rest] = pair.split('=');
      return {
        name,
        value: rest.join('='),
        domain: '127.0.0.1',
        path: '/',
        // Only the session cookie is HttpOnly; the CSRF cookie must remain
        // readable by the client so mutating requests can send the header.
        httpOnly: name === 'tg_session',
        sameSite: 'Lax' as const,
      };
    }),
  );
  await page.goto('/today');
}
