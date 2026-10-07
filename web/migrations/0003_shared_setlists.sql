-- Migration: 0003_shared_setlists.sql
-- Create shared_setlists table for privacy-preserving, tokenized setlist snapshots

CREATE TABLE IF NOT EXISTS shared_setlists (
  share_token TEXT PRIMARY KEY,
  setlist_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_setlists_expires_at ON shared_setlists(expires_at);
