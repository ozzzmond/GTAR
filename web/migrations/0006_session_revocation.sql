-- Migration: 0006_session_revocation.sql
-- Server-authoritative session revocation and token lifecycle management
-- Database: gtar-db-dev / gtar-db-prod (Cloudflare D1)

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0 CHECK (is_revoked IN (0, 1)),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_is_revoked ON sessions(is_revoked);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

ALTER TABLE users ADD COLUMN sessions_revoked_at TEXT;
