/** Public catalogue reads: exercises with localized instructions + replacement suggestions. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { notFound, unauthorized } from '../lib/errors';
import { getAuth } from '../middleware/auth';
import { findReplacement } from '../../domain/plan-validate';
import { loadCatalogue, loadReplacementRules } from '../services/plan-catalogue';

export const catalogRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type CatalogRow = {
  id: string;
  slug: string;
  name_en: string;
  movement_pattern: string;
  primary_muscles: string;
  equipment: string;
  skill_level: string;
  replacement_group: string | null;
  safety_flags: string;
  translated_name: string | null;
  instructions: string | null;
  warmup_cues: string | null;
  execution_steps: string | null;
  attention_cues: string | null;
  translation_source: string | null;
};

catalogRoutes.get('/exercises', async (c) => {
  const locale = c.req.query('locale') ?? 'en';
  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.slug, e.name_en, e.movement_pattern, e.primary_muscles, e.equipment,
            e.skill_level, e.replacement_group, e.safety_flags,
            t.name AS translated_name, t.instructions, t.warmup_cues, t.execution_steps,
            t.attention_cues, t.source AS translation_source
     FROM exercises e
     LEFT JOIN exercise_translations t ON t.exercise_id = e.id AND t.locale = ?
     WHERE e.review_status = 'published'
     ORDER BY e.slug LIMIT 200`,
  )
    .bind(locale)
    .all<CatalogRow>();

  const exercises = rows.results.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.translated_name ?? r.name_en, // English fallback when translation missing
    translationFallback: r.translated_name == null,
    movementPattern: r.movement_pattern,
    primaryMuscles: JSON.parse(r.primary_muscles) as string[],
    equipment: JSON.parse(r.equipment) as string[],
    skillLevel: r.skill_level,
    replacementGroup: r.replacement_group,
    safetyFlags: JSON.parse(r.safety_flags) as string[],
    instructions: r.instructions ?? null,
    warmupCues: r.warmup_cues ?? null,
    executionSteps: r.execution_steps ? (JSON.parse(r.execution_steps) as string[]) : null,
    attentionCues: r.attention_cues ? (JSON.parse(r.attention_cues) as string[]) : null,
  }));
  return c.json({ exercises, locale });
});

catalogRoutes.get('/exercises/:id', async (c) => {
  const locale = c.req.query('locale') ?? 'en';
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT e.id, e.slug, e.name_en, e.movement_pattern, e.primary_muscles, e.equipment,
            e.skill_level, e.replacement_group, e.safety_flags,
            t.name AS translated_name, t.instructions, t.warmup_cues, t.execution_steps,
            t.attention_cues, t.source AS translation_source
     FROM exercises e
     LEFT JOIN exercise_translations t ON t.exercise_id = e.id AND t.locale = ?
     WHERE e.id = ? AND e.review_status = 'published'`,
  )
    .bind(locale, id)
    .first<CatalogRow>();
  if (!row) throw notFound('Exercise not found.');

  const media = await c.env.DB.prepare(
    `SELECT id, kind, object_key, alt_text, captions, transcript FROM exercise_media WHERE exercise_id = ?`,
  )
    .bind(id)
    .all<{
      id: string;
      kind: string;
      object_key: string;
      alt_text: string;
      captions: string | null;
      transcript: string | null;
    }>();
  const labels = await c.env.DB.prepare(
    `SELECT label_code, severity, message_key FROM safety_labels WHERE exercise_id = ?`,
  )
    .bind(id)
    .all();

  return c.json({
    exercise: {
      id: row.id,
      slug: row.slug,
      name: row.translated_name ?? row.name_en,
      translationFallback: row.translated_name == null,
      movementPattern: row.movement_pattern,
      primaryMuscles: JSON.parse(row.primary_muscles) as string[],
      equipment: JSON.parse(row.equipment) as string[],
      skillLevel: row.skill_level,
      replacementGroup: row.replacement_group,
      safetyFlags: JSON.parse(row.safety_flags) as string[],
      instructions: row.instructions,
      warmupCues: row.warmup_cues,
      executionSteps: row.execution_steps ? (JSON.parse(row.execution_steps) as string[]) : null,
      attentionCues: row.attention_cues ? (JSON.parse(row.attention_cues) as string[]) : null,
    },
    media: media.results.map((m) => ({
      id: m.id,
      kind: m.kind,
      // Media is accessed through the authenticated /api/v1/files route, never public URLs.
      accessPath: `/api/v1/files/${encodeURIComponent(m.object_key)}`,
      altText: m.alt_text,
      captions: JSON.parse(m.captions ?? '[]'),
      transcript: m.transcript,
    })),
    safetyLabels: labels.results,
  });
});

catalogRoutes.get('/exercises/:id/replacements', async (c) => {
  const auth = getAuth(c.env, c); // member context: respects their equipment
  if (!auth) throw unauthorized();
  const id = c.req.param('id');
  const [catalogue, rules, owned] = await Promise.all([
    loadCatalogue(c.env.DB),
    loadReplacementRules(c.env.DB),
    c.env.DB.prepare(`SELECT category FROM equipment WHERE user_id = ? AND status = 'available'`)
      .bind(auth.user.id)
      .all<{ category: string }>(),
  ]);
  const equipmentCategories = owned.results.map((e) => e.category);
  const replacement = findReplacement(id, {
    catalogue,
    replacementRules: rules,
    equipmentCategories,
  });
  if (!replacement) {
    return c.json({
      replacement: null,
      explanationKey: 'catalog.replacements.no_safe_alternative',
      // Clear explanation when no safe direct replacement exists — never solicit a diagnosis.
    });
  }
  return c.json({ replacement, explanationKey: 'catalog.replacements.found' });
});
