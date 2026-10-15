/** Auth routes: signup, verification, login/logout, password reset, Google + Apple OAuth. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from '../../shared/contracts';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../lib/crypto';
import {
  CSRF_COOKIE,
  OAUTH_STATE_COOKIE,
  buildCookie,
  clearCookie,
  parseCookies,
  setSessionCookies,
} from '../lib/cookies';
import { badRequest, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { sendMail } from '../services/mail';
import { getAuth } from '../middleware/auth';
import { googleAuthUrl, exchangeGoogleCode } from '../services/oauth-google';
import { verifyAppleIdToken } from '../lib/oidc';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, sliding

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function createSession(
  c: { env: Env; header: (k: string, v: string) => unknown },
  userId: string,
): Promise<{ setCookies: string[]; csrfToken: string }> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('ses'), userId, tokenHash, csrfToken, now, now, expires)
    .run();
  const secure = !c.env.APP_URL.startsWith('http://localhost');
  return {
    setCookies: setSessionCookies(token, csrfToken, SESSION_TTL_SECONDS, secure),
    csrfToken,
  };
}

/* ------------------------------- Signup ------------------------------- */

authRoutes.post('/signup', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid input', issue?.path.join('.'));
  }
  const { email, password, locale } = parsed.data;
  const rl = await checkRateLimit(
    c.env.CACHE,
    'auth_signup',
    normalizeEmail(email),
    RATE_LIMITS.authSignup.limit,
    RATE_LIMITS.authSignup.windowMs,
  );
  if (!rl.allowed) {
    return c.json(
      {
        error: {
          code: 'rate_limited',
          message: 'Too many sign-up attempts. Please wait a few minutes.',
        },
      },
      429,
    );
  }

  const normalized = normalizeEmail(email);
  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email_normalized = ?`)
    .bind(normalized)
    .first();
  if (existing) {
    // Account exists but may be unverified — do not leak beyond generic guidance.
    return c.json(
      {
        error: {
          code: 'email_taken',
          message:
            'An account with this email already exists. Try signing in or resetting your password.',
        },
      },
      409,
    );
  }

  const userId = newId('usr');
  const passwordHash = await hashPassword(password);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, email, email_normalized, password_hash, password_algo, status, locale, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pbkdf2-sha256', 'active', ?, ?, ?)`,
    ).bind(userId, email.trim(), normalized, passwordHash, locale ?? 'en', now, now),
    c.env.DB.prepare(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, created_at)
       VALUES (?, ?, 'email', ?, ?)`,
    ).bind(newId('ide'), userId, normalized, now),
    c.env.DB.prepare(
      `INSERT INTO profiles (user_id, unit_system, created_at, updated_at) VALUES (?, 'metric', ?, ?)`,
    ).bind(userId, now, now),
    c.env.DB.prepare(
      `INSERT INTO entitlements (user_id, plan, status, source, updated_at) VALUES (?, 'free', 'free', 'signup', ?)`,
    ).bind(userId, now),
    c.env.DB.prepare(
      `INSERT INTO consents (id, user_id, consent_key, granted, version, updated_at)
       VALUES (?, ?, 'marketing_email', 0, '2026-01', ?)`,
    ).bind(newId('con'), userId, now),
    c.env.DB.prepare(
      `INSERT INTO consent_history (id, user_id, consent_key, granted, version, changed_at)
       VALUES (?, ?, 'marketing_email', 0, '2026-01', ?)`,
    ).bind(newId('ch'), userId, now),
  ]);

  // Email verification token (hashed at rest)
  const verifyToken = randomToken(24);
  await c.env.DB.prepare(
    `INSERT INTO verification_tokens (id, user_id, purpose, token_hash, created_at, expires_at)
     VALUES (?, ?, 'verify_email', ?, ?, ?)`,
  )
    .bind(
      newId('vt'),
      userId,
      await sha256Hex(verifyToken),
      nowIso(),
      new Date(Date.now() + 86_400_000).toISOString(),
    )
    .run();

  const verifyUrl = `${c.env.APP_URL}/verify-email?token=${verifyToken}`;
  await sendMail(c.env, {
    to: email.trim(),
    template: 'verify_email',
    locale: locale ?? 'en',
    params: { link: verifyUrl },
  });
  await sendMail(c.env, {
    to: email.trim(),
    template: 'welcome',
    locale: locale ?? 'en',
    params: {},
  });

  const { setCookies } = await createSession(c, userId);
  for (const cookie of setCookies) c.header('set-cookie', cookie, { append: true });
  return c.json(
    {
      user: {
        id: userId,
        email: email.trim(),
        emailVerified: false,
        locale: locale ?? 'en',
        unitSystem: 'metric',
        timezone: 'UTC',
        isAdmin: false,
        isSupport: false,
        entitlement: { plan: 'free', status: 'free', validUntil: null },
      },
      verificationRequired: true,
    },
    201,
  );
});

/* ---------------------------- Verify email ---------------------------- */

authRoutes.post('/verify-email', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Verification link is invalid or has expired.');
  const tokenHash = await sha256Hex(parsed.data.token);
  const row = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, consumed_at FROM verification_tokens
     WHERE token_hash = ? AND purpose = 'verify_email'`,
  )
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: string; consumed_at: string | null }>();
  if (!row || row.consumed_at || row.expires_at < nowIso()) {
    throw badRequest('Verification link is invalid or has expired.');
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE verification_tokens SET consumed_at = ? WHERE id = ?`).bind(
      nowIso(),
      row.id,
    ),
    c.env.DB.prepare(`UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?`).bind(
      nowIso(),
      nowIso(),
      row.user_id,
    ),
  ]);
  return c.json({ ok: true });
});

/* ------------------------------- Login ------------------------------- */

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Enter your email and password.');
  const normalized = normalizeEmail(parsed.data.email);
  const rl = await checkRateLimit(
    c.env.CACHE,
    'auth_login',
    normalized,
    RATE_LIMITS.authLogin.limit,
    RATE_LIMITS.authLogin.windowMs,
  );
  if (!rl.allowed) {
    return c.json(
      {
        error: {
          code: 'rate_limited',
          message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
        },
      },
      429,
    );
  }

  const user = await c.env.DB.prepare(
    `SELECT id, email, email_verified_at, password_hash, locale, unit_system, timezone,
            is_admin, is_support, status
     FROM users WHERE email_normalized = ?`,
  )
    .bind(normalized)
    .first<{
      id: string;
      email: string;
      email_verified_at: string | null;
      password_hash: string | null;
      locale: string;
      unit_system: string;
      timezone: string;
      is_admin: number;
      is_support: number;
      status: string;
    }>();

  if (!user || !user.password_hash || user.status !== 'active') {
    throw unauthorized('Email or password is incorrect.');
  }
  const ok = await verifyPassword(parsed.data.password, user.password_hash);
  if (!ok) throw unauthorized('Email or password is incorrect.');

  const { setCookies } = await createSession(c, user.id);
  for (const cookie of setCookies) c.header('set-cookie', cookie, { append: true });
  const entitlement = await loadEntitlement(c.env, user.id);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      emailVerified: !!user.email_verified_at,
      locale: user.locale,
      unitSystem: user.unit_system,
      timezone: user.timezone,
      isAdmin: !!user.is_admin,
      isSupport: !!user.is_support,
      entitlement,
    },
  });
});

/* ------------------------------- Logout ------------------------------- */

authRoutes.post('/logout', async (c) => {
  const cookies = parseCookies(c.req.header('cookie'));
  const token = cookies.tg_session;
  if (token) {
    await c.env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?, revoked_reason = 'logout' WHERE token_hash = ?`,
    )
      .bind(nowIso(), await sha256Hex(token))
      .run()
      .catch(() => undefined);
  }
  const secure = !c.env.APP_URL.startsWith('http://localhost');
  c.header('set-cookie', clearCookie('tg_session', secure), { append: true });
  c.header('set-cookie', clearCookie(CSRF_COOKIE, secure), { append: true });
  return c.json({ ok: true });
});

