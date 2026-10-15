-- Seed: feature flags (sample), safety rules (conservative defaults), replacement groups.
-- No personal data. Content catalogue seeds live in seed/ and are applied via `npm run db:seed`.

INSERT INTO feature_flags (key, description, enabled, audience, updated_at) VALUES
  ('offline_workout_sync', 'Offline draft + event sync for workout player', 1, 'all', '2026-01-01T00:00:00Z'),
  ('adaptation_proposals', 'Conservative adaptation proposals after completed workouts', 1, 'all', '2026-01-01T00:00:00Z'),
  ('ai_explanations', 'AI-drafted plan explanations (constrained to catalogue + rules)', 0, 'all', '2026-01-01T00:00:00Z'),
  ('pdf_reports', 'Server-side PDF progress reports stored in R2', 1, 'all', '2026-01-01T00:00:00Z'),
  ('apple_sign_in', 'Apple Sign In via OIDC', 1, 'all', '2026-01-01T00:00:00Z');

INSERT INTO replacement_groups (id, slug, description, created_at) VALUES
  ('rg_horizontal_push', 'horizontal_push', 'Chest pressing movements', '2026-01-01T00:00:00Z'),
  ('rg_vertical_push', 'vertical_push', 'Overhead pressing movements', '2026-01-01T00:00:00Z'),
  ('rg_horizontal_pull', 'horizontal_pull', 'Rowing / pulling to torso', '2026-01-01T00:00:00Z'),
  ('rg_vertical_pull', 'vertical_pull', 'Overhead pulling movements', '2026-01-01T00:00:00Z'),
  ('rg_squat', 'squat', 'Squat-pattern leg movements', '2026-01-01T00:00:00Z'),
  ('rg_hinge', 'hinge', 'Hip-hinge movements', '2026-01-01T00:00:00Z'),
  ('rg_lunge', 'lunge', 'Single-leg movements', '2026-01-01T00:00:00Z'),
  ('rg_core', 'core', 'Core stability and strength', '2026-01-01T00:00:00Z'),
  ('rg_cardio', 'cardio', 'Conditioning alternatives', '2026-01-01T00:00:00Z');

-- Conservative safety rules. TODO(clinical/legal): review thresholds and copy with a
-- qualified professional before public launch. These defaults never diagnose.
INSERT INTO safety_rules (id, rule_code, version, severity, condition, guidance_key, block_ai, requires_follow_up, status, created_at, updated_at) VALUES
  ('sr_urgent_signals', 'urgent_signals', 1, 'urgent',
   '{"keywords":["chest pain","faint","fainting","dizziness","shortness of breath","numbness","cannot stand"]}',
   'safety.guidance.urgent', 1, 1, 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('sr_pain_reported', 'pain_reported', 1, 'block',
   '{"severity_in":["pain"]}',
   'safety.guidance.pain', 1, 1, 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('sr_discomfort_reported', 'discomfort_reported', 1, 'advisory',
   '{"severity_in":["discomfort"]}',
   'safety.guidance.discomfort', 0, 0, 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('sr_recurrence_block', 'recurrence_block', 1, 'block',
   '{"reports_same_area_in_days":14,"minimum_reports":2}',
   'safety.guidance.recurrence', 1, 1, 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT INTO plan_rule_versions (id, kind, version, snapshot, status, created_by, created_at) VALUES
  ('prv_plan_1', 'plan_rules', 1,
   '{"min_rest_days_per_week":1,"max_consecutive_heavy_same_group":1,"progression_requires_completion_ratio":0.85,"deload_after_fatigue_streak":3,"short_plan_min_weeks":4,"short_plan_max_weeks":12}',
   'active', 'system', '2026-01-01T00:00:00Z'),
  ('prv_adapt_1', 'adaptation_rules', 1,
   '{"repeated_missed_threshold":2,"comfortable_completion_threshold":3,"progression_dimensions":["load","reps","sets"],"max_single_progression_percent":5}',
   'active', 'system', '2026-01-01T00:00:00Z'),
  ('prv_nutri_1', 'nutrition_rules', 1,
   '{"macro_shift_per_phase_percent":5,"rest_day_carb_shift_percent":10,"floor_source":"product_settings"}',
   'active', 'system', '2026-01-01T00:00:00Z');

INSERT INTO prompt_versions (id, purpose, version, prompt_text, status, created_by, created_at) VALUES
  ('pv_plan_expl_1', 'plan_explanation', 1,
   'You explain a fitness plan in plain, supportive language. You never invent exercises, loads, medical advice, or guaranteed outcomes. You may only describe options that exist in the provided catalogue. If the catalogue does not contain what you need, say so and fall back to the deterministic explanation.',
   'active', 'system', '2026-01-01T00:00:00Z'),
  ('pv_adapt_expl_1', 'adaptation_explanation', 1,
   'You write short, factual explanations for conservative training adaptations. You reference only the supplied signals (completed sets, reps, load, RPE/RIR, skips, availability). You never speculate about health conditions or recommend medical treatment.',
   'active', 'system', '2026-01-01T00:00:00Z');