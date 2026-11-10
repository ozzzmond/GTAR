# QR / Setlist Sharing Lifecycle and Cleanup Specification

## Anonymous snapshots (#433)

New shares from the Share Setlist dialog need no account. They reuse the existing
`DB` D1 binding and `shared_setlists` table (migrations 0003/0005); no KV, R2,
new service, migration, or deployment configuration is introduced.

- POST without Authorization publishes only the sanitized, self-contained snapshot
  submitted by the sender. The server adds `shareAccess: anonymous-v1` to stored
  JSON and stores a null creator. Caller-supplied access markers are discarded.
- A random 256-bit revoke capability is returned only to the sender's open modal.
  Its SHA-256 digest is the 64-hex read token. QR and `?share=` URLs carry only
  that read token. Anyone holding it can preview/import this explicit snapshot;
  reading never queries the sender's private library. No directory/list API exists.
- Anonymous GET requires both the 64-hex token and the stored access marker with
  no creator. All historical/account shares retain their existing authorization.
  Anonymous revoke requires the separate capability whose digest matches the token;
  knowing the read URL alone cannot revoke. Existing account/admin revoke stays intact.
- New anonymous shares expire after 3 days. Existing snapshots keep their stored expiry. Revoke is available while the sender's modal remains
  open; closing loses the revoke capability. No capability is put in recipient URLs
  or saved in localStorage. Sharing again creates a separate immutable snapshot.
- Creation/revocation are limited to 30/minute and reads to 120/minute globally
  per isolate, plus distinct global anonymous policies in the existing optional
  distributed limiter. The fallback is not a globally durable quota. Missing or
  invalid configured abuse protection fails closed; no new namespace is provisioned.
- The existing 1 MB API limit and 100-song/50,000-character per-chart contract apply.
  The modal rejects oversize sets and missing/trashed song references before upload,
  keeping Export JSON available. QR size stays bounded by the URL, not song content.
- Cross-device retrieval needs internet and the same application's D1 backend.
  Service/network failures leave Export JSON usable; failed incoming URLs remain
  available for reload. Previewing alone does not write the recipient's library;
  Import/Stage remains an explicit action.

Owner preview QA: signed out, share from All Setlists and Setlist Detail, scan QR
and open copied URL in another browser/device; verify preview, Import/Stage,
Export JSON, revoke, expiry/error feedback, and unchanged sender data. Installed
PWA/mobile camera and clipboard behavior still require owner device QA.

The account-bound lifecycle below continues to describe historical shares.


## Overview
This document specifies the server-authoritative lifecycle, revocation semantics, entropy guarantees, and operator-controlled data cleanup procedure for GTAR QR and link-shared setlists.

## Lifecycle States and Invariants

1. **Creation and Entropy Guarantee**:
   - Every newly created shared setlist snapshot is cryptographically bound to the authenticated creator's authoritative user ID (`users.id`).
   - Share tokens provide at least 128 bits of cryptographic entropy (`Uint8Array(16)` encoded as 32 lowercase hexadecimal characters).
   - Collision rejection is enforced at the database level (`share_token PRIMARY KEY`) with bounded retries before failing safely. Existing records are never overwritten.
   - Initial TTL is set to 30 days (`expires_at`), matching the standard expiration window.

2. **Revocation**:
   - The creator (verified owner) or an active administrator may revoke a share at any time via `POST /api/setlist/revoke` or `DELETE /api/setlist/share`.
   - Revocation is persistent in Cloudflare D1 SQLite (`is_revoked = 1`, `revoked_at = <ISO8601>`, `revoked_by_user_id = <users.id>`).
   - Revocation is strictly idempotent: repeatedly revoking an already-revoked share returns HTTP 200 without duplicate mutations.
   - Non-owners and unauthorized users are denied revocation with HTTP 403 (`FORBIDDEN_NOT_SHARE_OWNER`).

3. **Inaccessibility of Revoked and Expired Snapshots**:
   - Revoked shares immediately become inaccessible through normal share endpoints (`GET /api/setlist/share`), returning HTTP 410 (`SHARED_SETLIST_REVOKED`).
   - Expired shares (`expires_at < NOW`) return HTTP 410 (`SHARED_SETLIST_EXPIRED`).
   - Creator access denial (`users.access_status = 'denied'`) automatically invalidates previously issued shares, returning HTTP 403 (`CREATOR_ACCESS_DENIED`).

4. **Legacy Compatibility**:
   - Historical records created prior to Migration 0005 have `creator_user_id = NULL` and `is_revoked = 0`.
   - Legacy snapshots remain readable by active authenticated members until their `expires_at` timestamp.
   - Unrelated regular members cannot revoke ownerless legacy records (HTTP 403). Only administrators may revoke legacy records.

## Operator-Controlled Cleanup Procedure

In accordance with GTAR safety policies, no automated background row deletion or unapproved Cloudflare scheduled triggers are introduced. Expired and revoked records remain in D1 until an authorized operator runs the verified maintenance procedure.

### Safety and Retention Principles
- **Grace Period**: Purging should retain records for at least 30 days post-expiration or post-revocation for auditing, forensic review, and dispute resolution.
- **Backup Before Purge**: Operators must verify a fresh D1 database export/backup before executing any purge operation.
- **Dry-Run Validation**: Operators must verify candidate row counts using `SELECT count(*)` before issuing deletions.

### Operator SQL Commands

#### 1. Dry Run / Inspection
```sql
-- Count expired or revoked shares older than retention cutoff (e.g. 30 days past expiry/revocation)
SELECT count(*) AS purge_candidate_count
FROM shared_setlists
WHERE (
  (expires_at < datetime('now', '-30 days'))
  OR (is_revoked = 1 AND revoked_at < datetime('now', '-30 days'))
);
```

#### 2. Targeted Purge
```sql
-- Purge records that expired or were revoked beyond the retention threshold
DELETE FROM shared_setlists
WHERE (
  (expires_at < datetime('now', '-30 days'))
  OR (is_revoked = 1 AND revoked_at < datetime('now', '-30 days'))
);
```

#### 3. Verification
```sql
-- Verify no anomalous records remain
SELECT count(*) FROM shared_setlists WHERE expires_at < datetime('now', '-30 days');
```
