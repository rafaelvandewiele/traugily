/** Safety: one-action discomfort/pain reporting with conservative rule evaluation. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { painReportSchema } from '../../shared/contracts';
import { badRequest, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { evaluateSafetyReport, type SafetyRule } from '../../domain/safety-rules';
import { recordOperationalEvent } from '../lib/audit';

export const safetyRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

safetyRoutes.post('/report', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = painReportSchema.safeParse(body);
  if (!parsed.success)
    throw badRequest('Please describe what you feel (optional) and the severity.');
  const d = parsed.data;

  const rules = await loadSafetyRules(c.env);
  const recent = await c.env.DB.prepare(
    `SELECT severity, body_area, reported_at FROM pain_reports
     WHERE user_id = ? ORDER BY reported_at DESC LIMIT 20`,
  )
    .bind(auth.user.id)
    .all<{ severity: string; body_area: string; reported_at: string }>();

  const evaluation = evaluateSafetyReport({
    severity: d.severity,
    note: d.note,
    bodyArea: d.bodyArea,
    rules,
    recentReports: recent.results.map((r) => ({
      severity: r.severity,
      bodyArea: r.body_area,
      reportedAt: r.reported_at,
    })),
  });

  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO pain_reports (id, user_id, workout_id, performed_exercise_id, severity, body_area,
       note, triggered_rule_id, guidance_key, reported_at, follow_up_required)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId('pin'),
      auth.user.id,
      d.workoutId ?? null,
      null,
      d.severity,
      d.bodyArea,
      d.note ?? null,
      evaluation.matchedRuleId,
      evaluation.guidanceKey ?? 'safety.guidance.none',
      now,
      evaluation.requiresFollowUp ? 1 : 0,
    )
    .run();

  // Log only the rule outcome — never the member's free text — to broad ops logs.
  if (evaluation.severity === 'urgent') {
    await recordOperationalEvent(c.env.DB, {
      kind: 'safety_urgent',
      severity: 'error',
      subject: auth.user.id,
      detail: { ruleId: evaluation.matchedRuleId, requestId: c.get('requestId') },
      requestId: c.get('requestId'),
    });
  }

  return c.json({
    ok: true,
    evaluation: {
      severity: evaluation.severity,
      guidanceKey: evaluation.guidanceKey,
      stopTraining: evaluation.stopTraining,
      requiresFollowUp: evaluation.requiresFollowUp,
      blockedRuleId: evaluation.matchedRuleId,
      // Explicit, localized member-facing guidance keys:
      // urgent → stop training and seek suitable urgent/medical help (no alternative forced)
      // pain → see a qualified healthcare professional before resuming the movement
      // discomfort → advice to adjust, monitor, and stop if it worsens
    },
  });
});

safetyRoutes.get('/status/:workoutId', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT id, severity, body_area, triggered_rule_id, guidance_key, reported_at, follow_up_required
     FROM pain_reports WHERE user_id = ? AND workout_id = ?
     ORDER BY reported_at DESC`,
  )
    .bind(auth.user.id, c.req.param('workoutId'))
    .all();
  return c.json({ reports: rows.results });
});

async function loadSafetyRules(env: Env): Promise<SafetyRule[]> {
  const rows = await env.DB.prepare(
    `SELECT id, rule_code, severity, condition, guidance_key, block_ai, requires_follow_up
     FROM safety_rules WHERE status = 'active'`,
  ).all<{
    id: string;
    rule_code: string;
    severity: 'advisory' | 'block' | 'urgent';
    condition: string;
    guidance_key: string;
    block_ai: number;
    requires_follow_up: number;
  }>();
  return rows.results.map((r) => {
    const condition = JSON.parse(r.condition) as Record<string, unknown>;
    let parsed: SafetyRule['condition'];
    if ('keywords' in condition) {
      parsed = { kind: 'urgent_keywords', keywords: condition.keywords as string[] };
    } else if ('severity_in' in condition) {
      parsed = { kind: 'severity_in', severities: condition.severity_in as string[] };
    } else {
      parsed = {
        kind: 'recurrence',
        reportsSameAreaInDays: Number(condition.reports_same_area_in_days ?? 14),
        minimumReports: Number(condition.minimum_reports ?? 2),
      };
    }
    return {
      id: r.id,
      ruleCode: r.rule_code,
      severity: r.severity,
      guidanceKey: r.guidance_key,
      blockAi: !!r.block_ai,
      requiresFollowUp: !!r.requires_follow_up,
      condition: parsed,
    };
  });
}
