# Shared Catalog V2 (#253)

Status: DEV PR only. Migration `0010_catalog_v2.sql` is prepared for review and is not applied to any remote D1.

## What changes

- **Client snapshot publishing.** `POST/PUT /api/catalog/setlists[/:id]` accept `{ snapshot_version: 1, snapshot, publication_key | expected_revision }`.
  - The server validates the snapshot with `validateSnapshot`/`SETLIST_LIMITS` (100 entries, 256 KB, 100 KB per chart).
  - It stores the snapshot in a canonical field order with `source_kind = 'client'`, `source_version = 1` and `source_checksum = sha256(snapshot_json)`.
  - No personal cloud `user_songbooks` record is needed, so publishing works with B2 on.
  - Only bodies that carry `snapshot` may exceed 4 KB, and they are capped at 260 KB. Legacy bodies keep the 4 KB cap.
  - Errors: 400 for contract errors, 413 for oversized bodies or snapshots, 422 for invalid snapshot content. Nothing is written on any of these.
- **Legacy path unchanged.** Old clients still send `source_setlist_id` and `source_version`.
  - Their rows default to `source_kind = 'songbook'` and keep the exact `user_songbooks` version and checksum check.
  - Their idempotency digests are unchanged.
  - `GET /api/catalog/setlists` adds `capabilities.client_snapshots`. Old clients ignore it.
  - New clients use the legacy flow when the capability is absent, including the B2 refusal.
- **Admin moderation of setlists.**
  - Active admins may update (client snapshot) or unpublish any setlist.
  - `publisher_user_id` is immutable, and `editor_user_id` / `deleted_by_user_id` record the actor.
  - Members editing another publisher's setlist still get the original non-disclosing 409. SQL raises `SETLIST_FORBIDDEN` if the server check is bypassed.
- **Reactive reports.** `catalog_reports` covers song and setlist targets. It records target, revision, reporter, reason, note, status, resolver and timestamps.
  - Each user can have one open report per target.
  - Each reporter is limited to 10 reports per hour and 30 per day, enforced in SQL.
  - There is no auto-hide and no approval queue.
  - Reports cannot be deleted, and an active admin resolves each one once.
  - Routes: `POST /api/catalog/reports`, `GET /api/admin/catalog-reports`, `POST /api/admin/catalog-reports/:id`.
  - The admin queue is under User Management → Content reports.
- **Duplicate advisory.** When publishing a song, matches against the cached catalog by `normalizeChartBody` or `lyricsSignature` are shown with "Open existing" or "Publish anyway". Nothing is merged or blocked.

## Client request durability

A pending client-snapshot request keeps its exact snapshot in `gtar_setlist_publication_snapshot_v1:<account>:<source>`.

- The compact journal references it by digest, so retries resend the identical body.
- The snapshot is removed once the request settles.
- Missing or altered snapshot content is refused before any request is sent.

## Rollback (forward-only)

If needed, `0011` drops `catalog_setlist_apply` and re-creates it with the exact 0007 text.

- `source_kind` remains, all existing rows stay valid, and every new write returns to legacy validation.
- `catalog_reports` remains as retained, unused history.
- No row is deleted or rewritten.
- The server detects the capability from the trigger text, so client snapshots and admin cross-edits switch off automatically (501 or 409).

## Later approval gates (not part of this PR)

- PROD rehearsal on a private export.
- D1 Time Travel bookmark before applying.
- Remote DEV, then PROD, migration by the owner.
- Owner decision on the report reasons (`copyright`, `wrong_content`, `spam_abuse`, `other`) and the rate limits.
