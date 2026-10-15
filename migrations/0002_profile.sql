-- 0002_profile.sql — profile, onboarding progress, goals, availability, equipment, exclusions, nutrition prefs.

CREATE TABLE profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  birth_year        INTEGER,
  age_band          TEXT CHECK (age_band IN ('18-24','25-34','35-44','45-54','55-64','65+')),
  sex               TEXT CHECK (sex IN ('female','male','intersex','prefer_not_to_say')),
  height_cm         REAL,
  weight_kg         REAL,
  country           TEXT,
  activity_level    TEXT CHECK (activity_level IN ('sedentary','light','moderate','high','very_high')),
  work_pattern      TEXT CHECK (work_pattern IN ('desk','mixed','physical','irregular')),
  sleep_indicator   TEXT CHECK (sleep_indicator IN ('poor','fair','good','very_good')),
  stress_indicator  TEXT CHECK (stress_indicator IN ('low','moderate','high')),
  step_goal         INTEGER,
  unit_system       TEXT NOT NULL DEFAULT 'metric'
                    CHECK (unit_system IN ('metric','imperial')),
  onboarding_completed_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE onboarding_progress (
  user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  step        TEXT NOT NULL,
  data        TEXT NOT NULL, -- JSON snapshot of partial answers
  updated_at  TEXT NOT NULL
);

CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  goal_type   TEXT NOT NULL CHECK (goal_type IN
    ('muscle_gain','fat_loss','weight_loss','fitness','strength','general_health','consistent_routine')),
  priority    INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, goal_type)
);

CREATE INDEX idx_goals_user ON goals (user_id, priority);

CREATE TABLE goal_timeframes (
  user_id      TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  target_weeks INTEGER NOT NULL,
  acknowledged_realistic_range INTEGER NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE training_background (
  user_id           TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  experience_level  TEXT NOT NULL CHECK (experience_level IN ('new','returning','experienced')),
  prior_training    TEXT,
  known_lifts       TEXT, -- JSON: optional prior lifts, free-form text
  updated_at        TEXT NOT NULL
);

CREATE TABLE availability (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  weekday       INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  preferred     INTEGER NOT NULL DEFAULT 0,
  minutes       INTEGER,
  created_at    TEXT NOT NULL,
  UNIQUE (user_id, weekday)
);

CREATE TABLE blocked_dates (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_blocked_dates_user ON blocked_dates (user_id, start_date);

CREATE TABLE training_locations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('home','gym','outdoors')),
  label       TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, kind)
);

CREATE TABLE equipment (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category      TEXT NOT NULL CHECK (category IN
    ('free_weights','barbells','cables','machines','cardio','bodyweight','home_equipment')),
  status        TEXT NOT NULL CHECK (status IN ('available','not_available','unknown')),
  muscle_group  TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (user_id, category, muscle_group)
);

CREATE TABLE exercise_exclusions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exercise_id   TEXT REFERENCES exercises (id) ON DELETE CASCADE,
  replacement_group TEXT,
  reason_code   TEXT NOT NULL CHECK (reason_code IN ('equipment','preference','skill','discomfort','other')),
  reason_note   TEXT, -- non-medical free text; never a diagnosis
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_exclusions_user ON exercise_exclusions (user_id);
CREATE INDEX idx_exclusions_exercise ON exercise_exclusions (exercise_id);

CREATE TABLE nutrition_preferences (
  user_id            TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  eating_pattern     TEXT NOT NULL CHECK (eating_pattern IN ('no_preference','vegetarian','vegan','pescatarian','other')),
  allergies          TEXT, -- JSON array, member-provided
  avoid_ingredients  TEXT, -- JSON array
  budget_level       TEXT CHECK (budget_level IN ('low','moderate','flexible')),
  cooking_time       TEXT CHECK (cooking_time IN ('minimal','some','enjoy_cooking')),
  meal_count         INTEGER CHECK (meal_count BETWEEN 1 AND 6),
  meal_timing        TEXT, -- JSON: rough windows
  tracking_detail    TEXT NOT NULL DEFAULT 'coarse'
                     CHECK (tracking_detail IN ('coarse','moderate','detailed')),
  updated_at         TEXT NOT NULL
);