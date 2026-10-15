/** Server-enforced RBAC + CSRF protection for state-changing requests. */

import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables } from '../env';
import { getAuth } from './auth';
import { forbidden } from '../lib/errors';

export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const role = c.get('userRole');
    if (role !== 'admin') throw forbidden('Admin access required');
    await next();
  },
);

export const requireSupport = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const role = c.get('userRole');
    if (role !== 'support' && role !== 'admin') throw forbidden('Support access required');
    await next();
  },
);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF: state-changing requests must echo the readable tg_csrf cookie in the
 * X-CSRF-Token header, and the Origin header (when present) must match APP_URL.
 */
export const csrfProtection = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      await next();
      return;
    }
    const auth = getAuth(c.env, c);
    if (!auth) {
      await next(); // unauthenticated endpoints (signup/login) rely on SameSite + rate limits
      return;
    }
    const headerToken = c.req.header('x-csrf-token');
    if (!headerToken || !timingSafeEqualTokens(headerToken, auth.session.csrf_token)) {
      return c.json(
        {
          error: {
            code: 'csrf_failed',
            message: 'Your session security check failed. Please refresh the page and try again.',
          },
        },
        403,
      );
    }
    const origin = c.req.header('origin');
    if (origin && origin !== c.env.APP_URL && !isAllowedOrigin(origin, c.env.APP_URL)) {
      return c.json(
        {
          error: {
            code: 'origin_mismatch',
            message: 'Request origin not allowed.',
          },
        },
        403,
      );
    }
    await next();
  },
);

function timingSafeEqualTokens(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAllowedOrigin(origin: string, appUrl: string): boolean {
  // Workers preview URLs (*.workers.dev) share the app origin family in dev tooling.
  try {
    const o = new URL(origin);
    const a = new URL(appUrl);
    if (o.hostname === a.hostname) return true;
    // Local development: `localhost` and `127.0.0.1` address the same
    // machine, and tooling (Playwright, curl) may use either. Only when
    // APP_URL itself is a loopback host — never in production.
    if (isLoopbackHost(o.hostname) && isLoopbackHost(a.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}
