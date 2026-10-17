import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Test-only secret so the Stripe webhook route can verify signatures
            // in integration tests. Never set this in any real environment.
            STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
          },
        },
      }),
    ],
    test: {
      include: ['tests/workers/**/*.test.ts'],
      setupFiles: ['./tests/workers/setup.ts'],
    },
  };
});
