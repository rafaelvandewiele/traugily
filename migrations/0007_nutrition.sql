-- 0007_nutrition.sql — targets, meal suggestions catalogue + translations, meal logs, shopping list, food logs.

CREATE TABLE nutrition_targets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id      TEXT REFERENCES plans (id) ON DELETE SET NULL,
  phase_key    TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  energy_kcal  REAL NOT NULL,
  protein_g    REAL NOT NULL,
  carbs_g      REAL NOT NULL,
  fat_g        REAL NOT NULL,
  detail_level TEXT NOT NULL DEFAULT 'coarse' CHECK (detail_level IN ('coarse','moderate','detailed')),
  basis        TEXT NOT NULL DEFAULT 'estimate', -- always an estimate; never medical precision
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_nutrition_targets_user ON nutrition_targets (user_id, effective_from);

CREATE TABLE meal_suggestions (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  category      TEXT NOT NULL CHECK (category IN ('breakfast','lunch','dinner','snack')),
  tags          TEXT NOT NULL DEFAULT '[]', -- JSON: e.g. 'high_protein','quick','budget'
  approx_kcal   REAL, -- coarse estimates only
  approx_protein_g REAL,
  approx_carbs_g REAL,
  approx_fat_g  REAL,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','in_review','published','retired')),
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_meal_suggestions_status ON meal_suggestions (status, category);

CREATE TABLE meal_suggestion_translations (
  suggestion_id TEXT NOT NULL REFERENCES meal_suggestions (id) ON DELETE CASCADE,
  locale        TEXT NOT NULL CHECK (locale IN ('en','nl','fr','de')),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  ingredients   TEXT NOT NULL DEFAULT '[]', -- JSON array
  steps         TEXT NOT NULL DEFAULT '[]',
  substitutions TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (suggestion_id, locale)
);

CREATE TABLE food_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  logged_date   TEXT NOT NULL,
  meal_slot     TEXT NOT NULL CHECK (meal_slot IN ('breakfast','lunch','dinner','snack','other')),
  description   TEXT NOT NULL, -- free-text description of an off-plan meal
  source        TEXT NOT NULL CHECK (source IN ('description','search','coarse_alternative')),
  accuracy      TEXT NOT NULL CHECK (accuracy IN ('low','medium','high')),
  approx_kcal   REAL,
  approx_protein_g REAL,
  approx_carbs_g REAL,
  approx_fat_g  REAL,
  suggestion_id TEXT REFERENCES meal_suggestions (id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_food_logs_user_date ON food_logs (user_id, logged_date);

CREATE TABLE shopping_list_items (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  quantity      TEXT,
  unit          TEXT,
  meal_slot     TEXT,
  checked       INTEGER NOT NULL DEFAULT 0,
  week_start    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_shopping_list_user ON shopping_list_items (user_id, week_start, checked);