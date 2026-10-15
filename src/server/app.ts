/** Hono application factory: wires middleware + all route modules. */

import { Hono } from 'hono';
import type { Env, AppVariables } from './env';
import { optionalAuth } from './middleware/auth';
import { csrfProtection } from './middleware/rbac';
import { requestIdMiddleware } from './middleware/errors';
import { ApiError } from './lib/errors';
import { recordOperationalEvent } from './lib/audit';
import { authRoutes } from './routes/auth';
import { onboardingRoutes } from './routes/onboarding';
import { accountRoutes } from './routes/account';
import { planRoutes } from './routes/plans';
import { planChangeRoutes } from './routes/plans-change';
import { workoutRoutes } from './routes/workouts';
import { workoutSyncRoutes } from './routes/workouts-sync';
import { workoutActionRoutes } from './routes/workouts-actions';
import { workoutFinishRoutes } from './routes/workouts-finish';
import { safetyRoutes } from './routes/safety';
import { adaptationRoutes } from './routes/adaptation';
import { nutritionRoutes } from './routes/nutrition';
import { nutritionExtraRoutes } from './routes/nutrition-extras';
import { progressRoutes } from './routes/progress';
import { progressSummaryRoutes } from './routes/progress-summary';
import { plannerRoutes } from './routes/planner';
import { plannerExtraRoutes } from './routes/planner-extras';
import { reportRoutes } from './routes/reports';
import { billingRoutes } from './routes/billing';
import { billingWebhookRoutes } from './routes/billing-webhook';
import { adminRoutes } from './routes/admin';
import { adminOpsRoutes } from './routes/admin-ops';
import { adminContentRoutes } from './routes/admin-content';
import { adminContentMutationRoutes } from './routes/admin-content-mutations';
import { catalogRoutes } from './routes/catalog';
import { fileRoutes } from './routes/files';
import { notificationRoutes } from './routes/notifications';
import { workoutReadRoutes } from './routes/workouts-read';
import { meRoutes } from './routes/me';

export function buildApp(env: Env): Hono<{ Bindings: Env; Variables: AppVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

  app.use('*', requestIdMiddleware);
  app.use('*', optionalAuth);
  app.use('/api/v1/*', csrfProtection);

  // Hono routes handler-thrown errors to onError (middleware try/catch does not see them).
  app.onError(async (err, c) => {
    if (err instanceof ApiError) {
      return c.json(err.toBody(), err.status as 400);
    }
    const requestId = c.get('requestId') ?? 'unknown';
    // Privacy-conscious: record kind + request id only, never member free text.
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
  });

  app.get('/api/v1/health', (c) =>
    c.json({
      ok: true,
      service: 'traugily',
      environment: env.ENVIRONMENT,
      time: new Date().toISOString(),
    }),
  );

  const v1 = new Hono<{ Bindings: Env; Variables: AppVariables }>();

  v1.route('/auth', authRoutes);
  v1.route('/onboarding', onboardingRoutes);
  v1.route('/account', accountRoutes);
  v1.route('/me', meRoutes);
  v1.route('/plans', planRoutes);
  v1.route('/plans', planChangeRoutes);
  v1.route('/workouts', workoutRoutes);
  v1.route('/workouts', workoutReadRoutes);
  v1.route('/workouts', workoutSyncRoutes);
  v1.route('/workouts', workoutActionRoutes);
  v1.route('/workouts', workoutFinishRoutes);
  v1.route('/safety', safetyRoutes);
  v1.route('/adaptations', adaptationRoutes);
  v1.route('/nutrition', nutritionRoutes);
  v1.route('/nutrition', nutritionExtraRoutes);
  v1.route('/progress', progressRoutes);
  v1.route('/progress', progressSummaryRoutes);
  v1.route('/planner', plannerRoutes);
  v1.route('/planner', plannerExtraRoutes);
  v1.route('/reports', reportRoutes);
  v1.route('/billing', billingRoutes);
  v1.route('/billing', billingWebhookRoutes);
  v1.route('/admin', adminRoutes);
  v1.route('/admin', adminOpsRoutes);
  v1.route('/admin', adminContentRoutes);
  v1.route('/admin', adminContentMutationRoutes);
  v1.route('/catalog', catalogRoutes);
  v1.route('/files', fileRoutes);
  v1.route('/notifications', notificationRoutes);

  app.route('/api/v1', v1);

  app.notFound(async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json(
        { error: { code: 'not_found', message: 'This endpoint does not exist.' } },
        404,
      );
    }
    // SPA fallback for client routes (assets binding handles static files first).
    return env.ASSETS.fetch(c.req.raw);
  });

  return app;
}
