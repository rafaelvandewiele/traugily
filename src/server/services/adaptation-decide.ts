/** Proposal decisions (accept/edit/reject) applied only to FUTURE planned sessions. */

import type { Env } from '../env';
import { newId, nowIso, todayIso } from '../lib/ids';
import { writeAudit } from '../lib/audit';
import { conflict } from '../lib/errors';

export async function decideProposal(
  env: Env,
  userId: string,
  proposalId: string,
  decision: 'accepted' | 'edited' | 'rejected',
  note?: string,
): Promise<{ ok: boolean; status: string }> {
  const db = env.DB;
  const proposal = await db
    .prepare(
      `SELECT id, changed_fields, status FROM adaptation_proposals WHERE id = ? AND user_id = ?`,
    )
    .bind(proposalId, userId)
    .first<{ id: string; changed_fields: string; status: string }>();
  if (!proposal) return { ok: false, status: 'not_found' };
  if (proposal.status !== 'pending') {
    throw conflict('This proposal was already decided.', 'proposal_decided');
  }
  const now = nowIso();
  await db
    .prepare(
      `UPDATE adaptation_proposals SET status = ?, decision_note = ?, decided_at = ? WHERE id = ?`,
    )
    .bind(decision, note ?? null, now, proposalId)
    .run();

  if (decision === 'accepted' || decision === 'edited') {
    await applyProposalToFutureSessions(db, userId, JSON.parse(proposal.changed_fields));
  }

  await writeAudit(db, {
    actor: { userId, role: 'member' },
    action: `adaptation_${decision}`,
    targetType: 'adaptation_proposal',
    targetId: proposalId,
    afterState: { status: decision },
  });

  return { ok: true, status: decision };
}

async function applyProposalToFutureSessions(
  db: D1Database,
  userId: string,
  changedFields: Array<{
    exerciseId?: string;
    field: string;
    before: number | string | null;
    after: number | string | null;
    scope: string;
  }>,
): Promise<void> {
  for (const change of changedFields) {
    if (!change.exerciseId || change.after == null) continue;
    if (change.field !== 'plannedWeightKg' && change.field !== 'plannedReps') continue;
    const col = change.field === 'plannedWeightKg' ? 'planned_weight_kg' : 'planned_reps';
    // Only FUTURE planned sets in the active plan version — closed workouts untouched.
    await db
      .prepare(
        `UPDATE planned_sets SET ${col} = ?
         WHERE session_exercise_id IN (
           SELECT se.id FROM session_exercises se
           JOIN scheduled_sessions ss ON ss.id = se.session_id
           JOIN plans p ON p.current_version_id = ss.version_id
           WHERE p.user_id = ? AND se.exercise_id = ? AND ss.scheduled_date >= ?
             AND ss.status = 'planned'
         )`,
      )
      .bind(Number(change.after), userId, change.exerciseId, todayIso())
      .run();
  }
}

void newId;
