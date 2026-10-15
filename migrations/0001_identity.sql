-- 0001_identity.sql — users, auth identities, sessions, roles, verification tokens.
-- All timestamps are ISO-8601 UTC strings. IDs are ULID-ish text (generated in app code).

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  email_normalized   TEXT NOT NULL UNIQUE,
  email_verified_at  TEXT,
  password_hash      TEXT, -- null for OAuth-only accounts
  password_algo      TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','suspended','deleted')),
  locale             TEXT NOT NULL DEFAULT 'en',
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  unit_system        TEXT NOT NULL DEFAULT 'metric'
                     CHECK (unit_system IN ('metric','imperial')),
  is_admin           INTEGER NOT NULL DEFAULT 0,
  is_support         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);

CREATE INDEX idx_users_status ON users (status);
CREATE INDEX idx_users_created ON users (created_at);

CREATE TABLE auth_identities (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('google','apple','email')),
  provider_user_id    TEXT NOT NULL,
  provider_email      TEXT,
  provider_payload    TEXT, -- JSON, minimal fields only
  created_at          TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_auth_identities_user ON auth_identities (user_id);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  csrf_token    TEXT NOT NULL,
  user_agent    TEXT,
  ip_hash       TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  revoked_reason TEXT
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE verification_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX idx_verification_tokens_user ON verification_tokens (user_id, purpose);

CREATE TABLE oauth_states (
  state_hash  TEXT PRIMARY KEY,
  provider    TEXT NOT NULL CHECK (provider IN ('google','apple')),
  redirect_to TEXT,
  pkce_verifier TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- Idempotency keys for state-changing API requests (workout sync, exports, ...).
CREATE TABLE idempotency_keys (
  key         TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  response    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, endpoint, key)
);

CREATE TABLE rate_limit_counters (
  bucket      TEXT NOT NULL,
  key         TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count       INTEGER NOT NULL,
  expires_at  TEXT NOT NULL,
  PRIMARY KEY (bucket, key, window_start)
);

CREATE INDEX idx_rate_limit_expiry ON rate_limit_counters (expires_at);