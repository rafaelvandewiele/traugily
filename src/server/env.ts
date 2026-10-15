/** Cloudflare Worker runtime bindings + environment variables for Traugily. */

export type Env = {
  // Bindings
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;

  // Environment
  ENVIRONMENT: 'local' | 'preview' | 'production' | string;
  APP_URL: string;
  SUPPORT_EMAIL: string;
  LOG_LEVEL: string;

  // Email (Resend-compatible; provider chosen via env, never hard-coded)
  EMAIL_PROVIDER: 'resend' | 'outbox' | string;
  RESEND_API_KEY?: string;
  RESEND_FROM: string;

  // AI (server-side only; never exposed to the browser bundle)
  AI_PROVIDER: 'template' | 'openai' | string;
  AI_API_KEY?: string;
  AI_API_BASE_URL?: string;

  // Stripe
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID: string;
  STRIPE_CURRENCY: string;
  STRIPE_TRIAL_DAYS: string;

  // OAuth
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;

  // Signed private asset access
  ASSET_SIGNING_SECRET?: string;
};

export type AppVariables = {
  requestId: string;
  sessionToken?: string;
  userId?: string;
  userRole?: 'member' | 'admin' | 'support';
  csrfToken?: string;
};