/* --------------------------- Password reset --------------------------- */

authRoutes.post('/forgot-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Enter the email address for your account.');
  const normalized = normalizeEmail(parsed.data.email);
  const rl = await checkRateLimit(
    c.env.CACHE,
    'password_reset',
    normalized,
    RATE_LIMITS.passwordReset.limit,
    RATE_LIMITS.passwordReset.windowMs,
  );
  if (!rl.allowed) return c.json({ ok: true }); // never reveal throttling vs existence
  const user = await c.env.DB.prepare(
    `SELECT id, locale FROM users WHERE email_normalized = ? AND status = 'active'`,
  )
    .bind(normalized)
    .first<{ id: string; locale: string }>();
  if (user) {
    const token = randomToken(24);
    await c.env.DB.prepare(
      `INSERT INTO verification_tokens (id, user_id, purpose, token_hash, created_at, expires_at)
       VALUES (?, ?, 'reset_password', ?, ?, ?)`,
    )
      .bind(
        newId('vt'),
        user.id,
        await sha256Hex(token),
        nowIso(),
        new Date(Date.now() + 3_600_000).toISOString(), // 1 hour
      )
      .run();
    await sendMail(c.env, {
      to: normalized,
      template: 'reset_password',
      locale: user.locale,
      params: { link: `${c.env.APP_URL}/reset-password?token=${token}` },
    });
  }
  return c.json({ ok: true });
});

