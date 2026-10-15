/** Admin content mutations: exercise create/update with audit + version snapshots. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { adminExerciseSchema } from '../../shared/contracts';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { writeAudit } from '../lib/audit';

export const adminContentMutationRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

adminContentMutationRoutes.use('*', requireAdmin);

adminContentMutationRoutes.post('/exercises', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = await c.req.json().catch(() => null);
  const parsed = adminExerciseSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid exercise.', issue?.path.join('.'));
  }
  const d = parsed.data;
  const now = nowIso();
  const id = newId('exr');

  const dup = await c.env.DB.prepare(`SELECT id FROM exercises WHERE slug = ?`)
    .bind(d.slug)
    .first();
  if (dup) throw badRequest('An exercise with this slug already exists.', 'slug');

  await c.env.DB.prepare(
    `INSERT INTO exercises (id, slug, name_en, movement_pattern, primary_muscles, supporting_muscles,
       equipment, skill_level, safety_flags, replacement_group, review_status, version,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?)`,
  )
    .bind(
      id,
      d.slug,
      d.nameEn,
      d.movementPattern,
      JSON.stringify(d.primaryMuscles),
      JSON.stringify(d.supportingMuscles),
      JSON.stringify(d.equipment),
      d.skillLevel,
      JSON.stringify(d.safetyFlags),
      d.replacementGroup ?? null,
      now,
      now,
    )
    .run();

  if (d.translations) {
    for (const [locale, t] of Object.entries(d.translations)) {
      await c.env.DB.prepare(
        `INSERT INTO exercise_translations (exercise_id, locale, name, instructions, warmup_cues,
           execution_steps, attention_cues, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'human', ?)`,
      )
        .bind(
          id,
          locale,
          t.name,
          t.instructions,
          t.warmupCues,
          JSON.stringify(t.executionSteps),
          JSON.stringify(t.attentionCues),
          now,
        )
        .run();
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO exercise_versions (id, exercise_id, version, snapshot, changed_by, change_note, created_at)
     VALUES (?, ?, 1, ?, ?, 'created', ?)`,
  )
    .bind(newId('exv'), id, JSON.stringify(d), auth.user.id, now)
    .run();

  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'admin' },
    action: 'exercise_created',
    targetType: 'exercise',
    targetId: id,
    afterState: { slug: d.slug, reviewStatus: 'draft' },
    requestId: c.get('requestId'),
  });
  return c.json({ ok: true, id, reviewStatus: 'draft' });
});

adminContentMutationRoutes.put('/exercises/:id', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = adminExerciseSchema.safeParse(body);
  if (!parsed.success) throw badRequest('Invalid exercise payload.');
  const d = parsed.data;
  const now = nowIso();

  const before = await c.env.DB.prepare(`SELECT slug, review_status FROM exercises WHERE id = ?`)
    .bind(id)
    .first<{ slug: string; review_status: string }>();
  if (!before) throw notFound('Exercise not found.');

  await c.env.DB.prepare(
    `UPDATE exercises SET name_en = ?, movement_pattern = ?, primary_muscles = ?,
       supporting_muscles = ?, equipment = ?, skill_level = ?, safety_flags = ?,
       replacement_group = ?, version = version + 1, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      d.nameEn,
      d.movementPattern,
      JSON.stringify(d.primaryMuscles),
      JSON.stringify(d.supportingMuscles),
      JSON.stringify(d.equipment),
      d.skillLevel,
      JSON.stringify(d.safetyFlags),
      d.replacementGroup ?? null,
      now,
      id,
    )
    .run();

  if (d.translations) {
    for (const [locale, t] of Object.entries(d.translations)) {
      await c.env.DB.prepare(
        `INSERT INTO exercise_translations (exercise_id, locale, name, instructions, warmup_cues,
           execution_steps, attention_cues, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'human', ?)
         ON CONFLICT(exercise_id, locale) DO UPDATE SET name = excluded.name,
           instructions = excluded.instructions, warmup_cues = excluded.warmup_cues,
           execution_steps = excluded.execution_steps, attention_cues = excluded.attention_cues,
           source = excluded.source, updated_at = excluded.updated_at`,
      )
        .bind(
          id,
          locale,
          t.name,
          t.instructions,
          t.warmupCues,
          JSON.stringify(t.executionSteps),
          JSON.stringify(t.attentionCues),
          now,
        )
        .run();
    }
  }

  const versionRow = await c.env.DB.prepare(`SELECT version FROM exercises WHERE id = ?`)
    .bind(id)
    .first<{ version: number }>();
  await c.env.DB.prepare(
    `INSERT INTO exercise_versions (id, exercise_id, version, snapshot, changed_by, change_note, created_at)
     VALUES (?, ?, ?, ?, ?, 'updated', ?)`,
  )
    .bind(newId('exv'), id, versionRow?.version ?? 2, JSON.stringify(d), auth.user.id, now)
    .run();

  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'admin' },
    action: 'exercise_updated',
    targetType: 'exercise',
    targetId: id,
    beforeState: { slug: before.slug, reviewStatus: before.review_status },
    afterState: { slug: d.slug },
    requestId: c.get('requestId'),
  });
  return c.json({ ok: true, version: versionRow?.version });
});

adminContentMutationRoutes.post('/exercises/:id/review', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    action?: 'submit_review' | 'publish' | 'retire';
  };
  const action = body.action;
  if (!action || !['submit_review', 'publish', 'retire'].includes(action)) {
    throw badRequest('Choose submit_review, publish, or retire.');
  }
  const target =
    action === 'submit_review' ? 'in_review' : action === 'publish' ? 'published' : 'retired';
  const now = nowIso();
  const result = await c.env.DB.prepare(
    `UPDATE exercises SET review_status = ?, updated_at = ?,
       published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END
     WHERE id = ?`,
  )
    .bind(target, now, target, now, id)
    .run();
  if (result.meta.changes === 0) throw notFound('Exercise not found.');

  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'admin' },
    action: `exercise_${action}`,
    targetType: 'exercise',
    targetId: id,
    afterState: { reviewStatus: target },
    requestId: c.get('requestId'),
  });
  return c.json({ ok: true, reviewStatus: target });
});

adminContentMutationRoutes.post('/replacement-rules', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const body = (await c.req.json().catch(() => null)) as {
    groupSlug?: string;
    exerciseId?: string;
    replacementExerciseId?: string;
    priority?: number;
    note?: string;
  } | null;
  if (!body?.groupSlug || !body.exerciseId || !body.replacementExerciseId) {
    throw badRequest('groupSlug, exerciseId and replacementExerciseId are required.');
  }
  const group = await c.env.DB.prepare(`SELECT id FROM replacement_groups WHERE slug = ?`)
    .bind(body.groupSlug)
    .first<{ id: string }>();
  if (!group) throw notFound('Replacement group not found.');
  await c.env.DB.prepare(
    `INSERT INTO replacement_rules (id, group_id, exercise_id, replacement_exercise_id, priority,
       note, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
  )
    .bind(
      newId('rrl'),
      group.id,
      body.exerciseId,
      body.replacementExerciseId,
      body.priority ?? 0,
      body.note ?? '',
      nowIso(),
    )
    .run();
  return c.json({ ok: true });
});
