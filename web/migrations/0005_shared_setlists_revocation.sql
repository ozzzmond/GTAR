-- Migration: 0005_shared_setlists_revocation.sql
-- Harden QR/setlist sharing lifecycle with owner-based revocation and creator binding
-- Database: gtar-db-dev / gtar-db-prod (Cloudflare D1)

ALTER TABLE shared_setlists ADD COLUMN creator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE shared_setlists ADD COLUMN is_revoked INTEGER NOT NULL DEFAULT 0 CHECK (is_revoked IN (0, 1));
ALTER TABLE shared_setlists ADD COLUMN revoked_at TEXT;
ALTER TABLE shared_setlists ADD COLUMN revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shared_setlists_creator ON shared_setlists(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_setlists_is_revoked ON shared_setlists(is_revoked);
