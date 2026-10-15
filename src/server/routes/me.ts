/** Member preferences: locale, unit system, timezone. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { z } from 'zod';
import { badRequest, unauthorized } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { LOCALES } from '../../shared/contracts';

export const meRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const preferencesSchema = z.object({
  locale: z.enum(LOCALES).optional(),
  unitSystem: z.enum(['metric', 'imperial']).optional(),
  timezone: z.string().max(64).optional(),
});

meRoutes.put('/preferences', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Invalid preference value.');

  const d = parsed.data;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET locale = COALESCE(?, locale), unit_system = COALESCE(?, unit_system),
         timezone = COALESCE(?, timezone), updated_at = ? WHERE id = ?`,
    ).bind(d.locale ?? null, d.unitSystem ?? null, d.timezone ?? null, nowIso(), auth.user.id),
    c.env.DB.prepare(
      `UPDATE profiles SET unit_system = COALESCE(?, unit_system), updated_at = ? WHERE user_id = ?`,
    ).bind(d.unitSystem ?? null, nowIso(), auth.user.id),
  ]);
  return c.json({ ok: true });
});
