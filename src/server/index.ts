/** Worker entry: fetch handler + cron-scheduled idempotent jobs. */

import { buildApp } from './app';
import type { Env } from './env';
import { runScheduledJobs } from './cron';

const app = buildApp;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app(env).fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await runScheduledJobs(env, ctx);
  },
};
