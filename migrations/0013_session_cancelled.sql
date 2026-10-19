-- Allow member-deleted (cancelled) scheduled sessions: visible in the calendar,
-- excluded from the plan flow. Rebuild via the safe table-copy pattern
-- (SQLite cannot widen a CHECK constraint with ALTER TABLE).

PRAGMA foreign_keys = OFF;

CREATE TABLE scheduled_sessions_new (
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
                 CHECK (status IN ('planned','completed','skipped','moved','rest','cancelled')),
  moved_from_date TEXT,
  move_note      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

INSERT INTO scheduled_sessions_new
  (id, version_id, user_id, scheduled_date, weekday, kind, title_key, focus_key,
   duration_minutes, status, moved_from_date, move_note, created_at, updated_at)
SELECT id, version_id, user_id, scheduled_date, weekday, kind, title_key, focus_key,
  duration_minutes, status, moved_from_date, move_note, created_at, updated_at
FROM scheduled_sessions;

DROP TABLE scheduled_sessions;
ALTER TABLE scheduled_sessions_new RENAME TO scheduled_sessions;

CREATE INDEX idx_scheduled_sessions_user_date ON scheduled_sessions (user_id, scheduled_date);
CREATE INDEX idx_scheduled_sessions_version ON scheduled_sessions (version_id);

PRAGMA foreign_keys = ON;
