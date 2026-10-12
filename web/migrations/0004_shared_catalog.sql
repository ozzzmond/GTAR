-- Migration 0004: Shared Catalog Foundation for Server-Authoritative Community Songbook
-- Database: gtar-db-dev / gtar-db-prod (Cloudflare D1)

CREATE TABLE IF NOT EXISTS shared_catalog_songs (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  artist TEXT,
  key TEXT,
  original_key TEXT,
  capo TEXT,
  bpm TEXT,
  time_signature TEXT,
  year TEXT,
  raw_content TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'CHORD_PRO',
  checksum TEXT NOT NULL,
  publisher_user_id TEXT NOT NULL,
  last_editor_user_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT,
  deleted_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (publisher_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (last_editor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS shared_catalog_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  song_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  title TEXT NOT NULL,
  artist TEXT,
  key TEXT,
  original_key TEXT,
  capo TEXT,
  bpm TEXT,
  time_signature TEXT,
  year TEXT,
  raw_content TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'CHORD_PRO',
  checksum TEXT NOT NULL,
  editor_user_id TEXT NOT NULL,
  change_summary TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(song_id, revision),
  FOREIGN KEY (song_id) REFERENCES shared_catalog_songs(id) ON DELETE RESTRICT,
  FOREIGN KEY (editor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_shared_catalog_songs_publisher ON shared_catalog_songs(publisher_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_catalog_songs_last_editor ON shared_catalog_songs(last_editor_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_catalog_songs_is_deleted ON shared_catalog_songs(is_deleted);
CREATE INDEX IF NOT EXISTS idx_shared_catalog_songs_updated_at ON shared_catalog_songs(updated_at);
CREATE INDEX IF NOT EXISTS idx_shared_catalog_revisions_song_id ON shared_catalog_revisions(song_id);
CREATE INDEX IF NOT EXISTS idx_shared_catalog_revisions_editor ON shared_catalog_revisions(editor_user_id);
