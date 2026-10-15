-- 0003_catalogue.sql — exercises, translations, media, replacement groups/rules, safety labels, content versions.

CREATE TABLE exercises (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  name_en            TEXT NOT NULL,
  movement_pattern   TEXT NOT NULL CHECK (movement_pattern IN
    ('squat','hinge','horizontal_push','vertical_push','horizontal_pull','vertical_pull',
     'lunge','carry','core_anti_rotation','core_flexion','core_extension','isometric',
     'cardio_steady','cardio_intervals','mobility')),
  primary_muscles    TEXT NOT NULL, -- JSON array of muscle keys
  supporting_muscles TEXT NOT NULL DEFAULT '[]',
  equipment          TEXT NOT NULL, -- JSON array of equipment categories
  skill_level        TEXT NOT NULL CHECK (skill_level IN ('beginner','intermediate','advanced')),
  safety_flags       TEXT NOT NULL DEFAULT '[]', -- JSON array of advisory flags
  replacement_group  TEXT, -- exercises sharing a group are mutually replaceable
  review_status      TEXT NOT NULL DEFAULT 'draft'
                     CHECK (review_status IN ('draft','in_review','published','retired')),
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  published_at       TEXT
);

CREATE INDEX idx_exercises_pattern ON exercises (movement_pattern);
CREATE INDEX idx_exercises_group ON exercises (replacement_group);
CREATE INDEX idx_exercises_status ON exercises (review_status);

CREATE TABLE exercise_translations (
  exercise_id   TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  locale        TEXT NOT NULL CHECK (locale IN ('en','nl','fr','de')),
  name          TEXT NOT NULL,
  instructions  TEXT NOT NULL,
  warmup_cues   TEXT NOT NULL DEFAULT '',
  execution_steps TEXT NOT NULL DEFAULT '[]', -- JSON array of step strings
  attention_cues  TEXT NOT NULL DEFAULT '[]',
  source        TEXT NOT NULL DEFAULT 'human'
                CHECK (source IN ('human','machine_fallback')),
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (exercise_id, locale)
);

CREATE TABLE exercise_media (
  id            TEXT PRIMARY KEY,
  exercise_id   TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('image','video','diagram')),
  object_key    TEXT NOT NULL, -- R2 key; never a public URL
  content_type  TEXT NOT NULL,
  captions      TEXT NOT NULL DEFAULT '[]', -- JSON: [{locale, text}] caption track
  transcript    TEXT, -- text alternative / transcript
  alt_text      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_exercise_media_exercise ON exercise_media (exercise_id);

CREATE TABLE replacement_groups (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE replacement_rules (
  id                   TEXT PRIMARY KEY,
  group_id             TEXT NOT NULL REFERENCES replacement_groups (id) ON DELETE CASCADE,
  exercise_id          TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  replacement_exercise_id TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  priority             INTEGER NOT NULL DEFAULT 0,
  note                 TEXT NOT NULL DEFAULT '', -- plain-language rationale
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','disabled')),
  created_at           TEXT NOT NULL,
  UNIQUE (exercise_id, replacement_exercise_id)
);

CREATE INDEX idx_replacement_rules_group ON replacement_rules (group_id, priority);

CREATE TABLE safety_labels (
  id            TEXT PRIMARY KEY,
  exercise_id   TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  label_code    TEXT NOT NULL, -- e.g. 'warm_up_required', 'shoulder_caution'
  severity      TEXT NOT NULL DEFAULT 'advisory' CHECK (severity IN ('advisory','caution')),
  message_key   TEXT NOT NULL, -- i18n key for the advisory copy
  created_at    TEXT NOT NULL,
  UNIQUE (exercise_id, label_code)
);

CREATE TABLE exercise_versions (
  id            TEXT PRIMARY KEY,
  exercise_id   TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  snapshot      TEXT NOT NULL, -- JSON snapshot of the whole exercise row + translations
  changed_by    TEXT NOT NULL,
  change_note   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (exercise_id, version)
);