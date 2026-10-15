/** Adaptation proposals: list pending, decide (accept/edit/reject). */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { z } from 'zod';
import { badRequest, unauthorized } from '../lib/errors';
import { getAuth } from '../middleware/auth';
import { runAdaptationEvaluation } from '../services/adaptation-service';
import { decideProposal } from '../services/adaptation-decide';

export const adaptationRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

adaptationRoutes.get('/proposals', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const status = c.req.query('status') ?? 'pending';
  const rows = await c.env.DB.prepare(
    `SELECT id, trigger_code, reason_key, changed_fields, effective_date, explanation_key,
            explanation_params, status, decision_note, decided_at, created_at
     FROM adaptation_proposals WHERE user_id = ? AND status = ?
     ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(auth.user.id, status)
    .all<{
      id: string;
      trigger_code: string;
      reason_key: string;
      changed_fields: string;
      effective_date: string;
      explanation_key: string;
      explanation_params: string;
      status: string;
      decision_note: string | null;
      decided_at: string | null;
      created_at: string;
    }>();

  const proposals = await Promise.all(
    rows.results.map(async (p) => {
      const signals = await c.env.DB.prepare(
        `SELECT signal_code, signal_data, observed_at FROM adaptation_source_signals
         WHERE proposal_id = ?`,
      )
        .bind(p.id)
        .all();
      return {
        id: p.id,
        triggerCode: p.trigger_code,
        reasonKey: p.reason_key,
        changedFields: JSON.parse(p.changed_fields),
        effectiveDate: p.effective_date,
        explanationKey: p.explanation_key,
        explanationParams: JSON.parse(p.explanation_params),
        status: p.status,
        decisionNote: p.decision_note,
        decidedAt: p.decided_at,
        createdAt: p.created_at,
        signals: signals.results,
      };
    }),
  );
  return c.json({ proposals });
});

const decideSchema = z.object({
  decision: z.enum(['accepted', 'edited', 'rejected']),
  note: z.string().max(500).optional(),
  edits: z
    .array(
      z.object({
        exerciseId: z.string(),
        field: z.enum(['plannedWeightKg', 'plannedReps']),
        after: z.number().min(0).max(500),
      }),
    )
    .optional(),
});

adaptationRoutes.post('/proposals/:id/decide', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Choose to accept, edit, or skip this proposal.');

  const result = await decideProposal(
    c.env,
    auth.user.id,
    c.req.param('id'),
    parsed.data.decision,
    parsed.data.note,
  );
  if (!result.ok) throw badRequest('This proposal no longer exists.');
  return c.json({ ok: true, status: result.status });
});

adaptationRoutes.post('/evaluate', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const proposals = await runAdaptationEvaluation(c.env, auth.user.id);
  return c.json({ evaluated: true, proposals: proposals.length });
});
