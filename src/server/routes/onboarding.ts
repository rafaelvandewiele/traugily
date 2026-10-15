/** Onboarding: resumable step machine that persists to canonical profile tables. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import {
  onboardingBasicsSchema,
  onboardingGoalsSchema,
  onboardingLifestyleSchema,
  onboardingNutritionSchema,
  onboardingSafetySchema,
  onboardingTrainingSchema,
} from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';

export const onboardingRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const STEP_ORDER = ['basics', 'goals', 'training', 'lifestyle', 'nutrition', 'safety'] as const;

const SCHEMAS: Record<
  string,
  {
    safeParse: (v: unknown) => {
      success: boolean;
      data?: unknown;
      error?: { issues: Array<{ message: string; path: PropertyKey[] }> };
    };
  }
> = {
  basics: onboardingBasicsSchema,
  goals: onboardingGoalsSchema,
  training: onboardingTrainingSchema,
  lifestyle: onboardingLifestyleSchema,
  nutrition: onboardingNutritionSchema,
  safety: onboardingSafetySchema,
};

onboardingRoutes.get('/', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const row = await c.env.DB.prepare(
    `SELECT step, data, updated_at FROM onboarding_progress WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .first<{ step: string; data: string; updated_at: string }>();
  const profile = await c.env.DB.prepare(`SELECT * FROM profiles WHERE user_id = ?`)
    .bind(auth.user.id)
    .first<Record<string, unknown>>();
  return c.json({
    progress: row
      ? { step: row.step, data: JSON.parse(row.data), updatedAt: row.updated_at }
      : null,
    completed: !!profile?.onboarding_completed_at,
    profile: profile
      ? {
          birthYear: profile.birth_year,
          ageBand: profile.age_band,
          sex: profile.sex,
          heightCm: profile.height_cm,
          weightKg: profile.weight_kg,
          country: profile.country,
          activityLevel: profile.activity_level,
          workPattern: profile.work_pattern,
          sleepIndicator: profile.sleep_indicator,
          stressIndicator: profile.stress_indicator,
          stepGoal: profile.step_goal,
        }
      : null,
  });
});

onboardingRoutes.put('/:step', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const step = c.req.param('step');
  const schema = SCHEMAS[step];
  if (!schema) throw notFound('Unknown onboarding step');
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error?.issues?.[0];
    throw badRequest(
      issue?.message ?? 'Please check the highlighted fields.',
      issue?.path?.join('.'),
    );
  }

  const now = nowIso();
  const existing = await c.env.DB.prepare(`SELECT data FROM onboarding_progress WHERE user_id = ?`)
    .bind(auth.user.id)
    .first<{ data: string }>();
  const merged: Record<string, unknown> = {
    ...(existing ? JSON.parse(existing.data) : {}),
    [step]: parsed.data,
  };

  const doneSteps = STEP_ORDER.filter((s) => merged[s] != null);
  const nextStep = STEP_ORDER.find((s) => merged[s] == null) ?? 'safety';
  const completedAll = doneSteps.length === STEP_ORDER.length;

  await c.env.DB.prepare(
    `INSERT INTO onboarding_progress (user_id, step, data, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET step = excluded.step, data = excluded.data,
       updated_at = excluded.updated_at`,
  )
    .bind(auth.user.id, nextStep, JSON.stringify(merged), now)
    .run();

  await applyStepToTables(c.env, auth.user.id, step, parsed.data);

  if (completedAll) {
    await c.env.DB.prepare(
      `UPDATE profiles SET onboarding_completed_at = COALESCE(onboarding_completed_at, ?),
       updated_at = ? WHERE user_id = ?`,
    )
      .bind(now, now, auth.user.id)
      .run();
  }

  return c.json({ ok: true, nextStep, completed: completedAll });
});

async function applyStepToTables(
  env: Env,
  userId: string,
  step: string,
  data: unknown,
): Promise<void> {
  const now = nowIso();
  const db = env.DB;

  if (step === 'basics') {
    const d = data as Record<string, unknown>;
    await db
      .prepare(
        `UPDATE profiles SET birth_year = COALESCE(?, birth_year), age_band = COALESCE(?, age_band),
           sex = COALESCE(?, sex), height_cm = COALESCE(?, height_cm), weight_kg = COALESCE(?, weight_kg),
           country = COALESCE(?, country), unit_system = COALESCE(?, unit_system), updated_at = ?
         WHERE user_id = ?`,
      )
      .bind(
        d.birthYear ?? null,
        d.ageBand ?? null,
        d.sex ?? null,
        d.heightCm ?? null,
        d.weightKg ?? null,
        d.country ?? null,
        d.unitSystem ?? null,
        now,
        userId,
      )
      .run();
    if (d.unitSystem) {
      await db
        .prepare(`UPDATE users SET unit_system = ?, updated_at = ? WHERE id = ?`)
        .bind(d.unitSystem, now, userId)
        .run();
    }
  }

  if (step === 'goals') {
    const d = data as {
      goals: Array<{ goalType: string; priority: number }>;
      targetWeeks: number;
      acknowledgedRange: boolean;
    };
    await db.prepare(`DELETE FROM goals WHERE user_id = ?`).bind(userId).run();
    for (const g of d.goals) {
      await db
        .prepare(
          `INSERT INTO goals (id, user_id, goal_type, priority, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(newId('goa'), userId, g.goalType, g.priority, now)
        .run();
    }
    await db
      .prepare(
        `INSERT INTO goal_timeframes (user_id, target_weeks, acknowledged_realistic_range, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET target_weeks = excluded.target_weeks,
           acknowledged_realistic_range = excluded.acknowledged_realistic_range,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, d.targetWeeks, d.acknowledgedRange ? 1 : 0, now)
      .run();
  }

  if (step === 'training') {
    const d = data as {
      experienceLevel: string;
      priorTraining?: string;
      knownLifts?: string;
      preferredWeekdays: number[];
      minutesPerSession: number;
      locations: string[];
      equipment: Array<{ category: string; status: string; muscleGroup?: string }>;
      exclusions: Array<{
        exerciseId?: string;
        replacementGroup?: string;
        reasonCode: string;
        reasonNote?: string;
      }>;
      blockedDates: Array<{ startDate: string; endDate: string }>;
    };
    await db
      .prepare(
        `INSERT INTO training_background (user_id, experience_level, prior_training, known_lifts, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET experience_level = excluded.experience_level,
           prior_training = excluded.prior_training, known_lifts = excluded.known_lifts,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, d.experienceLevel, d.priorTraining ?? null, d.knownLifts ?? null, now)
      .run();

    await db.prepare(`DELETE FROM availability WHERE user_id = ?`).bind(userId).run();
    for (const wd of d.preferredWeekdays) {
      await db
        .prepare(
          `INSERT INTO availability (id, user_id, weekday, preferred, minutes, created_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(newId('avl'), userId, wd, d.minutesPerSession, now)
        .run();
    }

    await db.prepare(`DELETE FROM training_locations WHERE user_id = ?`).bind(userId).run();
    for (const loc of d.locations) {
      await db
        .prepare(
          `INSERT INTO training_locations (id, user_id, kind, created_at) VALUES (?, ?, ?, ?)`,
        )
        .bind(newId('loc'), userId, loc, now)
        .run();
    }

    await db.prepare(`DELETE FROM equipment WHERE user_id = ?`).bind(userId).run();
    for (const eq of d.equipment) {
      await db
        .prepare(
          `INSERT INTO equipment (id, user_id, category, status, muscle_group, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId('eqp'), userId, eq.category, eq.status, eq.muscleGroup ?? null, now)
        .run();
    }

    await db.prepare(`DELETE FROM exercise_exclusions WHERE user_id = ?`).bind(userId).run();
    for (const ex of d.exclusions) {
      await db
        .prepare(
          `INSERT INTO exercise_exclusions (id, user_id, exercise_id, replacement_group, reason_code,
           reason_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId('exc'),
          userId,
          ex.exerciseId ?? null,
          ex.replacementGroup ?? null,
          ex.reasonCode,
          ex.reasonNote ?? null,
          now,
        )
        .run();
    }

    await db.prepare(`DELETE FROM blocked_dates WHERE user_id = ?`).bind(userId).run();
    for (const bd of d.blockedDates) {
      await db
        .prepare(
          `INSERT INTO blocked_dates (id, user_id, start_date, end_date, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(newId('blk'), userId, bd.startDate, bd.endDate, now)
        .run();
    }
  }

  if (step === 'lifestyle') {
    const d = data as Record<string, unknown>;
    await db
      .prepare(
        `UPDATE profiles SET activity_level = COALESCE(?, activity_level),
           work_pattern = COALESCE(?, work_pattern), sleep_indicator = COALESCE(?, sleep_indicator),
           stress_indicator = COALESCE(?, stress_indicator), step_goal = COALESCE(?, step_goal),
           updated_at = ?
         WHERE user_id = ?`,
      )
      .bind(
        d.activityLevel ?? null,
        d.workPattern ?? null,
        d.sleepIndicator ?? null,
        d.stressIndicator ?? null,
        d.stepGoal ?? null,
        now,
        userId,
      )
      .run();
  }

  if (step === 'nutrition') {
    const d = data as Record<string, unknown>;
    await db
      .prepare(
        `INSERT INTO nutrition_preferences (user_id, eating_pattern, allergies, avoid_ingredients,
           budget_level, cooking_time, meal_count, meal_timing, tracking_detail, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET eating_pattern = excluded.eating_pattern,
           allergies = excluded.allergies, avoid_ingredients = excluded.avoid_ingredients,
           budget_level = excluded.budget_level, cooking_time = excluded.cooking_time,
           meal_count = excluded.meal_count, meal_timing = excluded.meal_timing,
           tracking_detail = excluded.tracking_detail, updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        d.eatingPattern,
        JSON.stringify(d.allergies ?? []),
        JSON.stringify(d.avoidIngredients ?? []),
        d.budgetLevel,
        d.cookingTime,
        d.mealCount,
        d.mealTiming ?? null,
        d.trackingDetail,
        now,
      )
      .run();
  }
}