authRoutes.post('/reset-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid reset link or password.', issue?.path.join('.'));
  }
  const tokenHash = await sha256Hex(parsed.data.token);
  const row = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, consumed_at FROM verification_tokens
     WHERE token_hash = ? AND purpose = 'reset_password'`,
  )
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: string; consumed_at: string | null }>();
  if (!row || row.consumed_at || row.expires_at < nowIso()) {
    throw badRequest(
      'This password reset link is invalid or has expired. Please request a new one.',
    );
  }
  const passwordHash = await hashPassword(parsed.data.password);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE verification_tokens SET consumed_at = ? WHERE id = ?`).bind(
      nowIso(),
      row.id,
    ),
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(
      passwordHash,
      nowIso(),
      row.user_id,
    ),
    // Password change invalidates every existing session for safety.
    c.env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?, revoked_reason = 'password_reset' WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(nowIso(), row.user_id),
  ]);
  return c.json({ ok: true });
});

/* -------------------------------- Me -------------------------------- */

authRoutes.get('/me', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const entitlement = await loadEntitlement(c.env, auth.user.id);
  return c.json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      emailVerified: !!auth.user.email_verified_at,
      locale: auth.user.locale,
      unitSystem: auth.user.unit_system,
      timezone: auth.user.timezone,
      isAdmin: !!auth.user.is_admin,
      isSupport: !!auth.user.is_support,
      entitlement,
    },
  });
});

async function loadEntitlement(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT plan, status, valid_until FROM entitlements WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ plan: 'free' | 'premium'; status: string; valid_until: string | null }>();
  return {
    plan: row?.plan ?? 'free',
    status: (row?.status ?? 'free') as
      'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired',
    validUntil: row?.valid_until ?? null,
  };
}

/* --------------------------- Google OAuth --------------------------- */

authRoutes.get('/oauth/google/start', async (c) => {
  const redirect = c.req.query('redirect') ?? '/today';
  const state = randomToken(16);
  await c.env.DB.prepare(
    `INSERT INTO oauth_states (state_hash, provider, redirect_to, created_at, expires_at)
     VALUES (?, 'google', ?, ?, ?)`,
  )
    .bind(await sha256Hex(state), redirect, nowIso(), new Date(Date.now() + 600_000).toISOString())
    .run();
  const secure = !c.env.APP_URL.startsWith('http://localhost');
  c.header(
    'set-cookie',
    buildCookie(OAUTH_STATE_COOKIE, state, { maxAgeSeconds: 600, httpOnly: true, secure }),
    { append: true },
  );
  const url = googleAuthUrl({
    clientId: c.env.GOOGLE_CLIENT_ID ?? '',
    redirectUri: `${c.env.APP_URL}/api/v1/auth/oauth/google/callback`,
    state,
  });
  return c.redirect(url);
});

authRoutes.get('/oauth/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) throw badRequest('Google sign-in could not be completed.');
  const row = await c.env.DB.prepare(
    `SELECT redirect_to FROM oauth_states WHERE state_hash = ? AND provider = 'google'`,
  )
    .bind(await sha256Hex(state))
    .first<{ redirect_to: string | null }>();
  if (!row) throw badRequest('Google sign-in session expired. Please try again.');

  const identity = await exchangeGoogleCode({
    clientId: c.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: c.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: `${c.env.APP_URL}/api/v1/auth/oauth/google/callback`,
    code,
  });

  const { userId } = await upsertOAuthUser(c.env, {
    provider: 'google',
    providerUserId: identity.sub,
    email: identity.email,
    emailVerified: identity.emailVerified,
  });
  const { setCookies } = await createSession(c, userId);
  for (const cookie of setCookies) c.header('set-cookie', cookie, { append: true });
  c.header('set-cookie', clearCookie(OAUTH_STATE_COOKIE), { append: true });
  return c.redirect(row.redirect_to ?? '/today');
});

