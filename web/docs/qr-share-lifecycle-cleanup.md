# QR / Setlist Sharing Lifecycle and Cleanup Specification

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
