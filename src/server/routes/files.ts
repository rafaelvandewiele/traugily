/** Private R2 asset access (HMAC-signed URLs) + validated progress photo uploads. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors';
import { hmacSha256Hex, timingSafeEqual } from '../lib/crypto';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit';

export const fileRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function signKey(env: Env): string {
  // Falls back to APP_URL-derived key only for local dev; production MUST set ASSET_SIGNING_SECRET.
  return env.ASSET_SIGNING_SECRET ?? `dev-only-${env.APP_URL}`;
}

export async function signAssetPath(
  env: Env,
  objectKey: string,
  ttlSeconds = 300,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacSha256Hex(signKey(env), `${objectKey}:${exp}`);
  return `/api/v1/files/${encodeURIComponent(objectKey)}?exp=${exp}&sig=${sig}`;
}

/* --------------------------- Signed asset read --------------------------- */

fileRoutes.get('/:objectKey', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const objectKey = decodeURIComponent(c.req.param('objectKey'));
  const exp = Number(c.req.query('exp') ?? '');
  const sig = c.req.query('sig') ?? '';
  if (!Number.isFinite(exp) || !sig || exp < Math.floor(Date.now() / 1000)) {
    throw badRequest('This asset link has expired. Refresh the page to get a new one.');
  }
  const expected = await hmacSha256Hex(signKey(env0(c)), `${objectKey}:${exp}`);
  if (!timingSafeEqual(sig, expected)) throw forbidden('Invalid asset signature.');

  const meta = await c.env.DB.prepare(
    `SELECT owner_user_id, purpose FROM r2_objects WHERE object_key = ?`,
  )
    .bind(objectKey)
    .first<{ owner_user_id: string | null; purpose: string }>();
  if (!meta) throw notFound('Asset not found.');

  // Ownership check: members may only access their own objects; admin media is public-read
  // through the catalogue (exercise media has no owner).
  if (meta.owner_user_id && meta.owner_user_id !== auth.user.id && !auth.user.is_admin) {
    throw forbidden('You do not have access to this asset.');
  }

  const object = await c.env.MEDIA.get(objectKey);
  if (!object) throw notFound('Asset no longer exists.');
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=300',
    },
  });
});

/* ------------------------- Progress photo upload ------------------------- */

fileRoutes.post('/progress-photo', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rl = await checkRateLimit(
    c.env.CACHE,
    'upload',
    auth.user.id,
    RATE_LIMITS.upload.limit,
    RATE_LIMITS.upload.windowMs,
  );
  if (!rl.allowed)
    return c.json(
      { error: { code: 'rate_limited', message: 'Too many uploads. Please wait.' } },
      429,
    );

  // Consent gate: photos are extra-sensitive and require explicit opt-in.
  const consent = await c.env.DB.prepare(
    `SELECT granted FROM consents WHERE user_id = ? AND consent_key = 'progress_photos'`,
  )
    .bind(auth.user.id)
    .first<{ granted: number }>();
  if (!consent?.granted) {
    throw forbidden('Please enable progress photo consent in Account → Privacy first.');
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw badRequest('No file uploaded.');

  const maxBytes = Number(
    (
      await c.env.DB.prepare(
        `SELECT value FROM product_settings WHERE key = 'max_progress_photo_bytes'`,
      ).first<{ value: string }>()
    )?.value ?? '10485760',
  );
  if (file.size > maxBytes) {
    throw badRequest(`Image is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  }
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(file.type)) {
    throw badRequest('Please upload a JPEG, PNG, or WebP image.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const objectKey = `photos/${auth.user.id}/${newId('pho')}`;
  await c.env.MEDIA.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO r2_objects (object_key, owner_user_id, purpose, content_type, size_bytes, created_at)
       VALUES (?, ?, 'progress_photo', ?, ?, ?)`,
    ).bind(objectKey, auth.user.id, file.type, file.size, now),
    c.env.DB.prepare(
      `INSERT INTO progress_photos (id, user_id, object_key, content_type, category, taken_date, created_at)
       VALUES (?, ?, ?, ?, 'progress', ?, ?)`,
    ).bind(newId('pph'), auth.user.id, objectKey, file.type, now.slice(0, 10), now),
  ]);

  return c.json({ ok: true, accessPath: await signAssetPath(c.env, objectKey) });
});

function env0(c: { env: Env }): Env {
  return c.env;
}
