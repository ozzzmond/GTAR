# Deployment Handoff: G3 QR Sharing Revocation & Lifecycle Hardening

## Overview
This document specifies the deployment ordering, database schema dependencies, verification procedures, and rollback considerations for Batch 3 G3 (`g3-qr-sharing-revocation`).

**IMPORTANT DEPLOYMENT GATE**:
The migration (`0005_shared_setlists_revocation.sql`) and server functions (`web/functions/api/setlist/share.ts`, `web/functions/api/setlist/revoke.ts`) are schema-dependent. Server functions require the migration columns (`creator_user_id`, `is_revoked`, `revoked_at`, `revoked_by_user_id`) to record ownership and revocation status.
Do not deploy schema-dependent functions before the required migration has been explicitly reviewed, approved, and applied to the target database.

## Migration Specification
- **File**: `web/migrations/0005_shared_setlists_revocation.sql`
- **Type**: Strictly additive (`ALTER TABLE shared_setlists ADD COLUMN ...`, `CREATE INDEX IF NOT EXISTS ...`)
- **Non-Destructive**: Does NOT drop tables, does NOT alter existing primary keys or legacy row data, does NOT overwrite tokens.
- **Legacy Records**: Existing records will retain `creator_user_id = NULL` and `is_revoked = 0`.

## Deployment Order

### Step 1: Pre-Deployment Review
- Verify PR approval on GitHub targeting `dev`.
- Verify CI check suite passing on branch `g3-qr-sharing-revocation`.

### Step 2: Apply Migration to DEV Environment
- Run the remote migration runner targeting preview/dev database:
  ```bash
  cd web
  npm run migrate:dev:remote
  ```
- Verify DEV schema:
  ```bash
  npx wrangler d1 execute gtar-db-dev --command "PRAGMA table_info(shared_setlists);"
  ```
  Expected new columns:
  - `creator_user_id` (TEXT)
  - `is_revoked` (INTEGER, DEFAULT 0)
  - `revoked_at` (TEXT)
  - `revoked_by_user_id` (TEXT)

### Step 3: Deploy DEV Cloudflare Pages Functions
- Merge PR to `dev` or allow Cloudflare Pages branch preview build to deploy.
- Smoke test share creation, 128-bit token generation, and revocation in the preview deployment.

### Step 4: Apply Migration to PROD Database
- Upon approval of staging/preview verification:
  ```bash
  npx wrangler d1 migrations apply gtar-db-prod --remote
  ```
- Verify PROD table info:
  ```bash
  npx wrangler d1 execute gtar-db-prod --command "PRAGMA table_info(shared_setlists);"
  ```

### Step 5: Production Deployment
- Deploy web build and Pages functions to production.

## Verification Checklist
1. Share creation succeeds and issues a 32-character hexadecimal token (128 bits entropy).
2. Share row in D1 has `creator_user_id` matching the authenticated user.
3. Owner revocation via UI or `POST /api/setlist/revoke` marks `is_revoked = 1`.
4. Fetching a revoked link returns HTTP 410 (`SHARED_SETLIST_REVOKED`).
5. Legacy links with `creator_user_id = NULL` remain readable until expiration.

## Rollback Plan
- Because Migration 0005 is purely additive (new columns with default values and nullable references), rolling back server code to the previous release (Dev 8 / PR #71 baseline) can be performed immediately without database schema rollback.
- If necessary to reverse the migration, note that SQLite does not support `ALTER TABLE DROP COLUMN` on indexed or referenced columns in older runtimes; however, retaining the unused columns causes no operational degradation.
