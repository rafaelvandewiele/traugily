/** Structured, privacy-conscious audit logging. Never store sensitive free text. */

import { newId, nowIso } from './ids';

export type AuditActor = {
  userId: string | null;
  role: 'member' | 'admin' | 'support' | 'system';
};

export async function writeAudit(
  db: D1Database,
  input: {
    actor: AuditActor;
    action: string;
    targetType: string;
    targetId?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    requestId?: string | null;
  },
): Promise<void> {
  // Summary fields are structured only; callers must not pass member free text
  // (pain notes, private messages) into before/after state.
  await db
    .prepare(
      `INSERT INTO audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, before_state, after_state, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('aud'),
      input.actor.userId,
      input.actor.role,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.beforeState ? JSON.stringify(input.beforeState) : null,
      input.afterState ? JSON.stringify(input.afterState) : null,
      input.requestId ?? null,
      nowIso(),
    )
    .run();
}

export async function recordOperationalEvent(
  db: D1Database,
  input: {
    kind: string;
    severity?: 'info' | 'warning' | 'error';
    subject: string;
    detail?: Record<string, unknown>;
    requestId?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO operational_events (id, kind, severity, subject, detail, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('ope'),
      input.kind,
      input.severity ?? 'warning',
      input.subject,
      JSON.stringify(input.detail ?? {}),
      input.requestId ?? null,
      nowIso(),
    )
    .run();
}
