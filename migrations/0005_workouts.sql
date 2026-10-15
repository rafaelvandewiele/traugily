-- 0005_workouts.sql — workout drafts, executions, performed exercises, set logs, rest logs, skips, feedback, pain reports.

CREATE TABLE workout_drafts (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id     TEXT REFERENCES scheduled_sessions (id) ON DELETE SET NULL,
  client_draft_id TEXT, -- client-generated UUID for offline creation
  state          TEXT NOT NULL DEFAULT 'draft'
                 CHECK (state IN ('draft','in_progress','finished','discarded')),
  started_at     TEXT,
  device_state   TEXT NOT NULL DEFAULT '{}', -- JSON snapshot the client can rehydrate from
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (user_id, client_draft_id)
);

CREATE INDEX idx_workout_drafts_user ON workout_drafts (user_id, state);

CREATE TABLE workout_executions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  draft_id         TEXT REFERENCES workout_drafts (id) ON DELETE SET NULL,
  session_id       TEXT REFERENCES scheduled_sessions (id) ON DELETE SET NULL,
  client_workout_id TEXT UNIQUE, -- idempotency anchor from the client
  plan_version_id  TEXT REFERENCES plan_versions (id) ON DELETE SET NULL,
  state            TEXT NOT NULL DEFAULT 'in_progress'
                   CHECK (state IN ('in_progress','completed','discarded')),
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  server_version   INTEGER NOT NULL DEFAULT 1,
  energy_rating    INTEGER CHECK (energy_rating BETWEEN 1 AND 5),
  difficulty_rating INTEGER CHECK (difficulty_rating BETWEEN 1 AND 5),
  recovery_rating  INTEGER CHECK (recovery_rating BETWEEN 1 AND 5),
  general_note     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_workout_executions_user ON workout_executions (user_id, started_at);
CREATE INDEX idx_workout_executions_session ON workout_executions (session_id);

CREATE TABLE performed_exercises (
  id                  TEXT PRIMARY KEY,
  workout_id          TEXT NOT NULL REFERENCES workout_executions (id) ON DELETE CASCADE,
  session_exercise_id TEXT REFERENCES session_exercises (id) ON DELETE SET NULL,
  exercise_id         TEXT NOT NULL REFERENCES exercises (id) ON DELETE RESTRICT,
  planned_position    INTEGER NOT NULL,
  actual_position     INTEGER NOT NULL, -- free reorder persisted
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','completed','skipped')),
  skip_reason         TEXT CHECK (skip_reason IN
    ('time','equipment_unavailable','discomfort','too_difficult','preference','other','no_reason')),
  skip_note           TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (workout_id, exercise_id)
);

CREATE INDEX idx_performed_exercises_workout ON performed_exercises (workout_id, actual_position);

CREATE TABLE set_logs (
  id                    TEXT PRIMARY KEY,
  workout_id            TEXT NOT NULL REFERENCES workout_executions (id) ON DELETE CASCADE,
  performed_exercise_id TEXT NOT NULL REFERENCES performed_exercises (id) ON DELETE CASCADE,
  set_index             INTEGER NOT NULL, -- planned set slot (1-based)
  planned_set_id        TEXT REFERENCES planned_sets (id) ON DELETE SET NULL,
  actual_weight_kg      REAL,
  actual_reps           INTEGER,
  actual_rpe            REAL,
  actual_rir            INTEGER,
  status                TEXT NOT NULL CHECK (status IN ('completed','skipped','partial')),
  note                  TEXT,
  client_event_id       TEXT, -- idempotent sync anchor
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (workout_id, performed_exercise_id, set_index)
);

CREATE INDEX idx_set_logs_workout ON set_logs (workout_id);

CREATE TABLE rest_logs (
  id               TEXT PRIMARY KEY,
  workout_id       TEXT NOT NULL REFERENCES workout_executions (id) ON DELETE CASCADE,
  set_log_id       TEXT REFERENCES set_logs (id) ON DELETE CASCADE,
  planned_seconds  INTEGER,
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  actual_seconds   INTEGER,
  paused_seconds   INTEGER NOT NULL DEFAULT 0,
  adjusted         INTEGER NOT NULL DEFAULT 0,
  skipped          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_rest_logs_workout ON rest_logs (workout_id);

CREATE TABLE workout_feedback (
  id          TEXT PRIMARY KEY,
  workout_id  TEXT NOT NULL REFERENCES workout_executions (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('energy','difficulty','recovery','note')),
  value       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Structured pain/discomfort reports. Extra-sensitive data: never logged to broad audit logs.
CREATE TABLE pain_reports (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workout_id         TEXT REFERENCES workout_executions (id) ON DELETE SET NULL,
  performed_exercise_id TEXT REFERENCES performed_exercises (id) ON DELETE SET NULL,
  severity           TEXT NOT NULL CHECK (severity IN ('discomfort','pain','urgent')),
  body_area          TEXT NOT NULL DEFAULT 'unspecified',
  note               TEXT, -- optional; kept extra-sensitive
  triggered_rule_id  TEXT, -- safety rule id that fired (no sensitive text exposure)
  guidance_key       TEXT NOT NULL, -- i18n key for the shown guidance
  reported_at        TEXT NOT NULL,
  follow_up_required INTEGER NOT NULL DEFAULT 0,
  resolved_at        TEXT
);

CREATE INDEX idx_pain_reports_user ON pain_reports (user_id, reported_at);

CREATE TABLE workout_sync_events (
  id             TEXT PRIMARY KEY,
  workout_id     TEXT NOT NULL REFERENCES workout_executions (id) ON DELETE CASCADE,
  client_event_id TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  payload        TEXT NOT NULL,
  applied_at     TEXT NOT NULL,
  UNIQUE (workout_id, client_event_id)
);