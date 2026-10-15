/** Nutrition extras: calm within-week adjustment + shopping list. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { notFound, unauthorized } from '../lib/errors';
import { nowIso, todayIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { withinWeekAdjustment } from '../../domain/nutrition-targets';

export const nutritionExtraRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

nutritionExtraRoutes.get('/adjustment', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const target = await c.env.DB.prepare(
    `SELECT nt.energy_kcal FROM nutrition_targets nt
     JOIN plans p ON p.id = nt.plan_id
     WHERE p.user_id = ? AND p.status = 'active'
       AND nt.effective_from <= ? AND (nt.effective_to IS NULL OR nt.effective_to >= ?)
     ORDER BY nt.effective_from DESC LIMIT 1`,
  )
    .bind(auth.user.id, todayIso(), todayIso())
    .first<{ energy_kcal: number }>();
  if (!target) return c.json({ adjustment: null });

  const weekStart = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const logs = await c.env.DB.prepare(
    `SELECT logged_date, SUM(COALESCE(approx_kcal, 0)) AS kcal FROM food_logs
     WHERE user_id = ? AND logged_date >= ? AND deleted_at IS NULL
     GROUP BY logged_date`,
  )
    .bind(auth.user.id, weekStart)
    .all<{ logged_date: string; kcal: number }>();
  const byDate = new Map(logs.results.map((l) => [l.logged_date, l.kcal]));
  const weekKcal = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000).toISOString().slice(0, 10);
    return byDate.get(d) ?? 0;
  });
  // Never extreme compensation: at most a calm, optional within-week adjustment.
  return c.json({ adjustment: withinWeekAdjustment(weekKcal, target.energy_kcal) });
});

nutritionExtraRoutes.get('/shopping-list', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT id, label, quantity, unit, meal_slot, checked, week_start
     FROM shopping_list_items WHERE user_id = ?
     ORDER BY checked, label LIMIT 200`,
  )
    .bind(auth.user.id)
    .all();
  return c.json({ items: rows.results });
});

nutritionExtraRoutes.post('/shopping-list/:id/toggle', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const id = c.req.param('id');
  const item = await c.env.DB.prepare(
    `SELECT checked FROM shopping_list_items WHERE id = ? AND user_id = ?`,
  )
    .bind(id, auth.user.id)
    .first<{ checked: number }>();
  if (!item) throw notFound('Shopping list item not found.');
  await c.env.DB.prepare(`UPDATE shopping_list_items SET checked = ?, updated_at = ? WHERE id = ?`)
    .bind(item.checked ? 0 : 1, nowIso(), id)
    .run();
  return c.json({ ok: true, checked: !item.checked });
});
