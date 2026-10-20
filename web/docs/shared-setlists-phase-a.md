# Shared Cloud Setlists Phase A (#108)

Baseline: GitHub `dev` at `9eafb6c8b06ddc34458b0dd2f487c45dba3f1160`.
Issue #108's 2026-10-20 owner correction supersedes its historical central-catalog
proposal. This implementation uses only the request environment's existing `DB`.
No Worker, binding, synchronization, account migration or shared DEV/PROD identity
is introduced. Live schema contents/bindings were not inspected or mutated.
The repository migration sequence ends at 0006; 0007 is additive.

## Activation and operator handoff

`SHARED_SETLISTS_ENABLED` must equal the exact server value `phase-a-v1`.
Missing, false-like or any other value returns 404 before auth, body parsing or
database access, for every method on both new routes. It is absent from all
committed deployment configurations. Building/releasing the code does not enable
the feature. No frontend flag can enable it.

Migration and activation require separate operator authorization. Review and apply
`0007_shared_catalog_setlists.sql` to an isolated DEV D1 first, verify ledger/schema
and local contract compatibility, then separately review any runtime activation.
No migration is applied automatically by these routes. PROD remains HOLD; a later
PROD schema/activation decision must independently verify PROD readiness under the
release workflow. Disabling the runtime flag hides reads and writes without
deleting history. Do not remove tables/triggers to roll back activation.

The new API fails 503 if required protection triggers or rate tables are missing.
There is no optional/in-memory limiter fallback and no disable-quota setting.
Schema objects must remain the reviewed migration bytes; privileged schema edits
are outside the API threat boundary. No live binding or gate was configured here.

## Schema

All objects are prefixed `catalog_setlist_`; existing QR `shared_setlists`, song
catalog, users, sessions and personal songbook tables are unchanged.

| Object | Contract |
| --- | --- |
| heads | Public random UUID, restricted publisher FK, unique `(publisher_user_id, publication_key)`, current revision and internally attributed tombstone |
| mutations | Permanent unique `(editor_user_id, idempotency_key)`, SHA-256 canonical request digest, operation, publication ID/key, expected revision, private source version/checksum, snapshot JSON and UTF-8 byte count, server timestamp |
| revisions | Unique `(setlist_id, revision)`, unique restricted FK to immutable mutation; snapshot is stored only once in that mutation |
| rates | At most two fixed rows per caller, read/write minute/day counters; server time determines fixed windows |

Revisions and mutation records cannot be updated/deleted. Heads cannot be deleted,
reowned, rekeyed, or updated after tombstoning. All foreign keys restrict deletion
of referenced accounts/history. Unpublish appends a numbered tombstone revision;
prior content remains retained but all public revision reads become unavailable.

A single mutation INSERT owns all guards and dependent writes through triggers:
active admin, source version/checksum, owner, publication key, expected revision,
tombstone, retained quotas, head mutation and numbered revision append. SQL
`RAISE(ABORT)` rolls back the INSERT and all trigger effects. Concurrent mutations
cannot both pass the head's expected revision. The trigger explicitly rejects an
absent conditional-update target rather than treating a zero-row write as success.

