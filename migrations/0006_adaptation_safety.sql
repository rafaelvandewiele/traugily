-- 0006_adaptation_safety.sql — adaptation proposals, source signals, decisions, safety rules, plan rules/prompts, feature flags.

CREATE TABLE adaptation_proposals (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id         TEXT REFERENCES plans (id) ON DELETE CASCADE,
  source_workout_id TEXT REFERENCES workout_executions (id) ON DELETE SET NULL,
  trigger_code    TEXT NOT NULL, -- e.g. 'repeated_missed_targets', 'comfortable_completion'
  reason_key      TEXT NOT NULL, -- i18n key explaining the trigger
  changed_fields  TEXT NOT NULL, -- JSON diff of proposed future changes
  effective_date  TEXT NOT NULL,
  plan_version_at_creation TEXT,
  member_explanation TEXT NOT NULL, -- plain-language explanation (i18n key + params JSON)
  explanation_params TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','edited','rejected','superseded','blocked')),
  decision_note   TEXT,
  decided_at      TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_adaptation_proposals_user ON adaptation_proposals (user_id, status, created_at);

CREATE TABLE adaptation_source_signals (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES adaptation_proposals (id) ON DELETE CASCADE,
  signal_code TEXT NOT NULL,
  signal_data TEXT NOT NULL, -- JSON: numbers/ids only, no sensitive free text
  observed_at TEXT NOT NULL
);

CREATE INDEX idx_adaptation_signals_proposal ON adaptation_source_signals (proposal_id);

CREATE TABLE safety_rules (
  id            TEXT PRIMARY KEY,
  rule_code     TEXT NOT NULL UNIQUE,
  version       INTEGER NOT NULL DEFAULT 1,
  severity      TEXT NOT NULL CHECK (severity IN ('advisory','block','urgent')),
  condition     TEXT NOT NULL, -- JSON predicate description, conservative defaults
  guidance_key  TEXT NOT NULL, -- i18n key for member-facing guidance
  block_ai      INTEGER NOT NULL DEFAULT 0,
  requires_follow_up INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  -- TODO(clinical/legal): thresholds below are product defaults, NOT medically validated.
  -- A qualified professional must review before any public launch.
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE rule_versions (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL REFERENCES safety_rules (id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (rule_id, version)
);

CREATE TABLE plan_rule_versions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('plan_rules','adaptation_rules','nutrition_rules')),
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (kind, version)
);

CREATE TABLE prompt_versions (
  id          TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL, -- e.g. 'plan_explanation', 'adaptation_explanation'
  version     INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (purpose, version)
);

CREATE TABLE feature_flags (
  key         TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  enabled     INTEGER NOT NULL DEFAULT 0,
  audience    TEXT NOT NULL DEFAULT 'all',
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE operational_events (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL, -- 'webhook_failed','sync_conflict','export_failed','ai_fallback','email_failed'
  severity     TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','error')),
  subject      TEXT NOT NULL, -- e.g. resource id; never sensitive free text
  detail       TEXT NOT NULL DEFAULT '{}', -- JSON, privacy-conscious
  request_id   TEXT,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);

CREATE INDEX idx_operational_events_kind ON operational_events (kind, created_at);