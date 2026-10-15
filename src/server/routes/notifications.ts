/** Notifications: list, mark read, preferences. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { badRequest, unauthorized } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';

export const notificationRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

notificationRoutes.get('/', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT id, kind, title_key, body_key, params, read_at, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(auth.user.id)
    .all();
  return c.json({ notifications: rows.results });
});

notificationRoutes.post('/:id/read', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  await c.env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?`)
    .bind(nowIso(), c.req.param('id'), auth.user.id)
    .run();
  return c.json({ ok: true });
});

notificationRoutes.get('/preferences', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT channel, kind, enabled FROM notification_preferences WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .all();
  return c.json({ preferences: rows.results });
});

notificationRoutes.put('/preferences', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = (await c.req.json().catch(() => null)) as {
    preferences?: Array<{ channel: string; kind: string; enabled: boolean }>;
  } | null;
  if (!body?.preferences || body.preferences.length === 0) {
    throw badRequest('No preferences provided.');
  }
  const now = nowIso();
  for (const p of body.preferences) {
    if (!['in_app', 'email', 'push'].includes(p.channel)) continue;
    await c.env.DB.prepare(
      `INSERT INTO notification_preferences (user_id, channel, kind, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, channel, kind) DO UPDATE SET enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
      .bind(auth.user.id, p.channel, p.kind, p.enabled ? 1 : 0, now)
      .run();
  }
  return c.json({ ok: true });
});
