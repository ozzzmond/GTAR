# D1 cleanup proposal (#453 O5, O6)

Status: PROPOSAL ONLY. Nothing here has been applied. No file was added under
`web/migrations`, and no wrangler, D1 or Cloudflare command was run.

Baseline: `dev` @ `f6ab460c171b1a0ca42f4f62d94b9c3448b66b8a`, migrations `0001` to `0010`.

Evidence method: for every table and index, a word-boundary search of `web/functions`,
`web/workers`, `web/src` and `web/scripts` (tests excluded), plus a read of every SQL
statement in `web/functions/lib/authCore.ts`, `web/functions/api/setlist/share.ts` and
`web/workers/stageCast2Backend.ts`.

Not verified: row counts and actual schema in the DEV and PROD databases (no D1 access in
this pass). Check both before any drop; see "Before applying".

## 1. Orphan tables (O5)

No reader and no writer in application code. Their endpoints and client were removed in
#413 / #423 (`web/docs/shared-catalog-v2.md` is already marked REMOVED).

| Table | Created in | Code references | Triggers on it | Risk if dropped |
| --- | --- | --- | --- | --- |
| `shared_catalog_revisions` | 0004 | none | none | Low. Data is unrecoverable without an export |
| `shared_catalog_songs` | 0004 | none | none | Low. Same |
| `catalog_setlist_revisions` | 0007 | none | `catalog_setlist_revision_no_update`, `_no_delete` | Low |
| `catalog_setlist_rates` | 0007 | none | none | Low |
| `catalog_moderation_actions` | 0010 | none | `catalog_moderation_guard`, `_apply`, `_no_update`, `_no_delete` | Low |
| `catalog_reports` | 0010 | none | `catalog_report_guard`, `_resolve`, `_no_delete` | Low |
| `catalog_setlist_mutations` | 0007 (column added in 0010) | none | `catalog_setlist_guard` (0008), `catalog_setlist_apply` (0010), `_no_update`, `_no_delete` | Low |
| `catalog_setlist_heads` | 0007 | none | `catalog_setlist_head_guard`, `_no_delete` | Low |
| `user_songbook_records` | 0009 | none | none | Medium: may hold per-record copies of user songbooks |
| `user_songbook_cursors` | 0009 | none | none | Low |
| `user_songbooks` | 0002 | `findUserSongbook`, `upsertUserSongbook` in `authCore.ts`, which no route imports (`/api/songbook/sync` answers 410 since #468); both helpers are removed by the dead-code PR for #453 | none | High: this is the only server copy of each account's songbook from the cloud sync era. Users who never restored it to a device lose it |

Tables that stay (live readers and writers): `users`, `sessions`, `shared_setlists`.

### Proposed order

Children before parents, because the foreign keys are `ON DELETE RESTRICT`:

1. `shared_catalog_revisions`, then `shared_catalog_songs`
2. `catalog_setlist_revisions`, `catalog_setlist_rates`
3. `catalog_moderation_actions`, then `catalog_reports`
4. `catalog_setlist_mutations`, then `catalog_setlist_heads`
5. `user_songbook_records`, `user_songbook_cursors`
6. `user_songbooks` (separate, later migration; see below)

Dropping a table drops its indexes and triggers. Per the SQLite documentation, the implicit
delete performed by `DROP TABLE` does not fire triggers, so the `*_no_delete` triggers do not
block the drop; foreign keys are still enforced, hence the order. This must be confirmed on a
local D1 copy before any remote run (NOT_VERIFIED here).

`user_songbooks` should not go in the same migration as the catalog tables. Recommendation:
keep it for at least one release after the sync retirement reaches PROD, export it first, and
drop it only on an explicit owner decision.

## 2. Redundant indexes (O6)

| Index | Table | Why redundant | Evidence | Risk |
| --- | --- | --- | --- | --- |
| `idx_users_google_sub` | `users` | `google_sub TEXT UNIQUE` already creates an index | `0001_users.sql:6`, `:17` | None for reads; one fewer index to maintain on insert |
| `idx_user_songbooks_user_id` | `user_songbooks` | `user_id` is the PRIMARY KEY | `0002_songbook_sync.sql:5`, `:13` | None. Moot if the table is dropped |
| `idx_sessions_token_hash` | `sessions` | `session_token_hash TEXT UNIQUE` already creates an index | `0006_session_revocation.sql:8`, `:17` | None |

Indexes with no query that can use them today. Listed for a decision, not recommended for
removal in the first step:

| Index | Table | Observation |
| --- | --- | --- |
| `idx_users_email` | `users` | No statement filters or orders by `email` |
| `idx_users_access_status` | `users` | Only `getPendingUsersCount` filters on it, and no route calls that function since #456 |
| `idx_sessions_is_revoked` | `sessions` | Revocation updates filter on `user_id` first (`idx_sessions_user_id`) |
| `idx_sessions_expires_at` | `sessions` | No statement filters on `expires_at`; would be needed by an expired-row purge (#453 O4) |
| `idx_shared_setlists_expires_at` | `shared_setlists` | Same; needed by a purge (#453 O3) |
| `idx_shared_setlists_creator`, `idx_shared_setlists_is_revoked` | `shared_setlists` | Every statement selects by `share_token` (primary key) |

## 3. Rollback

- Indexes: recreate with the original `CREATE INDEX IF NOT EXISTS` statement from the
  migration listed above. No data is involved.
- Tables: forward-only. A dropped table can be recreated empty from its original migration
  SQL, but its rows cannot. The only data rollback is a D1 export taken before the drop
  (or D1 Time Travel within its retention window; availability on these databases is
  NOT_VERIFIED).
- Code: no application rollback is needed, because no code reads these objects. An older
  build that still called `/api/songbook/sync` gets 410 already.

## 4. Release impact

- The PROD controller (`.github/prod_controller.cjs`, `d1Readiness`) compares the migration
  files at the checkpoint SHA with the `d1_migrations` ledger and holds the release while any
  migration is pending. A new file under `web/migrations` therefore blocks every PROD
  promotion until the owner has applied it to PROD. It must not be merged in a week where
  the migration is not meant to run.
- Tests read the existing migration files (`dev8bLocalCloudSync`, `g3QrSharingRevocation`,
  `g5SessionRevocationSecurity`). Files `0001` to `0010` must stay unchanged; cleanup goes in
  a new numbered migration.

## 5. Before applying (owner)

1. Decide scope: catalog tables only, indexes only, or both; `user_songbooks` separately.
2. On DEV and PROD: record row counts for every table in section 1 and export the ones that
   are not empty.
3. Rehearse the migration on a local D1 copy, including the drop order.
4. Apply to DEV, run the app against it, then schedule PROD with the release.

Suggested split, lowest risk first:

- Step A: drop the three redundant indexes in section 2.
- Step B: drop the ten catalog and per-record tables (items 1 to 5).
- Step C: drop `user_songbooks` after the retention decision.
