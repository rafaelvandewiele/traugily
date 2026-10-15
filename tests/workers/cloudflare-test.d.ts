/* eslint-disable @typescript-eslint/no-empty-object-type */
/**
 * `cloudflare:test` types `env` as `Cloudflare.Env`. Extend that ambient
 * interface with our worker's bindings so `env.DB`, `env.CACHE`, etc. are
 * typed in workers integration tests.
 */

import type { Env as TraugilyEnv } from '../../src/server/env';

declare global {
  namespace Cloudflare {
    interface Env extends TraugilyEnv {}
  }
}

export {};
