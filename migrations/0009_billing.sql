-- 0009_billing.sql — Stripe customers, subscriptions, entitlement snapshots, invoices, webhook events, reminders, cancellations.

CREATE TABLE stripe_customers (
  user_id           TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email             TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE subscriptions (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id     TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN
    ('trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid','paused')),
  price_id               TEXT NOT NULL,
  currency               TEXT NOT NULL,
  interval                TEXT NOT NULL DEFAULT 'month',
  current_period_start   TEXT,
  current_period_end     TEXT,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  canceled_at            TEXT,
  trial_start            TEXT,
  trial_end              TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX idx_subscriptions_user ON subscriptions (user_id, status);
CREATE INDEX idx_subscriptions_customer ON subscriptions (stripe_customer_id);

-- Entitlement snapshots are only written from *verified* webhook events or explicit server syncs.
CREATE TABLE entitlements (
  user_id            TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  plan               TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')),
  status             TEXT NOT NULL DEFAULT 'free'
                     CHECK (status IN ('free','trialing','active','past_due','canceled','expired')),
  valid_until        TEXT,
  source             TEXT NOT NULL DEFAULT 'system',
  updated_at         TEXT NOT NULL
);

CREATE TABLE billing_invoices (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  stripe_invoice_id      TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT,
  amount_due             INTEGER NOT NULL,
  amount_paid            INTEGER NOT NULL DEFAULT 0,
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL,
  hosted_invoice_url     TEXT,
  invoice_pdf_url        TEXT,
  due_date               TEXT,
  paid_at                TEXT,
  created_at             TEXT NOT NULL
);

CREATE INDEX idx_billing_invoices_user ON billing_invoices (user_id, created_at);

-- Every webhook event is recorded; processing is idempotent on stripe_event_id.
CREATE TABLE billing_webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  processed_at    TEXT,
  status          TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','processed','duplicate','failed','ignored')),
  error_message   TEXT
);

CREATE INDEX idx_billing_webhook_events_type ON billing_webhook_events (event_type, received_at);

-- Failed-payment reminder cadence: one row per user per day; driven by cron over Stripe state.
CREATE TABLE billing_reminders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reminder_date TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('email','push','in_app')),
  reason      TEXT NOT NULL CHECK (reason IN ('payment_failed','canceling_soon','canceled')),
  delivery_status TEXT NOT NULL DEFAULT 'pending'
                  CHECK (delivery_status IN ('pending','sent','failed','skipped')),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, reminder_date, channel, reason)
);

CREATE TABLE billing_cancellation_jobs (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL,
  first_failed_at     TEXT NOT NULL,
  scheduled_cancel_at TEXT NOT NULL,
  executed_at         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','executed','canceled_by_stripe','skipped')),
  created_at          TEXT NOT NULL
);

CREATE INDEX idx_cancellation_jobs_status ON billing_cancellation_jobs (status, scheduled_cancel_at);

CREATE TABLE report_exports (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_start   TEXT NOT NULL,
  period_end     TEXT NOT NULL,
  detail_level   TEXT NOT NULL CHECK (detail_level IN ('summary','standard','detailed')),
  report_locale  TEXT NOT NULL CHECK (report_locale IN ('en','nl','fr','de')),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','ready','failed')),
  object_key     TEXT, -- private R2 key
  file_size      INTEGER,
  error_message  TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  plan_version_id TEXT,
  timezone       TEXT NOT NULL DEFAULT 'UTC',
  created_at     TEXT NOT NULL,
  completed_at   TEXT,
  UNIQUE (user_id, period_start, period_end, detail_level, report_locale)
);

CREATE INDEX idx_report_exports_user ON report_exports (user_id, created_at);

CREATE TABLE r2_objects (
  object_key    TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  purpose       TEXT NOT NULL CHECK (purpose IN
    ('exercise_media','progress_photo','report_pdf','export_artifact')),
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER,
  checksum      TEXT,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_r2_objects_owner ON r2_objects (owner_user_id, purpose);