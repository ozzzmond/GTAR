-- Migration 0002: Cloud Songbook Sync for server-authoritative library persistence
-- Database: gtar-db-dev / gtar-db-prod (Cloudflare D1)

CREATE TABLE IF NOT EXISTS user_songbooks (
  user_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_songbooks_user_id ON user_songbooks(user_id);
