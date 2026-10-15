/** Stripe REST resource shapes + mappers shared by client and webhook processing. */

export type StripeCustomer = { id: string; email: string };
export type StripeCheckoutSession = { id: string; url: string };
export type StripePortalSession = { id: string; url: string };

export type StripeSubscriptionSnapshot = {
  id: string;
  customerId: string;
  status: string;
  priceId: string;
  currency: string;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  trialStart: number | null;
  trialEnd: number | null;
};

export type StripeClient = {
  createCustomer(email: string, userId: string): Promise<StripeCustomer>;
  createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    currency: string;
    trialDays: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<StripeCheckoutSession>;
  createPortalSession(customerId: string, returnUrl: string): Promise<StripePortalSession>;
  cancelSubscription(subscriptionId: string): Promise<StripeSubscriptionSnapshot>;
  getSubscription(subscriptionId: string): Promise<StripeSubscriptionSnapshot>;
  verifyWebhook(
    payload: string,
    signatureHeader: string | undefined,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
};

export function mapSubscription(raw: Record<string, unknown>): StripeSubscriptionSnapshot {
  const items = raw.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
  return {
    id: String(raw.id),
    customerId: String(raw.customer),
    status: String(raw.status),
    priceId: String(items?.data?.[0]?.price?.id ?? ''),
    currency: String(raw.currency ?? ''),
    currentPeriodStart: numOrNull(raw.current_period_start),
    currentPeriodEnd: numOrNull(raw.current_period_end),
    cancelAtPeriodEnd: Boolean(raw.cancel_at_period_end),
    canceledAt: numOrNull(raw.canceled_at),
    trialStart: numOrNull(raw.trial_start),
    trialEnd: numOrNull(raw.trial_end),
  };
}

export function epochToIso(epoch: number | null): string | null {
  return epoch ? new Date(epoch * 1000).toISOString() : null;
}

export function isoToEpoch(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
