/** Plan routes: generate, fetch active, accept. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { acceptPlanSchema } from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { nowIso, todayIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { writeAudit } from '../lib/audit';
import { generateAndStorePlan } from '../services/plan-service';
import { loadPlanGeneratorInput } from '../services/plan-catalogue';

export const planRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------- Generate draft plan ------------------------- */

planRoutes.post('/generate', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const profile = await c.env.DB.prepare(
    `SELECT onboarding_completed_at FROM profiles WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .first<{ onboarding_completed_at: string | null }>();
  if (!profile?.onboarding_completed_at) {
    throw badRequest('Please complete onboarding first so your plan fits your situation.');
  }

  const input = await loadPlanGeneratorInput(c.env, auth.user.id, todayIso());
  if (input.catalogue.length === 0) {
    throw badRequest(
      'The exercise catalogue is empty. An administrator must publish exercises first.',
    );
  }
  const { plan, violations } = await generateAndStorePlan(c.env.DB, auth.user.id, input, 'system');
  return c.json({ planId: plan.planId, versionId: plan.versionId, draft: plan.draft, violations });
});

/* --------------------------- Active plan view --------------------------- */

planRoutes.get('/active', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const plan = await c.env.DB.prepare(
    `SELECT id, current_version_id, status, goal_duration_weeks, nutrition_framework,
            safety_acknowledged_at, activated_at, created_at
     FROM plans WHERE user_id = ? AND status IN ('draft','active')
     ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
  )
    .bind(auth.user.id)
    .first<{
      id: string;
      current_version_id: string | null;
      status: string;
      goal_duration_weeks: number;
      nutrition_framework: string;
      safety_acknowledged_at: string | null;
      activated_at: string | null;
      created_at: string;
    }>();
  if (!plan || !plan.current_version_id)
    throw notFound('No plan yet. Generate one from onboarding.');

  const versionId = plan.current_version_id;
  const [phases, weekly, sessions, proposals, version] = await Promise.all([
    c.env.DB.prepare(
      `SELECT phase_key, title_key, purpose, start_date, end_date, position
       FROM plan_phases WHERE version_id = ? ORDER BY position`,
    )
      .bind(versionId)
      .all(),
    c.env.DB.prepare(
      `SELECT weekday, kind, label_key FROM weekly_schedules WHERE version_id = ? ORDER BY weekday`,
    )
      .bind(versionId)
      .all(),
    c.env.DB.prepare(
      `SELECT id, scheduled_date, weekday, kind, title_key, focus_key, duration_minutes, status
       FROM scheduled_sessions WHERE version_id = ? ORDER BY scheduled_date`,
    )
      .bind(versionId)
      .all(),
    c.env.DB.prepare(
      `SELECT id, trigger_code, reason_key, changed_fields, effective_date, explanation_key,
              explanation_params, status, created_at
       FROM adaptation_proposals WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC`,
    )
      .bind(auth.user.id)
      .all<{
        id: string;
        trigger_code: string;
        reason_key: string;
        changed_fields: string;
        effective_date: string;
        explanation_key: string;
        explanation_params: string;
        status: string;
        created_at: string;
      }>(),
    c.env.DB.prepare(`SELECT version FROM plan_versions WHERE id = ?`)
      .bind(versionId)
      .first<{ version: number }>(),
  ]);

  return c.json({
    plan: {
      id: plan.id,
      status: plan.status,
      goalDurationWeeks: plan.goal_duration_weeks,
      safetyAcknowledgedAt: plan.safety_acknowledged_at,
      activatedAt: plan.activated_at,
      nutritionFramework: JSON.parse(plan.nutrition_framework),
      version: version?.version ?? 1,
    },
    phases: phases.results,
    weeklySchedule: weekly.results,
    sessions: sessions.results,
    pendingProposals: proposals.results.map((p) => ({
      id: p.id,
      triggerCode: p.trigger_code,
      reasonKey: p.reason_key,
      changedFields: JSON.parse(p.changed_fields),
      effectiveDate: p.effective_date,
      explanationKey: p.explanation_key,
      explanationParams: JSON.parse(p.explanation_params),
      status: p.status,
      createdAt: p.created_at,
    })),
  });
});

/* ------------------------------- Accept ------------------------------- */

planRoutes.post('/:id/accept', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = acceptPlanSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Safety confirmation is required to activate a plan.');

  const planId = c.req.param('id');
  const plan = await c.env.DB.prepare(`SELECT id FROM plans WHERE id = ? AND user_id = ?`)
    .bind(planId, auth.user.id)
    .first<{ id: string }>();
  if (!plan) throw notFound('Plan not found.');

  const now = nowIso();
  await c.env.DB.prepare(
    `UPDATE plans SET status = 'active', safety_acknowledged_at = ?, activated_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(now, now, now, planId)
    .run();
  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'member' },
    action: 'plan_accepted',
    targetType: 'plan',
    targetId: planId,
    afterState: { status: 'active' },
  });
  return c.json({ ok: true, status: 'active' });
});
