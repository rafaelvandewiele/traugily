-- 0008_progress.sql — measurements, progress photos, goal reviews, personal records, weigh-ins.

CREATE TABLE weigh_ins (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entry_date  TEXT NOT NULL,
  weight_kg   REAL NOT NULL,
  conditions  TEXT, -- JSON: {after_toilet, before_breakfast, ...} consistent-conditions context
  skipped     INTEGER NOT NULL DEFAULT 0,
  skip_reason TEXT,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','device')),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, entry_date)
);

CREATE INDEX idx_weigh_ins_user_date ON weigh_ins (user_id, entry_date);

CREATE TABLE measurements (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN
    ('circumference','fitness_test','strength_indicator','energy','recovery','other')),
  metric_key    TEXT NOT NULL,
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,
  entry_date    TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_measurements_user_kind ON measurements (user_id, kind, entry_date);

CREATE TABLE progress_photos (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  object_key    TEXT NOT NULL, -- private R2 key; ownership recorded here
  content_type  TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'progress',
  taken_date    TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_progress_photos_user ON progress_photos (user_id, taken_date);

CREATE TABLE goal_reviews (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  review_date   TEXT NOT NULL,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  summary       TEXT NOT NULL, -- JSON: direction vs goal, consistency stats
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_goal_reviews_user ON goal_reviews (user_id, review_date);

CREATE TABLE personal_records (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  record_kind   TEXT NOT NULL CHECK (record_kind IN ('best_weight','best_reps_at_weight','estimated_1rm')),
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,
  achieved_date TEXT NOT NULL,
  workout_id    TEXT REFERENCES workout_executions (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_personal_records_user ON personal_records (user_id, exercise_id, record_kind);