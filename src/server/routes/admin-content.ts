/** Admin content reads: exercise catalogue list + detail with versions/translations. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { notFound } from '../lib/errors';
import { requireAdmin } from '../middleware/rbac';

export const adminContentRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

adminContentRoutes.use('*', requireAdmin);

adminContentRoutes.get('/exercises', async (c) => {
  const status = c.req.query('status');
  const sql = `SELECT id, slug, name_en, movement_pattern, skill_level, replacement_group,
      review_status, version, created_at, updated_at
    FROM exercises ${status ? 'WHERE review_status = ?' : ''} ORDER BY slug LIMIT 300`;
  const rows = await c.env.DB.prepare(sql)
    .bind(...(status ? [status] : []))
    .all();
  return c.json({ exercises: rows.results });
});

adminContentRoutes.get('/exercises/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const exercise = await db.prepare(`SELECT * FROM exercises WHERE id = ?`).bind(id).first();
  if (!exercise) throw notFound('Exercise not found.');
  const [translations, versions, media, safetyLabels, replacementRules] = await Promise.all([
    db.prepare(`SELECT * FROM exercise_translations WHERE exercise_id = ?`).bind(id).all(),
    db
      .prepare(
        `SELECT id, version, change_note, changed_by, created_at FROM exercise_versions
       WHERE exercise_id = ? ORDER BY version DESC LIMIT 20`,
      )
      .bind(id)
      .all(),
    db
      .prepare(
        `SELECT id, kind, object_key, alt_text, captions FROM exercise_media WHERE exercise_id = ?`,
      )
      .bind(id)
      .all(),
    db
      .prepare(`SELECT label_code, severity, message_key FROM safety_labels WHERE exercise_id = ?`)
      .bind(id)
      .all(),
    db
      .prepare(
        `SELECT rr.replacement_exercise_id, rr.priority, rr.note, rr.status, e.name_en
         FROM replacement_rules rr JOIN exercises e ON e.id = rr.replacement_exercise_id
         WHERE rr.exercise_id = ? ORDER BY rr.priority DESC`,
      )
      .bind(id)
      .all(),
  ]);
  return c.json({
    exercise,
    translations: translations.results,
    versions: versions.results,
    media: media.results,
    safetyLabels: safetyLabels.results,
    replacementRules: replacementRules.results,
  });
});
