/** Progress summaries: trends, consistency, PRs, goal reviews (direction, never promises). */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { unauthorized } from '../lib/errors';
import { newId, nowIso, todayIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';

export const progressSummaryRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

progressSummaryRoutes.get('/summary', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();

  const [sessions, weighIns, prs, missed, painCount] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS completed FROM workout_executions WHERE user_id = ? AND state = 'completed'`,
    )
      .bind(auth.user.id)
      .first<{ completed: number }>(),
    c.env.DB.prepare(
      `SELECT entry_date, weight_kg FROM weigh_ins
       WHERE user_id = ? AND skipped = 0 ORDER BY entry_date DESC LIMIT 20`,
    )
      .bind(auth.user.id)
      .all<{ entry_date: string; weight_kg: number }>(),
    c.env.DB.prepare(
      `SELECT e.name_en, pr.record_kind, pr.value, pr.unit, pr.achieved_date
       FROM personal_records pr JOIN exercises e ON e.id = pr.exercise_id
       WHERE pr.user_id = ? ORDER BY pr.achieved_date DESC LIMIT 20`,
    )
      .bind(auth.user.id)
      .all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM scheduled_sessions ss
       JOIN plans p ON p.current_version_id = ss.version_id
       WHERE p.user_id = ? AND ss.status = 'skipped'`,
    )
      .bind(auth.user.id)
      .first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM pain_reports WHERE user_id = ?`)
      .bind(auth.user.id)
      .first<{ n: number }>(),
  ]);

  // Moving average trend — descriptive only, never a diagnosis.
  const weights = weighIns.results.map((w) => w.weight_kg).reverse();
  const movingAvg: number[] = [];
  for (let i = 0; i < weights.length; i++) {
    const slice = weights.slice(Math.max(0, i - 2), i + 1);
    movingAvg.push(Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 10) / 10);
  }
  const latest = weights.length > 0 ? weights[weights.length - 1] : null;
  const previous = weights.length > 1 ? weights[weights.length - 2] : null;

  return c.json({
    completedSessions: sessions?.completed ?? 0,
    missedSessions: missed?.n ?? 0,
    painReportCount: painCount?.n ?? 0,
    weight: {
      latest,
      previous,
      changeSincePrevious:
        latest != null && previous != null ? Math.round((latest - previous) * 10) / 10 : null,
      movingAverage3: movingAvg,
      dataPoints: weights.length,
      trendNoteKey: 'progress.weight.trend_note',
    },
    personalRecords: prs.results,
    noticeKey: 'progress.summary.not_medical_advice',
  });
});

progressSummaryRoutes.get('/goal-review', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT review_date, period_start, period_end, summary FROM goal_reviews
     WHERE user_id = ? ORDER BY review_date DESC LIMIT 10`,
  )
    .bind(auth.user.id)
    .all();
  return c.json({ reviews: rows.results });
});

progressSummaryRoutes.post('/goal-review', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = (await c.req.json().catch(() => ({}))) as {
    periodStart?: string;
    periodEnd?: string;
  };
  const periodStart =
    body.periodStart ?? new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const periodEnd = body.periodEnd ?? todayIso();

  const [completed, planned, weighIns, goals] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM workout_executions
       WHERE user_id = ? AND state = 'completed' AND substr(started_at, 1, 10) BETWEEN ? AND ?`,
    )
      .bind(auth.user.id, periodStart, periodEnd)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM scheduled_sessions ss
       JOIN plans p ON p.current_version_id = ss.version_id
       WHERE p.user_id = ? AND ss.kind = 'workout' AND ss.scheduled_date BETWEEN ? AND ?`,
    )
      .bind(auth.user.id, periodStart, periodEnd)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT weight_kg FROM weigh_ins
       WHERE user_id = ? AND skipped = 0 AND entry_date BETWEEN ? AND ? ORDER BY entry_date`,
    )
      .bind(auth.user.id, periodStart, periodEnd)
      .all<{ weight_kg: number }>(),
    c.env.DB.prepare(`SELECT goal_type FROM goals WHERE user_id = ? ORDER BY priority`)
      .bind(auth.user.id)
      .all<{ goal_type: string }>(),
  ]);

  const weights = weighIns.results.map((w) => w.weight_kg);
  const trendDirection =
    weights.length >= 2
      ? weights[weights.length - 1] > weights[0] + 0.2
        ? 'up'
        : weights[weights.length - 1] < weights[0] - 0.2
          ? 'down'
          : 'steady'
      : 'insufficient_data';

  const summary = {
    completedSessions: completed?.n ?? 0,
    plannedSessions: planned?.n ?? 0,
    consistencyPercent:
      planned && planned.n > 0 ? Math.round(((completed?.n ?? 0) / planned.n) * 100) : null,
    weightTrendDirection: trendDirection,
    weightDataPoints: weights.length,
    goals: goals.results.map((g) => g.goal_type),
    interpretationKey: 'progress.goal_review.interpretation',
  };

  await c.env.DB.prepare(
    `INSERT INTO goal_reviews (id, user_id, review_date, period_start, period_end, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId('grv'),
      auth.user.id,
      todayIso(),
      periodStart,
      periodEnd,
      JSON.stringify(summary),
      nowIso(),
    )
    .run();

  return c.json({ summary });
});
