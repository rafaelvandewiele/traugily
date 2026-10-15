/** Nutrition: targets (floored estimates), meal suggestions, food logs. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { foodLogSchema } from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { newId, nowIso, todayIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';

export const nutritionRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

nutritionRoutes.get('/targets', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const today = todayIso();
  const row = await c.env.DB.prepare(
    `SELECT nt.energy_kcal, nt.protein_g, nt.carbs_g, nt.fat_g, nt.detail_level, nt.basis,
            nt.phase_key, nt.effective_from
     FROM nutrition_targets nt
     JOIN plans p ON p.id = nt.plan_id
     WHERE p.user_id = ? AND nt.effective_from <= ?
       AND (nt.effective_to IS NULL OR nt.effective_to >= ?)
     ORDER BY nt.effective_from DESC LIMIT 1`,
  )
    .bind(auth.user.id, today, today)
    .first<{
      energy_kcal: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      detail_level: string;
      basis: string;
      phase_key: string | null;
      effective_from: string;
    }>();
  if (!row) throw notFound('No nutrition targets yet. Accept a plan first.');
  return c.json({
    targets: {
      energyKcal: row.energy_kcal,
      proteinG: row.protein_g,
      carbsG: row.carbs_g,
      fatG: row.fat_g,
      detailLevel: row.detail_level,
      basis: row.basis,
      phaseKey: row.phase_key,
      effectiveFrom: row.effective_from,
    },
    noticeKey: 'nutrition.targets.estimate_notice',
  });
});

nutritionRoutes.get('/suggestions', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const locale = c.req.query('locale') ?? auth.user.locale;
  const category = c.req.query('category');
  const prefs = await c.env.DB.prepare(
    `SELECT eating_pattern, allergies, avoid_ingredients, meal_count, tracking_detail
     FROM nutrition_preferences WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .first<{
      eating_pattern: string;
      allergies: string;
      avoid_ingredients: string;
      meal_count: number | null;
      tracking_detail: string;
    }>();

  const sql = `SELECT ms.id, ms.slug, ms.category, ms.tags, ms.approx_kcal, ms.approx_protein_g,
      mst.title, mst.description, mst.ingredients, mst.steps, mst.substitutions
    FROM meal_suggestions ms
    LEFT JOIN meal_suggestion_translations mst
      ON mst.suggestion_id = ms.id AND mst.locale = ?
    WHERE ms.status = 'published' ${category ? 'AND ms.category = ?' : ''}
    ORDER BY ms.category, ms.slug LIMIT 40`;
  const rows = await c.env.DB.prepare(sql)
    .bind(...(category ? [locale, category] : [locale]))
    .all<{
      id: string;
      slug: string;
      category: string;
      tags: string;
      approx_kcal: number | null;
      approx_protein_g: number | null;
      title: string | null;
      description: string | null;
      ingredients: string | null;
      steps: string | null;
      substitutions: string | null;
    }>();

  const allergies = new Set(
    prefs ? (JSON.parse(prefs.allergies) as string[]).map((a) => a.toLowerCase()) : [],
  );
  const avoid = new Set(
    prefs ? (JSON.parse(prefs.avoid_ingredients) as string[]).map((a) => a.toLowerCase()) : [],
  );

  const suggestions = rows.results
    .map((r) => {
      const ingredients = r.ingredients ? (JSON.parse(r.ingredients) as string[]) : [];
      const lower = ingredients.map((i) => i.toLowerCase());
      const allergyHit = lower.some((i) => [...allergies].some((a) => i.includes(a)));
      const avoidHit = lower.some((i) => [...avoid].some((a) => i.includes(a)));
      return {
        id: r.id,
        slug: r.slug,
        category: r.category,
        tags: JSON.parse(r.tags) as string[],
        approxKcal: r.approx_kcal,
        approxProteinG: r.approx_protein_g,
        title: r.title ?? r.slug,
        description: r.description ?? '',
        ingredients,
        steps: r.steps ? (JSON.parse(r.steps) as string[]) : [],
        substitutions: r.substitutions ? (JSON.parse(r.substitutions) as string[]) : [],
        translationFallback: r.title == null,
        flagReason: allergyHit ? 'allergy_match' : avoidHit ? 'avoid_match' : null,
        accuracy: 'coarse_estimate',
      };
    })
    .filter((s) => s.flagReason !== 'allergy_match');

  return c.json({
    suggestions,
    preferences: prefs
      ? {
          eatingPattern: prefs.eating_pattern,
          mealCount: prefs.meal_count,
          trackingDetail: prefs.tracking_detail,
        }
      : null,
    noticeKey: 'nutrition.suggestions.estimate_notice',
  });
});

nutritionRoutes.post('/logs', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = foodLogSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid meal entry.', issue?.path.join('.'));
  }
  const d = parsed.data;
  const id = newId('fod');
  await c.env.DB.prepare(
    `INSERT INTO food_logs (id, user_id, logged_date, meal_slot, description, source, accuracy,
       approx_kcal, approx_protein_g, approx_carbs_g, approx_fat_g, suggestion_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      auth.user.id,
      d.loggedDate,
      d.mealSlot,
      d.description,
      d.source,
      d.accuracy,
      d.approxKcal ?? null,
      d.approxProteinG ?? null,
      d.approxCarbsG ?? null,
      d.approxFatG ?? null,
      d.suggestionId ?? null,
      d.note ?? null,
      nowIso(),
    )
    .run();
  return c.json({ ok: true, id, accuracyNoticeKey: 'nutrition.logs.accuracy_notice' });
});

nutritionRoutes.get('/logs', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const from = c.req.query('from') ?? todayIso();
  const to = c.req.query('to') ?? todayIso();
  const rows = await c.env.DB.prepare(
    `SELECT id, logged_date, meal_slot, description, source, accuracy, approx_kcal,
            approx_protein_g, approx_carbs_g, approx_fat_g
     FROM food_logs
     WHERE user_id = ? AND deleted_at IS NULL AND logged_date BETWEEN ? AND ?
     ORDER BY logged_date, created_at`,
  )
    .bind(auth.user.id, from, to)
    .all();
  return c.json({ logs: rows.results });
});
