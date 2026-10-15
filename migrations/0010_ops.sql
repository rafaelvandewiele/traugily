-- 0010_ops.sql — notifications, consents, audit logs, support cases/access grants, mail log.

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL, -- 'payment_failed','report_ready','adaptation_proposed','plan_review_due'
  title_key   TEXT NOT NULL,
  body_key    TEXT NOT NULL,
  params      TEXT NOT NULL DEFAULT '{}',
  read_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_notifications_user ON notifications (user_id, created_at);

CREATE TABLE notification_preferences (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('in_app','email','push')),
  kind        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, channel, kind)
);

CREATE TABLE push_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);

CREATE TABLE consents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  consent_key TEXT NOT NULL CHECK (consent_key IN
    ('marketing_email','push_notifications','progress_photos','future_integrations','ai_processing')),
  granted     INTEGER NOT NULL,
  version     TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (user_id, consent_key)
);

CREATE TABLE consent_history (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  consent_key TEXT NOT NULL,
  granted     INTEGER NOT NULL,
  version     TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);

CREATE INDEX idx_consent_history_user ON consent_history (user_id, changed_at);

-- Broad audit log: structured fields only. Never store sensitive free text here.
CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_role  TEXT NOT NULL CHECK (actor_role IN ('member','admin','support','system')),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  before_state TEXT, -- JSON summary, privacy-conscious
  after_state  TEXT,
  request_id  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_user_id, created_at);
CREATE INDEX idx_audit_logs_target ON audit_logs (target_type, target_id, created_at);

CREATE TABLE support_cases (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users (id) ON DELETE SET NULL,
  opened_by     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','investigating','resolved','closed')),
  subject_key   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE support_access_grants (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL REFERENCES support_cases (id) ON DELETE CASCADE,
  supporter_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason        TEXT NOT NULL, -- documented support purpose
  scope         TEXT NOT NULL, -- JSON array of permitted scopes
  authorized_by TEXT NOT NULL,
  granted_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  used_at       TEXT
);

CREATE INDEX idx_support_grants_target ON support_access_grants (target_user_id, expires_at);

CREATE TABLE mail_log (
  id          TEXT PRIMARY KEY,
  to_email    TEXT NOT NULL,
  template    TEXT NOT NULL,
  locale      TEXT NOT NULL DEFAULT 'en',
  provider    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent','failed','outbox')),
  error_message TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_mail_log_created ON mail_log (created_at);