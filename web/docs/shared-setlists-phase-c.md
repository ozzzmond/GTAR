# Shared Cloud Setlists Phase C (#108)

Baseline: GitHub dev `eb97b5aea7c97e4f5f3ef46714633f95084762e2`,
merged Phase A #126 and Phase B #127. Catalogs and personal libraries remain
independent per environment. PROD HOLD. No migration, deployment, binding change,
feature activation, merge or tag is part of this PR.

## Preview and personal copies

Phase B cards open a native modal with ordered occurrences, raw text charts and
available metadata. GET always requests the selected exact revision with no-store;
identity, revision, exact public envelope and shared snapshot validator must pass.
Nothing is read from the Shared Songs cache. Account/session changes invalidate
requests; changing tabs/accounts hides the old capability and preview. Rendering
uses React text nodes, including malicious-looking chart text.

Import requires explicit confirmation and a fresh authorized exact-revision read.
Unpublished/deleted/disabled or changed content cannot be imported from the preview.
Each occurrence receives a new personal song UUID, including repeated sources;
the setlist receives a new UUID. Raw content, directives, formats and supported
metadata are copied without transposition/key inference. Required runtime string
fields use empty strings when absent; absent transpose uses zero. The established
personal save canonicalizes musical key spelling. No title/content merge occurs.

`WebSetlist.catalogSource` stores validated origin scope, public setlist ID and
revision. The API currently supplies no public checksum, so none is fabricated.
The optional checksum field is validated for future use. Origin scope is internal
personal metadata; it is never added to published snapshots or UI cards. Backups
of personal libraries include this internal metadata. Different origins never
match as the same publication. Moving an environment to a new origin requires
explicit operator assessment; origins are not cross-environment catalog IDs.

Exact-revision copies are detected across active and trashed setlists after reload.
Open Existing, Restore Existing, deliberate duplicate and new revision each remain
explicit choices. Restore requires all referenced songs to be active; missing or
trashed charts require the existing Trash/recovery workflow first. No automatic
restore, update, or placeholder is performed. Independent imported copies survive
unpublish and remain editable through existing editors.

## Persistence and concurrency

Immediate in-flight guard plus an origin-wide exclusive Web Lock protects catalog
imports. Unsupported Web Locks and occupied locks fail closed. Requests capture
the persisted baseline and draft before availability revalidation; the locked
critical section repeats account, conflict, draft and exact-storage checks. No
await occurs between the final checks, recovery archive and single-key library
write. Recovery snapshot failure prevents the write. Existing persistLibrary CAS,
quota retry and readback protections remain intact. Full saved song representation,
destination lineage and live references are verified before success. Open rechecks
the personal ID, lineage, live charts and current in-memory destination.

Web Locks serialize this new import path across tabs. Existing ordinary editor,
backup and cloud writers retain their established synchronous localStorage CAS
model: localStorage offers no transactional compare-and-swap across uncooperative
writers. Their writes are detected by baseline/readback and existing conflict UI,
but strict global linearizability against a legacy writer racing inside the final
synchronous section cannot be claimed. Field QA should use one active writer and
upgrade all open clients; this PR does not redesign the personal persistence engine.

Local success explicitly reports cloud sync pending. Existing Cloud Sync remains
the authority for upload success, its 2 MiB request limit, account ownership,
conflict confirmation and failure feedback. Import does not force upload or claim
cloud durability. Recovery, quota or unsaved draft conditions block import through
the App host. No private songbook or backup is sent to the catalog API.

## Compatibility and integration evidence

New lineage participates in cloud checksum and setlist equality only when present,
preserving legacy checksum bytes when absent. Normalization, stable-ID binding,
cloud reconciliation, single/full JSON backups and recovery retain the field.
Malformed lineage is rejected at persistence and backup boundaries. Conflict copies
retain lineage. Older clients do not include lineage in checksum/equality and may
reject changed checksums or omit fields in transformations; mixed-client sync is
not supported for imported lineage. Upgrade/reload every client before field QA.
Encrypted JSON backups remain Issue #125.

Deterministic tests combine Phase A publication/snapshot/auth/environment fixtures,
Phase B exact-source publishing tests and Phase C mocked exact-revision import/UI
checks. Coverage includes ordered independent repeats, all formats and key fields,
backup/normalization, actual cloud upload/download functions, conflict copies,
duplicates/trash/revisions, account changes, stale drafts, locks, quota/recovery
failure, disabled/unpublished reads, escaped content and verified navigation.
These are local integration contracts, not live Cloudflare or mobile-device proof.

## Separately approved DEV field-QA prerequisites

Review/apply migration `0007_shared_catalog_setlists.sql` only to the isolated DEV
D1 with explicit authorization; verify its ledger, tables and protection triggers.
Review DEV bindings and approved member/admin accounts. Separately authorize the
exact server setting `SHARED_SETLISTS_ENABLED=phase-a-v1`; it remains absent from
committed deployment configuration. Verify HTTPS/Web Locks on target mobile PWAs,
upgrade all clients, then exercise admin publication -> member exact preview ->
independent import -> duplicate/restore -> Open Setlist with disposable DEV data.
Verify cloud upload/reload on another updated client, storage failures and unpublish.
PROD migration/activation/release requires its own later approval. Phase B's lost
publication-journal ownership lookup limitation remains unchanged.
