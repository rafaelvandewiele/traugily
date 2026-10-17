/** Crypto: worker-compatible PBKDF2 settings + hash/verify round-trip. */

import { describe, expect, it } from 'vitest';
import { PBKDF2_ITERATIONS, hashPassword, verifyPassword } from '../../src/server/lib/crypto';

describe('PBKDF2 iterations', () => {
  it('stays within the Cloudflare Workers Web Crypto cap (100,000)', () => {
    // Higher counts throw `Pbkdf2 failed` on the Workers runtime and take
    // down every signup/login with a 500 (seen in production 2026-10-17).
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100000);
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(50000);
  });
});

describe('hashPassword/verifyPassword', () => {
  it('round-trips and rejects wrong passwords', async () => {
    const hash = await hashPassword('Correct-Horse-99');
    expect(await verifyPassword('Correct-Horse-99', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
    expect(await verifyPassword('Correct-Horse-99', 'not-a-hash')).toBe(false);
  });
});
