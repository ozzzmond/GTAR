-- Migration 0009: per-record songbook sync (RFC #188 S4). Additive only.
-- Database: gtar-db-dev first (DEV flag SONGBOOK_RECORDS_SYNC); PROD only through the release gate.
-- user_songbooks (0002) stays as is and is kept in step by the records API (mirror) for rollback.

-- One row per song, setlist or theme of a user. `rev` is the record's revision (compare-and-swap);
-- `seq` is the user's change sequence at the record's last write (checkpoint pull).
CREATE TABLE IF NOT EXISTS user_songbook_records (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('song', 'setlist', 'theme')),
  record_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
  data_json TEXT,
  checksum TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, record_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_songbook_records_seq ON user_songbook_records(user_id, seq);

-- Per-user change sequence. A row exists once the user's records were seeded.
CREATE TABLE IF NOT EXISTS user_songbook_cursors (
  user_id TEXT PRIMARY KEY NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0),
  seeded_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
