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
- **Schema capability detection (fail closed).** `functions/lib/catalogSchema.ts` compares every protection trigger on the catalog tables, plus the one-open-report index, with reviewed migration definitions.
  - Comparison uses a normalized SHA-256, so case, whitespace and comments outside string literals don't matter.
  - It also probes the required columns.
  - A missing, unknown or weakened definition advertises no capability and accepts no mutation: setlists return 503, reports and moderation return 501.
  - `tests/sharedCatalogV2Remediation.test.cjs` checks that the fingerprints match the migrations.
- **Atomic moderation.** `POST /api/admin/catalog-reports/:id` takes `{ action: dismiss | remove | close_removed, expected_revision?, note? }` plus an `Idempotency-Key`.
  - The request is one `INSERT` into the append-only `catalog_moderation_actions` ledger.
  - In that same statement, its triggers check the open report and the active admin, remove the content with revision CAS, and resolve the report. `remove` and `close_removed` resolve every open report for the target.
  - Reports can only be resolved through a ledger row.
  - Concurrent moderators produce exactly one outcome, and exact retries replay it.
- **Admin edit UI.** "Edit" on another publisher's catalog setlist card loads the exact revision, then lets the admin review and save one new revision.
  - The save is a client-snapshot `PUT` with `expected_revision`.
  - A 409 is shown as a stale edit, and an ambiguous failure retries with the same key.
- **Duplicate advisory.** When publishing a song, matches against the cached catalog by `normalizeChartBody` or `lyricsSignature` are shown with "Open existing" or "Publish anyway". Nothing is merged or blocked.

## Client request durability

A pending client-snapshot request keeps its exact snapshot in `gtar_setlist_publication_snapshot_v1:<account>:<source>:<intent key>`, keyed by the immutable intent so concurrent tabs never overwrite each other. Snapshots no pending request references are pruned under the journal lock.

- The compact journal references it by digest, so retries resend the identical body.
- The snapshot is removed once the request settles.
- Missing or altered snapshot content is refused before any request is sent.

## Rollback (forward-only)

If needed, `0011` drops `catalog_setlist_apply` and re-creates it with the exact 0007 text.

- `source_kind` remains, all existing rows stay valid, and every new write returns to legacy validation.
- `catalog_reports` and `catalog_moderation_actions` remain as retained, unused history.
- No row is deleted or rewritten.
- The server detects the capability from the verified schema, so client snapshots and admin cross-edits switch off automatically: 501 or 409 under `phase-a-v1`, and 503 on every route under `catalog-v2`.

## Later approval gates (not part of this PR)

- PROD rehearsal on a private export.
- D1 Time Travel bookmark before applying.
- Remote DEV, then PROD, migration by the owner.
- Owner decision on the report reasons (`copyright`, `wrong_content`, `spam_abuse`, `other`) and the rate limits.

## Shared setlists activation (owner-approved policy, PROD still HOLD)

Owner approved on 2026-10-28:
- report reasons: `copyright`, `wrong_content`, `spam_abuse`, `other`;
- report rate limit: 10 per hour and 30 per day;
- publish rights: active members and admins;
- shared setlists: enable in PROD after the release gates;
- rollout order: DEV migration and targeted QA first.

Server flag `SHARED_SETLISTS_ENABLED` accepts exact values only:
- `phase-a-v1`: DEV Preview, unchanged. Works on a legacy or Catalog V2 schema.
- `catalog-v2`: the production activation value.
  - Every route serves only when the complete, verified 0010 schema is present. That means:
    - every protection trigger;
    - the reporting and moderation triggers;
    - the exact post-0010 table and index definitions, covering CHECK constraints and columns;
    - the 0008 guard and the 0009 tables as prerequisites.
  - On a legacy, partial or unknown schema, every route returns 503, no capability is advertised and nothing is written.
  - Once 0010 is present, older clients' legacy bodies are still accepted.