/* --------------------------- Apple OAuth --------------------------- */

authRoutes.get('/oauth/apple/start', async (c) => {
  const redirect = c.req.query('redirect') ?? '/today';
  const state = randomToken(16);
  await c.env.DB.prepare(
    `INSERT INTO oauth_states (state_hash, provider, redirect_to, created_at, expires_at)
     VALUES (?, 'apple', ?, ?, ?)`,
  )
    .bind(await sha256Hex(state), redirect, nowIso(), new Date(Date.now() + 600_000).toISOString())
    .run();
  const params = new URLSearchParams({
    client_id: c.env.APPLE_CLIENT_ID ?? '',
    redirect_uri: `${c.env.APP_URL}/api/v1/auth/oauth/apple/callback`,
    response_mode: 'form_post',
    response_type: 'code id_token',
    scope: 'name email',
    state,
  });
  return c.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
});

authRoutes.post('/oauth/apple/callback', async (c) => {
  const form = await c.req.parseBody();
  const idToken = String(form.id_token ?? '');
  const state = String(form.state ?? '');
  if (!idToken || !state) throw badRequest('Apple sign-in could not be completed.');
  const row = await c.env.DB.prepare(
    `SELECT redirect_to FROM oauth_states WHERE state_hash = ? AND provider = 'apple'`,
  )
    .bind(await sha256Hex(state))
    .first<{ redirect_to: string | null }>();
  if (!row) throw badRequest('Apple sign-in session expired. Please try again.');

  const verified = await verifyAppleIdToken(idToken, c.env.APPLE_CLIENT_ID ?? '', async (url) => {
    const res = await fetch(url);
    return (await res.json()) as {
      keys: Array<{ kid: string; kty: string; n: string; e: string }>;
    };
  });
  if (!verified.ok) throw badRequest('Apple sign-in verification failed. Please try again.');

  const sub = String(verified.claims.sub ?? '');
  const email = verified.claims.email
    ? String(verified.claims.email)
    : `${sub}@privaterelay.appleid.invalid`;
  const { userId } = await upsertOAuthUser(c.env, {
    provider: 'apple',
    providerUserId: sub,
    email,
    emailVerified: true,
  });
  const { setCookies } = await createSession(c, userId);
  for (const cookie of setCookies) c.header('set-cookie', cookie, { append: true });
  c.header('set-cookie', clearCookie(OAUTH_STATE_COOKIE), { append: true });
  return c.redirect(row.redirect_to ?? '/today');
});

/* ---------------------------- helpers ---------------------------- */

async function upsertOAuthUser(
  env: Env,
  input: {
    provider: 'google' | 'apple';
    providerUserId: string;
    email: string;
    emailVerified: boolean;
  },
): Promise<{ userId: string }> {
  const identity = await env.DB.prepare(
    `SELECT user_id FROM auth_identities WHERE provider = ? AND provider_user_id = ?`,
  )
    .bind(input.provider, input.providerUserId)
    .first<{ user_id: string }>();
  if (identity) return { userId: identity.user_id };

  const normalized = normalizeEmail(input.email);
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email_normalized = ?`)
    .bind(normalized)
    .first<{ id: string }>();
  const now = nowIso();
  let userId: string;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, provider_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(newId('ide'), userId, input.provider, input.providerUserId, input.email, now)
      .run();
  } else {
    userId = newId('usr');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, email_normalized, email_verified_at, status, locale, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 'en', ?, ?)`,
      ).bind(userId, input.email, normalized, input.emailVerified ? now : null, now, now),
      env.DB.prepare(
        `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, provider_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(newId('ide'), userId, input.provider, input.providerUserId, input.email, now),
      env.DB.prepare(
        `INSERT INTO profiles (user_id, unit_system, created_at, updated_at) VALUES (?, 'metric', ?, ?)`,
      ).bind(userId, now, now),
      env.DB.prepare(
        `INSERT INTO entitlements (user_id, plan, status, source, updated_at)
         VALUES (?, 'free', 'free', 'oauth_signup', ?)`,
      ).bind(userId, now),
    ]);
  }
  return { userId };
}
