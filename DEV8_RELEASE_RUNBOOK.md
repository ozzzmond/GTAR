# GTAR DEV-8 Production Readiness & Rollback Runbook

> **IMPORTANT**: This runbook documents release readiness and procedures for DEV-8. **THIS TASK DOES NOT DEPLOY TO PRODUCTION.** Production deployment is guarded by `GTAR_DEPLOYMENT_PROTOCOL.md` and requires explicit operator authorization.

---

## 1. Scope & Baseline
- **Target Iteration**: GTAR 108-dev.8 checkpoint (target release: v1.1.108 on Saturday 2026-10-03).
- **Hardened Subsystems**:
  - Account Access Lifecycle & D1 Authoritative Session Validation
  - Server-Authoritative Cloud Songbook Sync (D1 SQLite + Cloudflare Pages Functions)
  - Cloud Setlist Sync & Referential UUID Binding
  - Fail-safe Multi-user Device Isolation & Non-destructive Conflict Preservation
  - Tombstone & Dual Deletion Reconciliation (Zero resurrection, zero silent loss)

---

## 2. Pre-Promotion Verification Checks
Before any version bump, staging, or promotion, the operator must execute local verification:

```bash
# 1. Targeted DEV-8 tests (73 tests covering auth, data integrity, setlist & songbook sync)
npm --prefix web test tests/prodReadinessDev8.test.cjs tests/accountAccessFoundation.test.cjs tests/cloudSongbookSync.test.cjs tests/cloudSetlistSync.test.cjs tests/durableAuthSession.test.cjs tests/songbookDataFoundation.test.cjs

# 2. Full web test suite (316 tests)
npm --prefix web test

# 3. Synchronous sync/auth linter (0 warnings permitted)
npm --prefix web run lint:sync

# 4. Web production build (TypeScript strict check + Vite bundle)
npm --prefix web run build

# 5. Core Python test suite (25 tests covering deployment/push scripts)
python -m unittest discover tests
```

All 5 commands must return exit code 0 before proceeding.

---

## 3. Deployment Prerequisites
1. **Clean Git Tree**: No unstaged mutations outside tracked release boundaries.
2. **D1 Migration Applied**: Confirm Cloudflare D1 migration `0002_songbook_sync.sql` has been executed on target database (`gtar-db-prod`).
3. **Environment Secrets**:
   - `AUTH_SECRET`: Cloudflare Worker secret configured for HMAC-SHA256 session token generation and verification.
   - `GOOGLE_CLIENT_ID`: Matching Google OAuth Client ID for identity verification.
   - `ROOT_ADMIN_EMAIL`: Designated administrator email (`jlopez3rd@gmail.com`).
4. **Cloudflare Compatibility Date**: Configured as `>= 2024-09-23` with `nodejs_compat` flag enabled in `wrangler.jsonc`.

---

## 4. Post-Deploy PROD Smoke Checks
Immediately after deployment to Cloudflare Pages production, execute the following smoke verification:

1. **Clean Browser PWA Load**:
   - Open production URL in a clean incognito window.
   - Confirm application loads without fatal JavaScript errors or blank screens.
   - Verify sample songs ("Stand By Me", "Ang Huling El Bimbo", "Hotel California") initialize with valid RFC4122 v4 UUIDs.
2. **Account Sign-In & D1 Auth**:
   - Sign in via Google OAuth.
   - For approved administrator/member, verify immediate unlock and green status indicator.
   - For pending user, verify "Pending Approval" badge and access block without library wipe.
3. **First Cloud Songbook & Setlist Sync**:
   - Open Cloud Songbook Sync modal from Header menu.
   - Trigger Initial Sync: verify status transitions to `IN_SYNC` (`actionTaken: UPLOADED` or `DOWNLOADED`).
   - Create a test setlist, trigger sync: confirm setlist uploads and checksum updates deterministically.
4. **Offline Resilience & Continuity**:
   - Disconnect network (airplane mode or DevTools Offline).
   - Reload app: verify 30-day cached session remains unlocked, library and setlists load from IndexedDB/localStorage.
   - Modify a song chord or title while offline.
   - Reconnect network: trigger Cloud Sync, verify local changes upload safely to cloud without conflict.
5. **Numbers & Transpose Invariance**:
   - Select song, open Stage View.
   - Switch to Nashville Numbers notation: verify Roman/Arabic numeral presentation without mutating chord source.
   - Transpose key by +2 semitones: verify chords transpose accurately while Nashville numerals remain invariant.

---

## 5. Rollback Trigger & Procedure

### Rollback Triggers
Initiate immediate rollback if any of the following occur on production:
- Persistent 500 errors on `/api/songbook/sync` or `/api/auth/*`.
- Client report of local library data wipe or silent deletion.
- Loopback bypass or admin privileges leaking to unapproved accounts.
- PWA service worker failure causing offline launch failure for active stage musicians.

### Rollback Procedure
1. **Cloudflare Pages Instant Rollback**:
   - Navigate to Cloudflare Dashboard -> **Workers & Pages** -> `gtar` -> **Deployments**.
   - Locate the previous known-good deployment (e.g., commit `eafdc27` / baseline checkpoint).
   - Click **Manage deployment** -> **Rollback to this deployment**.
   - Confirmation is instant (propagates globally within < 30 seconds).
2. **Database State Safety**:
   - D1 SQLite schema `user_songbooks` uses additive versioning (`version = version + 1`).
   - Cloudflare D1 records preserve previous versions; rollbacks do NOT drop tables or columns.
   - Client devices retain safety snapshots under `gtar_sync_recovery:<timestamp>` before any cloud download or merge overwrite.
3. **Local Storage Recovery**:
   - If an unexpected payload was downloaded before rollback, the user can restore their pre-sync library from `localStorage.getItem('gtar_sync_recovery:<timestamp>')` or via the Storage Recovery banner.

---

## 6. Data Safety Considerations
- **No Silent Loss Rule**: Remote deletions never wipe divergent local edits without creating non-destructive conflict copies (`"${title} (Cloud Copy)"`).
- **Fail-Closed on Auth Errors**: HTTP 401 or 403 responses return status `ERROR` with `actionTaken: NONE`. Local user data is NEVER overwritten, cleared, or reset on authentication failure.
- **Multi-Device Idempotency**: Repeated or replayed sync calls produce identical checksums and NOOP decisions (`SAME_STATE`).
- **Referential Integrity Validation**: Any incoming cloud payload is checked by `validateSongbookIntegrity()` before applying to device storage; malformed payloads are rejected cleanly with zero local mutation.
