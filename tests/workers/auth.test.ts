/** Integration tests: auth, RBAC enforcement. */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { json, post, signupAndCookies } from './helpers';

describe('auth flow', () => {
  it('signs up and returns session user with correct user id', async () => {
    const { cookies } = await signupAndCookies('member@workers.test');
    const me = await json<{ user: { id: string; email: string } }>('/auth/me', {
      headers: { cookie: cookies },
    });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('member@workers.test');
    expect(me.body.user.id.startsWith('usr_')).toBe(true);
  });

  it('rejects bad login with friendly envelope', async () => {
    await signupAndCookies('login@workers.test');
    const bad = await json<{ error: { code: string; message: string } }>(
      '/auth/login',
      post('/auth/login', {
        email: 'login@workers.test',
        password: 'Wrong12345',
      }),
    );
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('unauthorized');
    expect(bad.body.error.message.length).toBeGreaterThan(10);
  });

  it('rejects admin routes for normal members (RBAC enforced server-side)', async () => {
    const { cookies } = await signupAndCookies('nonadmin@workers.test');
    const res = await json<{ error: { code: string } }>('/admin/health', {
      headers: { cookie: cookies },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('rejects requests without a valid CSRF token', async () => {
    const { cookies } = await signupAndCookies('csrf@workers.test');
    const res = await SELF.fetch('http://localhost/api/v1/account/consents', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: cookies,
        'x-csrf-token': 'wrong-token',
      },
      body: JSON.stringify({ consentKey: 'marketing_email', granted: true, version: '2026-01' }),
    });
    expect(res.status).toBe(403);
  });
});
