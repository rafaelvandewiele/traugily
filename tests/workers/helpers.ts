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

/**
 * Minimal published exercise catalogue for plan generation in tests.
 * The real catalogue is seeded separately (seed/*.sql) for dev/production.
 */
export async function seedCatalogue(db: D1Database): Promise<void> {
  const rows: Array<[string, string, string, string, string, string]> = [
    // id, slug, name, pattern, muscles, equipment
    ['ex_bench', 'bench-press', 'Bench Press', 'horizontal_push', '["chest"]', '["barbells"]'],
    [
      'ex_incline_db',
      'incline-db-press',
      'Incline DB Press',
      'horizontal_push',
      '["chest"]',
      '["free_weights"]',
    ],
    [
      'ex_machine_press',
      'machine-chest-press',
      'Machine Chest Press',
      'horizontal_push',
      '["chest"]',
      '["machines"]',
    ],
    ['ex_db_row', 'db-row', 'Dumbbell Row', 'horizontal_pull', '["back"]', '["free_weights"]'],
    ['ex_cable_row', 'cable-row', 'Cable Row', 'horizontal_pull', '["back"]', '["cables"]'],
    [
      'ex_pulldown',
      'lat-pulldown',
      'Lat Pulldown',
      'vertical_pull',
      '["lats"]',
      '["cables","machines"]',
    ],
    [
      'ex_goblet_squat',
      'goblet-squat',
      'Goblet Squat',
      'squat',
      '["quads","glutes"]',
      '["free_weights"]',
    ],
    ['ex_leg_press', 'leg-press', 'Leg Press', 'squat', '["quads","glutes"]', '["machines"]'],
    [
      'ex_rdl',
      'romanian-deadlift',
      'Romanian Deadlift',
      'hinge',
      '["hamstrings","glutes"]',
      '["barbells"]',
    ],
    [
      'ex_lunge',
      'walking-lunge',
      'Walking Lunge',
      'lunge',
      '["quads","glutes"]',
      '["free_weights"]',
    ],
    ['ex_plank', 'plank', 'Plank', 'core_anti_rotation', '["core"]', '["bodyweight"]'],
    ['ex_bridge', 'glute-bridge', 'Glute Bridge', 'hinge', '["glutes"]', '["bodyweight"]'],
  ];
  const now = new Date().toISOString();
  await db.batch(
    rows.map(([id, slug, name, pattern, muscles, equipment]) =>
      db
        .prepare(
          `INSERT INTO exercises (id, slug, name_en, movement_pattern, primary_muscles,
             supporting_muscles, equipment, skill_level, safety_flags, replacement_group,
             review_status, version, created_at, updated_at, published_at)
           VALUES (?, ?, ?, ?, ?, '[]', ?, 'beginner', '[]', NULL, 'published', 1, ?, ?, ?)`,
        )
        .bind(id, slug, name, pattern, muscles, equipment, now, now, now),
    ),
  );
}

/** Signup → onboarding → generate → accept. Returns cookies/csrf/plan id. */
export async function setupPlan(
  email: string,
): Promise<{ cookies: string; csrf: string; planId: string }> {
  const { cookies, csrf } = await signupAndCookies(email);
  await completeOnboarding(cookies, csrf);
  const gen = await json<{ planId: string }>(
    '/plans/generate',
    post('/plans/generate', {}, csrf, cookies),
  );
  expect(gen.status, 'plan generate').toBe(200);
  const accept = await json(
    `/plans/${gen.body.planId}/accept`,
    post(`/plans/${gen.body.planId}/accept`, { acknowledgeSafety: true }, csrf, cookies),
  );
  expect(accept.status, 'plan accept').toBe(200);
  return { cookies, csrf, planId: gen.body.planId };
}
