/** Centralized error handling + request-id correlation. */

import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables } from '../env';
import { ApiError } from '../lib/errors';
import { recordOperationalEvent } from '../lib/audit';

export const requestIdMiddleware = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId =
      incoming && /^[a-zA-Z0-9-]{4,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  },
);

export const errorHandler = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof ApiError) {
        return c.json(err.toBody(), err.status as 400);
      }
      const requestId = c.get('requestId') ?? 'unknown';
      // Privacy-conscious: log kind + request id only, never member free text.
      await recordOperationalEvent(c.env.DB, {
        kind: 'unhandled_error',
        severity: 'error',
        subject: c.req.path,
        detail: {
          method: c.req.method,
          message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
        requestId,
      }).catch(() => undefined);
      if (c.env.LOG_LEVEL === 'debug') {
        console.error('[error]', requestId, err);
      }
      return c.json(
        {
          error: {
            code: 'server_error',
            message:
              'Something went wrong on our side. Your data is safe — please try again in a moment.',
          },
        },
        500,
      );
    }
  },
);