[D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
guarantees rollback on statement errors, but a zero-row UPDATE is not an error.
These endpoints therefore use one guarded INSERT, with no dependency on optional
`DB.batch`, client transactions or a read-then-write CAS. Local D1 tests exercise
this distinction and actual trigger rollback. Rates intentionally persist even
when the later publication statement fails.

## API contracts

All enabled routes use existing server-verified bearer authentication and active
account checks. Publishing also requires active admin status and original publisher
ownership (another admin cannot edit someone else's publication). Session role
claims cannot override current D1 account state. Requests are same-origin; no new
cross-origin write/preflight contract is provided.

| Method/path | Request | Successful response |
| --- | --- | --- |
| GET `/api/catalog/setlists` | Optional `limit` 1..50 (default 25), `offset` 0..9999999 (default 0) | `{setlists:[{id,revision,name,occurrences,updated_at}]}` sorted by ID, active heads only |
| GET `/api/catalog/setlists/:id?revision=N` | Exact positive integer revision required | `{id,revision,snapshot}`; no implicit latest fallback |
| POST `/api/catalog/setlists` | `{snapshot_version:1,publication_key,source_setlist_id,source_version}` | `{id,revision:1,unpublished:false}` |
| PUT `/api/catalog/setlists/:id` | `{snapshot_version:1,expected_revision,source_setlist_id,source_version}` | `{id,revision:expected_revision+1,unpublished:false}` |
| DELETE `/api/catalog/setlists/:id` | JSON `{expected_revision}` | `{id,revision:expected_revision+1,unpublished:true}` |

Mutation requests require `Idempotency-Key`; keys and publication keys must match
`[A-Za-z0-9_-]{16,128}`. IDs use that syntax too. Unknown JSON fields, publisher IDs,
client snapshots/attribution and missing contract versions are rejected. Body
stream limit is 4096 UTF-8 bytes, independent of misleading Content-Length.
Source IDs are bounded string/safe-integer personal IDs and never enter responses.

All durable successes, including initial creates, return 200. Other statuses:
400 invalid contract; 401 invalid/expired session; 403 inactive/unauthorized account;
404 disabled/not found/exact revision absent; 405 unsupported method; 409 source,
ownership, expected-revision, stable-publication-key or idempotency conflict;
410 retry of a previously successful content mutation after unpublish;
413 oversized request; 422 invalid/unresolved source; 429 quota/rate limit;
503 storage/protection failure. Error bodies contain no database internals.

Idempotency is permanent, account-scoped and digest-bound to the operation, public
target, expected revision and exact source request. Identical concurrent requests
with one key produce one logical result. The INSERT conflict path is followed by
an authoritative ledger lookup and digest check, never inferred from a success
flag or change count. A successful timeout retry uses the saved result even if the
personal source has subsequently changed. It cannot resurrect a tombstone.
An unpublish retry returns its original durable tombstone result. A new key for an
existing stable publication key returns conflict, including after unpublish.
Failed publication statements retain no idempotency record or orphan revisions.

## Snapshot version 1

Public shape: `{version:1,name,entries:[songSnapshot,...]}`. Array position is the
occurrence order; repeats remain repeated full snapshots. The server loads only
the caller's `user_songbooks` row at the requested exact version and resolves the
selected setlist there. A transactional version/checksum recheck prevents a source
change between resolution and persistence. No caller-provided song content is
trusted or used. A missing/unuploaded personal library must first be synced.

Allowed song fields: `title`, `artist`, `rawContent`, `format`, `key`, `originalKey`,
`confirmedChartKey`, `capo`, `transposeOffset`, `bpm`, `time`, `year`. Only actually
present fields are copied; missing values are never inferred. Exact raw chart
content, section/arrangement directives and key fields are preserved without
transposition or key inference. Formats: `CHORD_PRO`, `TWO_LINE`, `PLAIN` (the
verified personal model supports all three, unlike the existing Shared Songs API).
Supported key values retain existing authored/confirmed semantics as stored.

Reference IDs are authoritative, including numeric/string equivalent IDs; duplicate
matches are ambiguous. Legacy references without IDs must match exactly one title
and optional artist, case-insensitively after trimming. Deleted/missing songs,
deleted setlists, ambiguous references, unsupported formats and unknown occurrence
override fields reject the entire publication. No entries are dropped/replaced.
No songs are automatically published to Shared Songs. Personal IDs, tags, favorites,
timestamps, account identities, lineage, sync and backup metadata are excluded.
Publisher/editor IDs are restricted internal FKs, absent from public payloads.

## Initial fixed limits

The approved directive supplied no numeric limit artifact in this repository or
Issue #108. These conservative Phase A defaults are explicit reviewable choices;
there is no claim they reproduce unavailable earlier findings.

| Limit | Initial value/rationale |
| --- | --- |
| Snapshot | 256 KiB UTF-8; compatible scale with existing catalog request bound |
| Occurrences | 1..100; enough for church setlists while bounding fan-out |
| Raw chart | 100 KiB UTF-8 per occurrence; existing catalog chart scale |
| Name/title/artist | 200 characters; other optional strings 50 |
| Stored transpose | Integer -48..48; preserve stored offset without modulo conversion; reject outliers |
| Publication heads | 100 per publisher, 1000 per environment, including tombstones |
| Content revisions | At most 100 per publication; final tombstone may be revision 101 |
| Retained snapshot storage | 16 MiB per publisher, 256 MiB per environment |
| Permanent mutation keys | 10000 per publisher, 100000 per environment for content writes |
| Read attempts | 120/minute, 10000/day per active account |
| Mutation attempts | 30/minute, 200/day per active admin, including retries and invalid bodies |

Counters survive handler restarts and never expire keys or refund deleted storage.
Snapshot bytes are counted once via immutable mutations. Unpublish is exempt from
content/storage/revision/key quotas so reaching a content cap cannot trap active
content; auth, ownership, CAS and write-attempt rates still apply. Global retention
is bounded by head/revision/key limits plus at most one tombstone per head.
Fixed windows permit boundary bursts; this is intentionally not a token-bucket
promise. Unauthenticated requests are rejected by existing auth; this new durable
limiter governs authenticated catalog attempts, not network-layer DDoS protection.

## Verification and deferred work

`sharedSetlistCatalog.test.cjs` is registered in the security/API test catalog.
It exercises all migrations against disposable SQLite and an actual local D1
binding, snapshot formats/key semantics/repeats/privacy, authorization, concurrency,
idempotency, quotas/rates, tombstones, malformed/oversized requests, failure
injection/rollback, timeout retry, missing protections, and isolated DB fixtures.
Existing Shared Songs, personal library/setlist, cloud sync, backup and QR contracts
are unchanged; their existing regression suites remain required.

Phase B must add explicit publish/preview UI, stable publication/idempotency key
management and sync the exact selected personal source before publishing. Phase C
must implement explicit independent personal imports, duplicate-import protection,
destination confirmation and Open Setlist. No UI/import/lineage behavior is shipped
here. Unsynced-only publication and per-occurrence overrides are deferred, not
silently approximated. Encrypted JSON remains separate Issue #125. No release
requires enabling this foundation before those separately reviewed phases.
