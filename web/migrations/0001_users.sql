-- Migration 0001: Users table for server-authoritative account & access management
-- Database: gtar-db-dev (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  picture_url TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  access_status TEXT NOT NULL CHECK (access_status IN ('pending', 'active', 'denied')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
CREATE INDEX IF NOT EXISTS idx_users_access_status ON users(access_status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
