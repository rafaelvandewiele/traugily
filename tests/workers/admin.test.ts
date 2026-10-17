/** Integration tests: server-side RBAC + audited admin actions (scenario #9). */

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { json, post, signupAndCookies } from './helpers';

describe('admin RBAC', () => {
  it('denies normal members every admin route', async () => {
    const { cookies, csrf } = await signupAndCookies('member-rbac@workers.test');
    for (const path of ['/admin/health', '/admin/members', '/admin/flags', '/admin/audit-logs']) {
      const res = await json<{ error: { code: string } }>(path, { headers: { cookie: cookies } });
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
    const mutate = await json('/admin/flags/pdf_reports', {
      ...post('/admin/flags/pdf_reports', { enabled: false }, csrf, cookies),
      method: 'PUT',
    });
    expect(mutate.status).toBe(403);
    // Flag unchanged.
    const flag = await env.DB.prepare(
      `SELECT enabled FROM feature_flags WHERE key = 'pdf_reports'`,
    ).first<{
      enabled: number;
    }>();
    expect(flag?.enabled).toBe(1);
  });

  it('allows promoted admins and records an audit trail for flag changes', async () => {
    const { cookies, csrf } = await signupAndCookies('admin-rbac@workers.test');
    await env.DB.prepare(
      `UPDATE users SET is_admin = 1 WHERE email = 'admin-rbac@workers.test'`,
    ).run();

    const health = await json<{ ok: boolean }>('/admin/health', { headers: { cookie: cookies } });
    expect(health.status).toBe(200);

    const toggle = await json<{ ok: boolean }>('/admin/flags/adaptation_proposals', {
      ...post('/admin/flags/adaptation_proposals', { enabled: false }, csrf, cookies),
      method: 'PUT',
    });
    expect(toggle.status).toBe(200);

    const audit = await env.DB.prepare(
      `SELECT actor_user_id, actor_role, action, target_id
       FROM audit_logs WHERE action = 'feature_flag_updated' AND target_id = 'adaptation_proposals'
       ORDER BY created_at DESC LIMIT 1`,
    ).first<{
      actor_user_id: string;
      actor_role: string;
      action: string;
      target_id: string;
    }>();
    expect(audit).toBeTruthy();
    expect(audit?.actor_role).toBe('admin');
    expect(audit?.actor_user_id).toContain('usr_');

    // Restore the flag so other tests in this file see the default state.
    await env.DB.prepare(
      `UPDATE feature_flags SET enabled = 1 WHERE key = 'adaptation_proposals'`,
    ).run();
  });
});
