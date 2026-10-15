/** Stripe REST client factory + entitlement mapping. */

import { verifyStripeSignature } from '../lib/crypto';
import {
  mapSubscription,
  type StripeCheckoutSession,
  type StripeClient,
  type StripeCustomer,
  type StripePortalSession,
} from './stripe-types';

export * from './stripe-types';

type StripeEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
};

const API_BASE = 'https://api.stripe.com/v1';

export function createStripeClient(env: StripeEnv, fetchImpl: typeof fetch = fetch): StripeClient {
  async function request<T>(path: string, form: Record<string, string>): Promise<T> {
    const key = env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    const body = new URLSearchParams(form).toString();
    const res = await fetchImpl(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `Stripe error ${res.status}`);
    return json;
  }

  return {
    async createCustomer(email, userId): Promise<StripeCustomer> {
      const customer = await request<Record<string, unknown>>('/customers', {
        email,
        'metadata[userId]': userId,
      });
      return { id: String(customer.id), email };
    },

    async createCheckoutSession(input): Promise<StripeCheckoutSession> {
      const form: Record<string, string> = {
        mode: 'subscription',
        customer: input.customerId,
        'line_items[0][price]': input.priceId,
        'line_items[0][quantity]': '1',
        currency: input.currency,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: 'true',
      };
      if (input.trialDays > 0) {
        form['subscription_data[trial_period_days]'] = String(input.trialDays);
      }
      const session = await request<Record<string, unknown>>('/checkout/sessions', form);
      return { id: String(session.id), url: String(session.url ?? '') };
    },

    async createPortalSession(customerId, returnUrl): Promise<StripePortalSession> {
      const session = await request<Record<string, unknown>>('/billing_portal/sessions', {
        customer: customerId,
        return_url: returnUrl,
      });
      return { id: String(session.id), url: String(session.url ?? '') };
    },

    async cancelSubscription(subscriptionId) {
      const raw = await request<Record<string, unknown>>(`/subscriptions/${subscriptionId}`, {
        cancel_at_period_end: 'true',
      });
      return mapSubscription(raw);
    },

    async getSubscription(subscriptionId) {
      const raw = await request<Record<string, unknown>>(`/subscriptions/${subscriptionId}`, {});
      return mapSubscription(raw);
    },

    async verifyWebhook(payload, signatureHeader) {
      if (!env.STRIPE_WEBHOOK_SECRET) return { ok: false, reason: 'webhook_secret_missing' };
      if (!signatureHeader) return { ok: false, reason: 'signature_header_missing' };
      return verifyStripeSignature(payload, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
    },
  };
}

/** Map Stripe subscription status → our entitlement snapshot (server-side truth from verified events). */
export function entitlementFromStripe(
  status: string,
  trialEndIso: string | null,
): {
  plan: 'free' | 'premium';
  status: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  validUntil: string | null;
} {
  if (status === 'trialing')
    return { plan: 'premium', status: 'trialing', validUntil: trialEndIso };
  if (status === 'active') return { plan: 'premium', status: 'active', validUntil: null };
  if (status === 'past_due' || status === 'unpaid') {
    return { plan: 'premium', status: 'past_due', validUntil: null };
  }
  return { plan: 'free', status: 'canceled', validUntil: null };
}