- Unset or any other value: every route returns 404 before any database access. This is the current production state, and `tests/sharedSetlistCatalog.test.cjs` asserts it.

The approved release is the only change that sets `env.production.vars.SHARED_SETLISTS_ENABLED = "catalog-v2"`, and it updates that assertion in the same change. A permanent test forbids any other production value.

### DEV operator steps (owner; remote DEV D1 is not run by agents)

1. From `web/` on current `dev`, run `DRY_RUN=1 npm run d1:migrate:dev:remote`. The guard must print target `gtar-db-dev (455b9901-…)`, env `preview`. **Abort** if any other target is shown.
2. Run `npx wrangler d1 migrations list gtar-db-dev --remote --env preview --config wrangler.jsonc`. **Expected:** only `0010_catalog_v2.sql` is pending. **Abort** if anything else is pending or 0010 is already listed as applied.
3. Run `npx wrangler d1 time-travel info gtar-db-dev --env preview --config wrangler.jsonc` and record the bookmark.
4. Run `npm run d1:migrate:dev:remote` (applies only to `gtar-db-dev`).
5. Read-only verification:
   - `d1_migrations` top is `0010_catalog_v2.sql`.
   - `SELECT count(*) FROM catalog_setlist_mutations WHERE source_kind <> 'songbook'` returns 0.
   - Counts of the `catalog_setlist_*` tables, `shared_catalog_songs` and `users` are unchanged.
   - On the DEV preview, `GET /api/catalog/setlists?limit=1` returns `capabilities.client_snapshots: true`.
   - **Abort/rollback** on 503, `client_snapshots: false`, or any count change.
6. Targeted DEV QA (no 10k repeat):
   - an iPhone with B2 on publishes a device setlist without Cloud Sync;
   - an admin edits another publisher's setlist, and a stale edit returns 409;
   - a member reports a song and a setlist; a second open report gets 409;
   - an admin dismisses one report and removes another target;
   - the duplicate advisory appears when publishing a duplicate song;
   - an older client's legacy publish still works.

**Rollback (default: forward-only, non-destructive).** `0011` re-creates the exact 0007 `catalog_setlist_apply`. That puts the schema in legacy mode: `catalog-v2` returns 503 on every route, and `phase-a-v1` uses the legacy path. Never drop tables or delete rows.

**Time Travel is not a catalog-only undo.** Restoring a D1 database to a bookmark rewinds the **whole database**. Every write after the bookmark is discarded: accounts and approvals, sessions and revocations, personal songbooks (`user_songbooks`, `user_songbook_records`), shared songs and setlists, reports, and anything else.
- Use a restore only if one of these is true:
  - (a) database-wide write quiescence since the bookmark has been verified. This means no writes to any table, for example by comparing the database's current Time Travel bookmark or per-table row counts and max timestamps with the step 3 record, with the app in maintenance or read-only for the whole window.
  - (b) the owner has explicitly approved a reconciliation and recovery procedure, already tested on a disposable copy, that re-applies every intervening write.
- Otherwise, roll back forward-only.
- No destructive remote operation is part of this runbook.

### PROD (later, separate approval)

The same steps apply against a private export rehearsal first: `wrangler d1 export gtar-db-prod --remote` to a private file, import into a disposable database, apply 0010, then verify. After that:
- PROD preflight, read-only: `migrations list` shows only 0010 pending, and the existing `catalog_setlist_*` trigger text matches the 0007/0008 fingerprints in `functions/lib/catalogSchema.ts`.
- Time Travel bookmark.
- Apply 0010.
- Deploy the release that sets `catalog-v2` (#234 flow).

**Order:** migrate first, then deploy.
- If a release that sets `catalog-v2` is deployed before the complete 0010 schema is present, every shared-setlist route returns **503** (fail closed: no capability, no writes). The Report and moderation endpoints return **501**.
- If the deploy goes first without the flag (production still unset), shared setlists stay 404. Report and moderation return 501 until 0010 is applied.
