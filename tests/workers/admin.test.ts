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

describe('admin subscription management', () => {
  it('denies members the ability to change any subscription, including their own', async () => {
    const { cookies, csrf } = await signupAndCookies('sub-member@workers.test');
    const me = await json<{ user: { id: string } }>('/auth/me', {
      headers: { cookie: cookies },
    });
    const userId = me.body.user.id;

    const res = await json<{ error: { code: string } }>(
      `/admin/members/${userId}/entitlement`,
      post(
        `/admin/members/${userId}/entitlement`,
        { targetUserId: userId, plan: 'premium', reason: 'member tried to self-upgrade' },
        csrf,
        cookies,
      ),
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');

    // Entitlement untouched.
    const ent = await env.DB.prepare(`SELECT plan FROM entitlements WHERE user_id = ?`)
      .bind(userId)
      .first<{ plan: string }>();
    expect(ent?.plan).toBe('free');
  });

  it('lets admins grant and revoke premium with an audit trail the member then sees', async () => {
    const member = await signupAndCookies('sub-target@workers.test');
    const admin = await signupAndCookies('sub-granter@workers.test');
    await env.DB.prepare(
      `UPDATE users SET is_admin = 1 WHERE email = 'sub-granter@workers.test'`,
    ).run();
    const me = await json<{ user: { id: string } }>('/auth/me', {
      headers: { cookie: member.cookies },
    });
    const targetId = me.body.user.id;

    const grant = await json<{ ok: boolean; plan: string; status: string }>(
      `/admin/members/${targetId}/entitlement`,
      post(
        `/admin/members/${targetId}/entitlement`,
        {
          targetUserId: targetId,
          plan: 'premium',
          reason: 'comp granted via support ticket 1',
        },
        admin.csrf,
        admin.cookies,
      ),
    );
    expect(grant.status).toBe(200);
    expect(grant.body.plan).toBe('premium');

    const ent = await env.DB.prepare(
      `SELECT plan, status, source FROM entitlements WHERE user_id = ?`,
    )
      .bind(targetId)
      .first<{ plan: string; status: string; source: string }>();
    expect(ent?.plan).toBe('premium');
    expect(ent?.status).toBe('active');
    expect(ent?.source).toBe('admin_grant');

    const audit = await env.DB.prepare(
      `SELECT actor_role FROM audit_logs
       WHERE action = 'admin_subscription_granted' AND target_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(targetId)
      .first<{ actor_role: string }>();
    expect(audit).toBeTruthy();
    expect(audit?.actor_role).toBe('admin');

    // The member's session now reports premium (no re-login required).
    const after = await json<{ user: { entitlement: { plan: string } } }>('/auth/me', {
      headers: { cookie: member.cookies },
    });
    expect(after.body.user.entitlement.plan).toBe('premium');

    // Revoke back to free.
    const revoke = await json<{ ok: boolean }>(
      `/admin/members/${targetId}/entitlement`,
      post(
        `/admin/members/${targetId}/entitlement`,
        {
          targetUserId: targetId,
          plan: 'free',
          reason: 'end of goodwill subscription period',
        },
        admin.csrf,
        admin.cookies,
      ),
    );
    expect(revoke.status).toBe(200);
    const ent2 = await env.DB.prepare(`SELECT plan FROM entitlements WHERE user_id = ?`)
      .bind(targetId)
      .first<{ plan: string }>();
    expect(ent2?.plan).toBe('free');
    const session = await json<{ user: { entitlement: { plan: string } } }>('/auth/me', {
      headers: { cookie: member.cookies },
    });
    expect(session.body.user.entitlement.plan).toBe('free');
  });

  it('always reports premium for admins, whatever the entitlements row says', async () => {
    const admin = await signupAndCookies('sub-admin@workers.test');
    const me = await json<{ user: { id: string } }>('/auth/me', {
      headers: { cookie: admin.cookies },
    });
    const adminId = me.body.user.id;
    await env.DB.prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).bind(adminId).run();
    // Simulate a downgrade (delinquency cancel) that must not stick for admins.
    await env.DB.prepare(
      `UPDATE entitlements SET plan = 'free', status = 'canceled', source = 'delinquency_cancel'
       WHERE user_id = ?`,
    )
      .bind(adminId)
      .run();

    const session = await json<{
      user: { entitlement: { plan: string; status: string } };
    }>('/auth/me', { headers: { cookie: admin.cookies } });
    expect(session.body.user.entitlement.plan).toBe('premium');
    expect(session.body.user.entitlement.status).toBe('active');

    const billing = await json<{ entitlement: { plan: string; status: string } }>(
      '/billing/status',
      { headers: { cookie: admin.cookies } },
    );
    expect(billing.body.entitlement.plan).toBe('premium');
    expect(billing.body.entitlement.status).toBe('active');
  });
});
