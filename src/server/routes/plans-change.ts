/** Plan length changes (before/after diff with confirmation) + plain-language explanation. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { planLengthChangeSchema } from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { newId, nowIso, todayIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { writeAudit } from '../lib/audit';
import { diffPlanLength, storePlanDraft } from '../services/plan-service';
import { loadPlanGeneratorInput, loadCatalogue } from '../services/plan-catalogue';
import { explainWithAi } from '../services/ai';
import { generatePlan } from '../../domain/plan-engine';

export const planChangeRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

planChangeRoutes.post('/:id/preview-length', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = planLengthChangeSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Choose a new plan length between 4 and 104 weeks.');

  const planId = c.req.param('id');
  const plan = await c.env.DB.prepare(
    `SELECT id, current_version_id, goal_duration_weeks FROM plans WHERE id = ? AND user_id = ?`,
  )
    .bind(planId, auth.user.id)
    .first<{ id: string; current_version_id: string | null; goal_duration_weeks: number }>();
  if (!plan || !plan.current_version_id) throw notFound('Plan not found.');

  const phase = await c.env.DB.prepare(
    `SELECT start_date FROM plan_phases WHERE version_id = ? ORDER BY position LIMIT 1`,
  )
    .bind(plan.current_version_id)
    .first<{ start_date: string }>();
  const goalTypes = (
    await c.env.DB.prepare(`SELECT goal_type FROM goals WHERE user_id = ? ORDER BY priority`)
      .bind(auth.user.id)
      .all<{ goal_type: string }>()
  ).results.map((g) => g.goal_type);

  const diff = diffPlanLength(
    plan.goal_duration_weeks,
    parsed.data.targetWeeks,
    phase?.start_date ?? todayIso(),
    goalTypes,
  );
  return c.json({ diff, requiresConfirmation: true });
});

planChangeRoutes.post('/:id/apply-length', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = planLengthChangeSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Invalid plan length.');
  const confirmed = (body as { confirmed?: boolean })?.confirmed === true;
  if (!confirmed) {
    throw badRequest(
      'Please review the before/after comparison and confirm the change.',
      'confirmed',
    );
  }

  const planId = c.req.param('id');
  const plan = await c.env.DB.prepare(
    `SELECT id, status, current_version_id, goal_duration_weeks FROM plans
     WHERE id = ? AND user_id = ?`,
  )
    .bind(planId, auth.user.id)
    .first<{
      id: string;
      status: string;
      current_version_id: string | null;
      goal_duration_weeks: number;
    }>();
  if (!plan || !plan.current_version_id) throw notFound('Plan not found.');
  if (plan.status === 'draft') throw badRequest('Activate the plan before changing its length.');

  const input = await loadPlanGeneratorInput(c.env, auth.user.id, todayIso());
  input.goalDurationWeeks = parsed.data.targetWeeks;

  const db = c.env.DB;
  const now = nowIso();
  const prevVersion = await db
    .prepare(`SELECT MAX(version) AS v FROM plan_versions WHERE plan_id = ?`)
    .bind(planId)
    .first<{ v: number | null }>();
  const newVersion = (prevVersion?.v ?? 1) + 1;
  const versionId = newId('plv');
  const draft = generatePlan(input);

  await db.batch([
    db
      .prepare(
        `INSERT INTO plan_versions (id, plan_id, version, reason, created_by, created_at)
         VALUES (?, ?, ?, 'length_change', 'member', ?)`,
      )
      .bind(versionId, planId, newVersion, now),
    db
      .prepare(
        `UPDATE plans SET current_version_id = ?, goal_duration_weeks = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(versionId, parsed.data.targetWeeks, now, planId),
  ]);
  await storePlanDraft(db, auth.user.id, versionId, draft);

  await writeAudit(db, {
    actor: { userId: auth.user.id, role: 'member' },
    action: 'plan_length_changed',
    targetType: 'plan',
    targetId: planId,
    beforeState: { weeks: plan.goal_duration_weeks, version: newVersion - 1 },
    afterState: { weeks: parsed.data.targetWeeks, version: newVersion },
  });

  return c.json({
    ok: true,
    version: newVersion,
    diff: diffPlanLength(
      plan.goal_duration_weeks,
      parsed.data.targetWeeks,
      input.startDate,
      input.goalTypes,
    ),
  });
});

/* ------------------- Plain-language plan explanation (AI-constrained) ------------------- */

planChangeRoutes.get('/explanation', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const flag = await c.env.DB.prepare(
    `SELECT enabled FROM feature_flags WHERE key = 'ai_explanations'`,
  ).first<{ enabled: number }>();
  const catalogue = await loadCatalogue(c.env.DB);
  const plan = await c.env.DB.prepare(
    `SELECT id FROM plans WHERE user_id = ? AND status = 'active' LIMIT 1`,
  )
    .bind(auth.user.id)
    .first<{ id: string }>();

  const fallback = plan
    ? 'Your plan starts conservatively, keeps at least one full rest day each week, and only progresses when your logged sessions show you are recovering well.'
    : 'Complete onboarding to receive your personalised plan.';

  if (!flag?.enabled) return c.json({ text: fallback, source: 'fallback' as const });
  const result = await explainWithAi(c.env, {
    purpose: 'plan_explanation',
    locale: auth.user.locale,
    promptVersion: 'pv_plan_expl_1',
    allowedExerciseIds: catalogue.slice(0, 50).map((e) => e.id),
    signalSummary: { catalogueSize: catalogue.length },
    fallbackExplanation: fallback,
  });
  return c.json(result);
});
