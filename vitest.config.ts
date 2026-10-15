import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit + component tests (node/jsdom). Worker-integrated tests live in
// vitest.workers.config.ts (miniflare / workerd with real D1 bindings).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    reporters: process.env.CI ? ['default'] : ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/shared/**'],
      reporter: ['text-summary'],
    },
  },
});
