/** Session auth middleware: loads the session cookie into context vars. */

import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables } from '../env';
import { parseCookies, SESSION_COOKIE } from '../lib/cookies';
import { sha256Hex } from '../lib/crypto';
import { unauthorized } from '../lib/errors';
import { nowIso } from '../lib/ids';

export type SessionRow = {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
};

export type UserRow = {
  id: string;
  email: string;
  email_verified_at: string | null;
  locale: string;
  unit_system: string;
  timezone: string;
  is_admin: number;
  is_support: number;
  status: string;
  password_hash: string | null;
};

export type AuthContext = {
  session: SessionRow;
  user: UserRow;
};

const authStore = new WeakMap<object, AuthContext>();

export function getAuth(_env: Env, ctx: object): AuthContext | undefined {
  return authStore.get(ctx);
}

export function setAuth(_env: Env, ctx: object, value: AuthContext | undefined): void {
  if (value) authStore.set(ctx, value);
  else authStore.delete(ctx);
}

/** Attach session info when present; never throws. */
export const optionalAuth = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const cookies = parseCookies(c.req.header('cookie'));
    const token = cookies[SESSION_COOKIE];
    if (token) {
      const tokenHash = await sha256Hex(token);
      const row = await c.env.DB.prepare(
        `SELECT s.id AS session_id, s.user_id AS owner_id, s.csrf_token, s.expires_at, s.revoked_at,
                u.email, u.email_verified_at, u.locale, u.unit_system, u.timezone, u.password_hash,
                u.is_admin, u.is_support, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
        .bind(tokenHash)
        .first<{
          session_id: string;
          owner_id: string;
          csrf_token: string;
          expires_at: string;
          revoked_at: string | null;
          email: string;
          email_verified_at: string | null;
          locale: string;
          unit_system: string;
          timezone: string;
          is_admin: number;
          is_support: number;
          status: string;
          password_hash: string | null;
        }>();
      if (row && !row.revoked_at && row.expires_at > nowIso() && row.status === 'active') {
        const session: SessionRow = {
          id: row.session_id,
          user_id: row.owner_id,
          csrf_token: row.csrf_token,
          expires_at: row.expires_at,
          revoked_at: row.revoked_at,
        };
        const user: UserRow = {
          id: row.owner_id,
          email: row.email,
          email_verified_at: row.email_verified_at,
          locale: row.locale,
          unit_system: row.unit_system,
          timezone: row.timezone,
          is_admin: row.is_admin,
          is_support: row.is_support,
          status: row.status,
          password_hash: row.password_hash,
        };
        setAuth(c.env, c, { session, user });
        c.set('userId', row.owner_id);
        c.set('userRole', row.is_admin ? 'admin' : row.is_support ? 'support' : 'member');
        c.set('csrfToken', row.csrf_token);
        // Sliding last-seen update (best effort)
        c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`)
          .bind(nowIso(), row.session_id)
          .run()
          .catch(() => undefined);
      }
    }
    await next();
  },
);

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const auth = getAuth(c.env, c);
    if (!auth) throw unauthorized();
    await next();
  },
);

export const requireVerifiedEmail = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const auth = getAuth(c.env, c);
    if (!auth) throw unauthorized();
    if (!auth.user.email_verified_at) {
      return c.json(
        {
          error: {
            code: 'email_not_verified',
            message: 'Please verify your email address to continue.',
          },
        },
        403,
      );
    }
    await next();
  },
);
