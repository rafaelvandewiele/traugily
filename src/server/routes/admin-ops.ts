/** Admin ops: feature flags, audit logs, rule/prompt versions, translation overview. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { featureFlagSchema } from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { writeAudit } from '../lib/audit';

export const adminOpsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

adminOpsRoutes.use('*', requireAdmin);

adminOpsRoutes.get('/flags', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT key, description, enabled, audience, updated_by, updated_at
     FROM feature_flags ORDER BY key`,
  ).all();
  return c.json({ flags: rows.results });
});

adminOpsRoutes.put('/flags/:key', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = featureFlagSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Invalid flag payload.');
  const key = c.req.param('key');
  const before = await c.env.DB.prepare(`SELECT enabled FROM feature_flags WHERE key = ?`)
    .bind(key)
    .first<{ enabled: number }>();
  if (!before) throw notFound('Flag not found.');
  await c.env.DB.prepare(
    `UPDATE feature_flags SET enabled = ?, description = COALESCE(?, description),
       updated_by = ?, updated_at = ? WHERE key = ?`,
  )
    .bind(parsed.data.enabled ? 1 : 0, parsed.data.description ?? null, auth.user.id, nowIso(), key)
    .run();
  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'admin' },
    action: 'feature_flag_updated',
    targetType: 'feature_flag',
    targetId: key,
    beforeState: { enabled: !!before.enabled },
    afterState: { enabled: parsed.data.enabled },
    requestId: c.get('requestId'),
  });
  return c.json({ ok: true });
});

adminOpsRoutes.get('/audit-logs', async (c) => {
  const targetId = c.req.query('targetId');
  const sql = `SELECT id, actor_user_id, actor_role, action, target_type, target_id,
      before_state, after_state, request_id, created_at
    FROM audit_logs ${targetId ? 'WHERE target_id = ?' : ''} ORDER BY created_at DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql)
    .bind(...(targetId ? [targetId] : []))
    .all();
  return c.json({ logs: rows.results });
});

adminOpsRoutes.get('/rule-versions', async (c) => {
  const [planRules, prompts, safetyRules] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, kind, version, status, created_by, created_at FROM plan_rule_versions
       ORDER BY kind, version DESC`,
    ).all(),
    c.env.DB.prepare(
      `SELECT id, purpose, version, status, created_by, created_at FROM prompt_versions
       ORDER BY purpose, version DESC`,
    ).all(),
    c.env.DB.prepare(
      `SELECT id, rule_code, version, severity, guidance_key, status, reviewed_by, reviewed_at, updated_at
       FROM safety_rules ORDER BY rule_code`,
    ).all(),
  ]);
  return c.json({
    planRules: planRules.results,
    prompts: prompts.results,
    safetyRules: safetyRules.results,
  });
});

adminOpsRoutes.get('/translations', async (c) => {
  const locale = c.req.query('locale');
  const sql = `SELECT exercise_id, locale, name, source, updated_at FROM exercise_translations
    ${locale ? 'WHERE locale = ?' : ''} ORDER BY exercise_id, locale LIMIT 300`;
  const rows = await c.env.DB.prepare(sql)
    .bind(...(locale ? [locale] : []))
    .all();
  return c.json({ translations: rows.results });
});
