/** Integration tests: plan length diff (scenario #5) + recovery-safe moves (scenario #4). */

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { json, post, seedCatalogue, setupPlan } from './helpers';

beforeAll(async () => {
  await seedCatalogue(env.DB);
});

describe('plan length change', () => {
  it('shows a before/after diff and requires explicit confirmation', async () => {
    const { cookies, csrf, planId } = await setupPlan('length@workers.test');

    const preview = await json<{
      diff: {
        before: { weeks: number; phases: Array<{ key: string; weeks: number }> };
        after: { weeks: number; phases: Array<{ key: string; weeks: number }> };
        changed: Array<{ field: string }>;
      };
      requiresConfirmation: boolean;
    }>(
      `/plans/${planId}/preview-length`,
      post(`/plans/${planId}/preview-length`, { targetWeeks: 24 }, csrf, cookies),
    );
    expect(preview.status).toBe(200);
    expect(preview.body.requiresConfirmation).toBe(true);
    expect(preview.body.diff.before.weeks).toBe(12);
    expect(preview.body.diff.after.weeks).toBe(24);
    expect(preview.body.diff.changed.length).toBeGreaterThan(0);
    expect(preview.body.diff.after.phases.length).toBeGreaterThan(1);

    // Applying without confirmation is refused.
    const unconfirmed = await json<{ error: { field: string } }>(
      `/plans/${planId}/apply-length`,
      post(`/plans/${planId}/apply-length`, { targetWeeks: 24 }, csrf, cookies),
    );
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.error.field).toBe('confirmed');

    // Confirmed apply versions the plan and audits the change.
    const applied = await json<{ ok: boolean; version: number }>(
      `/plans/${planId}/apply-length`,
      post(`/plans/${planId}/apply-length`, { targetWeeks: 24, confirmed: true }, csrf, cookies),
    );
    expect(applied.status).toBe(200);
    expect(applied.body.version).toBe(2);

    const plan = await env.DB.prepare(
      `SELECT goal_duration_weeks, current_version_id FROM plans WHERE id = ?`,
    )
      .bind(planId)
      .first<{ goal_duration_weeks: number; current_version_id: string }>();
    expect(plan?.goal_duration_weeks).toBe(24);

    const audit = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'plan_length_changed' AND target_id = ?`,
    )
      .bind(planId)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });
});

describe('planner move with recovery conflicts', () => {
  it('warns with safer alternatives before moving into a training streak', async () => {
    const { cookies, csrf } = await setupPlan('planner@workers.test');

    // Three planned workout sessions from the generated weekly schedule.
    const sessions = await env.DB.prepare(
      `SELECT ss.id, ss.scheduled_date FROM scheduled_sessions ss
       JOIN plans p ON p.current_version_id = ss.version_id
       WHERE p.user_id = (SELECT u.id FROM users u WHERE u.email = 'planner@workers.test')
         AND ss.kind = 'workout' AND ss.status = 'planned'
       ORDER BY ss.scheduled_date LIMIT 3`,
    ).all<{ id: string; scheduled_date: string }>();
    expect(sessions.results.length).toBe(3);
    const [s1, s2] = s1AndS2(sessions.results);

    // Move the Monday session into the Wed<->Fri gap (Thursday). Neighbouring
    // days (Wed, Fri) are both other workout days, so this triggers the
    // no_rest_between + training_streak recovery rules and must be gated.
    const targetThursday = addDay(s2.scheduled_date);
    const review = await json<{
      requiresConfirmation: boolean;
      conflicts: Array<{ code: string }>;
      saferAlternatives: string[];
    }>(
      `/planner/sessions/${s1.id}/move`,
      post(`/planner/sessions/${s1.id}/move`, { targetDate: targetThursday }, csrf, cookies),
    );
    expect(review.status).toBe(200);
    expect(review.body.requiresConfirmation).toBe(true);
    expect(review.body.conflicts.length).toBeGreaterThan(0);
    expect(review.body.saferAlternatives.length).toBeGreaterThanOrEqual(1);
    // Nothing changed yet.
    const unchanged = await env.DB.prepare(
      `SELECT scheduled_date FROM scheduled_sessions WHERE id = ?`,
    )
      .bind(s1.id)
      .first<{ scheduled_date: string }>();
    expect(unchanged?.scheduled_date).toBe(s1.scheduled_date);

    // Confirmed move is applied and audited with the applied conflicts.
    const confirmed = await json<{ ok: boolean; appliedConflicts: Array<{ code: string }> }>(
      `/planner/sessions/${s1.id}/move`,
      post(
        `/planner/sessions/${s1.id}/move`,
        { targetDate: targetThursday, confirmed: true },
        csrf,
        cookies,
      ),
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.ok).toBe(true);
    expect(confirmed.body.appliedConflicts.length).toBeGreaterThan(0);

    const audit = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'session_moved_with_conflict' AND target_id = ?`,
    )
      .bind(s1.id)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });
});

function s1AndS2(rows: Array<{ id: string; scheduled_date: string }>) {
  return [rows[0], rows[1]] as const;
}

function addDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
