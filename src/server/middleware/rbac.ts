/** Server-enforced RBAC + CSRF protection for state-changing requests. */

import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables } from '../env';
import { getAuth } from './auth';
import { forbidden } from '../lib/errors';
import { recordOperationalEvent } from '../lib/audit';

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
 * X-CSRF-Token header, and the Origin header (when present) must match APP_URL
 * or the host actually serving this request (first-party: custom domains,
 * preview URLs, local dev). Cross-site callers can never match either.
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
    if (origin && !isAllowedOrigin(origin, c.env.APP_URL, c.req.header('host'))) {
      // Record why we rejected (origin + hostnames only) so mismatched
      // deployments are diagnosable from the ops console.
      await recordOperationalEvent(c.env.DB, {
        kind: 'origin_mismatch',
        severity: 'warning',
        subject: c.req.path,
        detail: {
          origin: origin.slice(0, 120),
          requestHost: c.req.header('host') ?? null,
          appUrl: c.env.APP_URL,
        },
        requestId: c.get('requestId') ?? null,
      }).catch(() => undefined);
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

function isAllowedOrigin(origin: string, appUrl: string, requestHost?: string): boolean {
  try {
    const o = new URL(origin);
    const a = new URL(appUrl);
    if (o.hostname === a.hostname) return true;
    // First-party: the app is being served from this very host (custom domains
    // bound to the worker, workers.dev previews, and local dev tooling).
    // A cross-site page (evil.example → Host: app) can never match it.
    if (requestHost && o.host.toLowerCase() === requestHost.toLowerCase()) return true;
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
