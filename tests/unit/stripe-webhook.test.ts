/** Unit tests: Stripe webhook signature verification + entitlement mapping. */

import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, verifyStripeSignature, timingSafeEqual } from '../../src/server/lib/crypto';
import { entitlementFromStripe, epochToIso } from '../../src/server/services/stripe';
import { isoToEpoch } from '../../src/server/services/stripe';

describe('verifyStripeSignature', () => {
  it('accepts a valid signature', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const secret = 'whsec_test_secret';
    const ts = Math.floor(Date.now() / 1000);
    const sig = await hmacSha256Hex(secret, `${ts}.${payload}`);
    const header = `t=${ts},v1=${sig}`;
    const result = await verifyStripeSignature(payload, header, secret);
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    const secret = 'whsec_test_secret';
    const ts = Math.floor(Date.now() / 1000);
    const sig = await hmacSha256Hex(secret, `${ts}.${payload}`);
    const header = `t=${ts},v1=${sig}`;
    const tampered = JSON.stringify({ id: 'evt_1', amount: 999 });
    const result = await verifyStripeSignature(tampered, header, secret);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('signature_mismatch');
  });

  it('rejects timestamps outside tolerance', async () => {
    const payload = '{}';
    const secret = 'whsec_test_secret';
    const ts = Math.floor(Date.now() / 1000) - 10_000;
    const sig = await hmacSha256Hex(secret, `${ts}.${payload}`);
    const result = await verifyStripeSignature(payload, `t=${ts},v1=${sig}`, secret);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('timestamp_out_of_tolerance');
  });

  it('rejects malformed headers', async () => {
    const result = await verifyStripeSignature('{}', 'garbage', 'whsec_test_secret');
    expect(result.ok).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('compares equal strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
  });
});

describe('entitlementFromStripe', () => {
  it('maps trialing/active to premium', () => {
    expect(entitlementFromStripe('trialing', '2026-02-01T00:00:00Z')).toEqual({
      plan: 'premium',
      status: 'trialing',
      validUntil: '2026-02-01T00:00:00Z',
    });
    expect(entitlementFromStripe('active', null).plan).toBe('premium');
  });

  it('maps past_due to premium/past_due (grace period)', () => {
    expect(entitlementFromStripe('past_due', null).status).toBe('past_due');
  });

  it('maps canceled to free (data preserved)', () => {
    const result = entitlementFromStripe('canceled', null);
    expect(result.plan).toBe('free');
    expect(result.status).toBe('canceled');
  });
});

describe('epoch helpers', () => {
  it('converts epochs to ISO and back', () => {
    const iso = epochToIso(1_700_000_000);
    expect(iso).toBe('2023-11-14T22:13:20.000Z');
    expect(isoToEpoch(iso)).toBe(1_700_000_000);
  });
});
