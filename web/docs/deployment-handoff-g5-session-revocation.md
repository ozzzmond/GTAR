# Deployment Handoff: G5 Session Revocation Security

## Overview
This document specifies the operator-controlled deployment plan, database schema dependencies, verification procedures, rollout ordering, and rollback semantics for Batch 3 G5 (`g5-session-revocation-security`).

**IMPORTANT DEPLOYMENT GATE**:
The migration (`0006_session_revocation.sql`) and server functions (`web/functions/api/auth/session.ts`, `web/functions/api/auth/logout.ts`, `web/functions/lib/authCore.ts`) are schema-dependent. Server functions require the `sessions` table and `users.sessions_revoked_at` column to record and validate session lifecycle and revocation state.

A successful code PR does NOT authorize automatic database migration or production activation. Do not deploy or activate schema-dependent functions in production before the required migration has been explicitly reviewed, approved, and applied to the target database.

## Migration Specification
- **File**: `web/migrations/0006_session_revocation.sql`
- **Type**: Strictly additive (`CREATE TABLE IF NOT EXISTS sessions ...`, `ALTER TABLE users ADD COLUMN sessions_revoked_at ...`, `CREATE INDEX IF NOT EXISTS ...`)
- **Non-Destructive**: Does NOT drop tables, does NOT alter existing primary keys or user records, does NOT delete legacy sessions or catalog data.
- **Legacy Records**: Existing users retain `sessions_revoked_at = NULL`. Legacy stateless tokens remain valid within the bounded 7-day transition window unless explicitly revoked.
- **Database Targets**: `gtar-db-dev` (DEV D1) / `gtar-db-prod` (PROD D1).

## Deployment Order & Rollout Sequencing

### Step 1: Pre-Deployment Review & Verification Gate
- Verify PR approval on GitHub targeting `dev`.
- Verify CI test suite passes completely on branch `feat/g5-session-revocation-security`.
- Confirm `0006_session_revocation.sql` is unapplied and matches repository standards.

### Step 2: DEV D1 Backup & Migration
- Perform a D1 backup / export of DEV database before executing schema changes:
  ```bash
  npx wrangler d1 export gtar-db-dev --output ./dev-backup-pre-g5.sql
  ```
- Apply Migration 0006 to DEV database:
  ```bash
  npx wrangler d1 migrations apply gtar-db-dev --remote
  ```
- Verify DEV schema:
  ```bash
  npx wrangler d1 execute gtar-db-dev --command "PRAGMA table_info(sessions);"
  npx wrangler d1 execute gtar-db-dev --command "PRAGMA table_info(users);"
  ```
  Expected:
  - `sessions` table exists with columns: `id`, `user_id`, `session_token_hash`, `created_at`, `expires_at`, `last_seen_at`, `is_revoked`, `revoked_at`.
  - `users` table includes column: `sessions_revoked_at`.

### Step 3: Deploy DEV Cloudflare Pages Functions
- Merge PR to `dev` or trigger Cloudflare Pages DEV branch deployment.
- Execute required smoke tests:
  1. Google sign-in via `POST /api/auth/session` succeeds and returns `sessionToken`.
  2. Verify in DEV D1 that a new row exists in `sessions` with `session_token_hash = sha256(sessionToken)` and `is_revoked = 0`.
  3. Protected endpoint (`GET /api/auth/session`, `GET /api/songbook/sync`) accepts the new `sessionToken`.
  4. Perform logout via UI or `POST /api/auth/logout`.
  5. Verify in DEV D1 that the session row is updated to `is_revoked = 1` and `revoked_at` is set.
  6. Subsequent access with the logged-out token is rejected with HTTP 401 (`Session has been revoked`).
  7. Multi-device check: An independently issued session on a second device remains valid after the first device logs out.

### Step 4: PROD Approval Gate & Migration
- Operator explicit authorization required before applying changes to PROD.
- Perform a D1 backup of PROD database:
  ```bash
  npx wrangler d1 export gtar-db-prod --output ./prod-backup-pre-g5.sql
  ```
- Apply Migration 0006 to PROD database:
  ```bash
  npx wrangler d1 migrations apply gtar-db-prod --remote
  ```
- Verify PROD schema via `PRAGMA table_info(sessions);`.

### Step 5: Production Deployment
- Deploy verified web build and Pages functions to production.
- Confirm live health and execute smoke tests in production.

## Legacy Session Compatibility Strategy
- Previously issued stateless tokens (without `sid`) are recognized as legacy tokens.
- **Bounded Transition Window**: Legacy tokens are accepted for a maximum of 7 days from their issue time (`iat`), provided they have not been revoked or superseded by account denial (`sessions_revoked_at`).
- **Revocation on Logout**: When a user logs out with a legacy token, its SHA-256 hash is registered in `sessions` with `is_revoked = 1`. Any copied legacy token presented after logout is rejected.
- **Controlled Reauthentication**: Users whose legacy sessions exceed 7 days simply re-authenticate via Google sign-in to receive a modern server-tracked session token.

## Rollback Behavior
- Because Migration 0006 is purely additive (new table `sessions`, nullable column `sessions_revoked_at`), rolling back server code to the previous release can be performed immediately without database schema rollback.
- Existing user accounts, songbooks, shared catalog entries, and shared setlists will remain intact during any rollback.
