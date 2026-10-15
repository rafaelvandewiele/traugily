-- 0004_plans.sql — plans, versions, phases, weekly schedules, scheduled sessions, session exercises, planned sets.

CREATE TABLE plans (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','superseded','archived')),
  goal_duration_weeks INTEGER NOT NULL,
  current_version_id TEXT, -- FK added after plan_versions exists (SQLite allows forward refs here)
  assessment_json    TEXT NOT NULL DEFAULT '{}',
  nutrition_framework TEXT NOT NULL DEFAULT '{}',
  safety_acknowledged_at TEXT,
  activated_at       TEXT,
  archived_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX idx_plans_user ON plans (user_id, status);

CREATE TABLE plan_versions (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL CHECK (created_by IN ('system','member','admin')),
  created_at    TEXT NOT NULL,
  UNIQUE (plan_id, version)
);

CREATE INDEX idx_plan_versions_plan ON plan_versions (plan_id, version);

CREATE TABLE plan_phases (
  id            TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL REFERENCES plan_versions (id) ON DELETE CASCADE,
  phase_key     TEXT NOT NULL, -- orientation, build_up, progression, consolidation, review
  title_key     TEXT NOT NULL, -- i18n key
  purpose       TEXT NOT NULL, -- plain-language purpose (i18n key)
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  position      INTEGER NOT NULL,
  config_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_plan_phases_version ON plan_phases (version_id, position);

CREATE TABLE weekly_schedules (
  id          TEXT PRIMARY KEY,
  version_id  TEXT NOT NULL REFERENCES plan_versions (id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  kind        TEXT NOT NULL CHECK (kind IN ('training','rest','recovery','measurement','nutrition')),
  label_key   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (version_id, weekday)
);

CREATE INDEX idx_weekly_schedules_version ON weekly_schedules (version_id);

CREATE TABLE scheduled_sessions (
  id             TEXT PRIMARY KEY,
  version_id     TEXT NOT NULL REFERENCES plan_versions (id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  weekday        INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  kind           TEXT NOT NULL CHECK (kind IN ('workout','rest','recovery','measurement')),
  title_key      TEXT NOT NULL,
  focus_key      TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 45,
  status         TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','completed','skipped','moved','rest')),
  moved_from_date TEXT,
  move_note      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_scheduled_sessions_user_date ON scheduled_sessions (user_id, scheduled_date);
CREATE INDEX idx_scheduled_sessions_version ON scheduled_sessions (version_id);

CREATE TABLE session_exercises (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES scheduled_sessions (id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercises (id) ON DELETE RESTRICT,
  position      INTEGER NOT NULL,
  planned_order INTEGER NOT NULL, -- original plan order, retained forever
  notes_key     TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (session_id, exercise_id)
);

CREATE INDEX idx_session_exercises_session ON session_exercises (session_id, position);

CREATE TABLE planned_sets (
  id                 TEXT PRIMARY KEY,
  session_exercise_id TEXT NOT NULL REFERENCES session_exercises (id) ON DELETE CASCADE,
  set_index          INTEGER NOT NULL,
  planned_reps       INTEGER,
  planned_weight_kg  REAL,
  planned_duration_seconds INTEGER,
  planned_rpe        REAL,
  planned_rir        REAL,
  rest_seconds       INTEGER,
  set_type           TEXT NOT NULL DEFAULT 'working'
                     CHECK (set_type IN ('warmup','working','back_off')),
  created_at         TEXT NOT NULL,
  UNIQUE (session_exercise_id, set_index)
);