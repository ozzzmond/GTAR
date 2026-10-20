# Shared Cloud Setlists Phase B (#108)

Based on verified GitHub dev / Phase A merge
`e47d0eb8de6727db3c99df6d90cb39f5fef7ec66` (PR #126). The owner's
2026-10-20 correction keeps each environment's catalog and identities independent.
PROD remains HOLD. No deployment, migration or activation is part of this change.

## Capability and browser

The existing Shared Catalog gains Songs / Setlists selection. Songs retains its
existing component, search, import, edit, cache and pagination paths. Setlists is
disabled until an authenticated GET of the existing gated collection returns a
validated setlist response. No build flag, environment setting or Wrangler change
enables it. All failures, including arbitrary 404s and SPA HTML fallbacks, fail
closed. The exact server flag remains `SHARED_SETLISTS_ENABLED=phase-a-v1` and is
absent from deployment configuration.

Cards use only Phase A's verified `id`, `revision`, `name`, `occurrences`, and
`updated_at` fields. There is no publisher display name or public ownership field.
No public detail preview, Import or Open Setlist action is implemented in Phase B.
Those belong to Phase C. Native buttons provide keyboard activation and minimum
44px touch targets for new controls; the publication dialog uses showModal for
focus containment, Escape cancellation, and focus return.

## Publication source and approval

Active admins can choose Publish to Shared Setlists from personal setlist card
menus or the setlist drawer. No save/edit operation publishes. The modal requires
Refresh and review, disclosure, and explicit checkbox/button confirmation.

The stable selected personal ID resolves against the persisted local library and
a fresh authenticated GET `/api/songbook/sync`. In-memory edits, editor drafts,
cross-tab conflicts, missing persistence, a different library checksum or exact
snapshot, a wrong cloud account, invalid cloud checksum, or missing source block
publication. The full cloud checksum is verified, while theme settings are excluded
from personal-library comparison because they are not published. The preview and
server use the same pure snapshot validator/resolver. This preserves occurrences,
raw chart text, formats, optional metadata and authored/confirmed key semantics.
No missing metadata is inferred.

When local and cloud differ, the user must use the existing Cloud Sync controls,
including existing conflict/recovery confirmations, then retry review. Publication
never forces an upload, downloads over local edits, or starts background sync.
This deliberately fails closed instead of invoking the existing bidirectional
sync engine inside a publication confirmation. The exact selected source must
already be synchronized before approval can proceed.

Confirmation repeats verification and rejects changed versions or content. A
server source-version CAS protects the remaining network race. Backend auth and
original-publisher ownership remain authoritative; frontend role checks only
control presentation. Public catalog payloads cannot identify the owner.

## Keys, retries, links and revisions

Create sends only `snapshot_version`, `publication_key`, `source_setlist_id`, and
`source_version`. Update sends the source fields and `expected_revision`; delete
sends only `expected_revision`. Every mutation carries `Idempotency-Key` through
the existing authenticated HTTP client. No snapshots or publisher identity are sent.

An opaque SHA-256 publication key derives from account identity plus stable source
ID; browser origin and environment-local server accounts keep environments
independent. A random mutation key and exact request are durably saved before any
network write. Ambiguous network/storage failures retain that intent. Retry reuses
its original body/key, including after reload or a later personal source change,
to retrieve Phase A's permanent durable result. Pending intents block new mutations.
Known definitive server rejections clear approval and require fresh review.

The origin/account/source-scoped `gtar_setlist_publication_v1:` localStorage journal
stores keys, exact request parameters and confirmed public identifiers/revisions.
It stores no chart snapshots or tokens. It is operational recovery state, not new
personal song/setlist data or import lineage; existing personal normalization,
cloud equality, backup/restore and conflict rules remain unchanged. No legacy
personal data is rewritten. Losing this journal does not create a second publication
because the deterministic publication key remains the same. Phase A does not expose
lookup by that key or a publisher-owned listing: after browser/device loss, a
conflict may require operator-assisted link recovery. Do not claim automatic
cross-device publication management. Imported copies must not inherit this journal.

If server confirmation succeeds but saving the local link fails, the UI reports
partial success with the exact ID/revision and offers the saved request's recovery
retry. It never claims an unconfirmed success or creates another intent to recover.
Concurrent tabs cannot replace a different pending request or confirmed result.

Linked publications refresh their current head before update/unpublish review;
exact revision detail alone cannot establish the current head. Update requires a
fresh exact-source preview. Independent unpublish review remains available even
when local content is unsynced, includes mandatory expected_revision, and warns
that independent imported copies remain. Server conflicts remove approval and
require refreshed review; no automatic revision overwrite is attempted. Tombstoned
publications cannot be recreated with the same publication key.

## Phase C integration handoff

- Read exact published revisions with GET `/api/catalog/setlists/:id?revision=N`;
  validate the shared snapshot contract and present an explicit import preview.
  Recheck availability when needed; an unpublish hides all revisions.
- Clone songs and setlist into independent personal IDs, preserving each ordered
  occurrence, format, raw chart, key, transpose and capo without mutating catalogs.
  Reject unresolved content atomically; never import a partial list.
- Design explicit persisted import lineage: publication ID plus revision and
  destination identity, with account/environment isolation and duplicate-import
  prevention. Publication request journals are not import lineage.
- Integrate any new personal fields with normalization, checksum/equality,
  cloud merge/conflict handling, JSON backup/restore and recovery. Preserve legacy
  checksums/data where fields are absent. Cross-device publishing link recovery
  needs a separately reviewed server ownership lookup or compatible personal model.
- Persist all cloned songs, setlist and lineage in one existing guarded personal
  library operation. Handle quota, cross-tab changes, account transitions and
  recovery failures without leaving partial clones or overwriting newer data.
- Offer Open Setlist only after verified atomic personal persistence and destination
  confirmation. Existing QR sharing remains independent and available.

All tests use mocked transport or disposable local backend databases. Local test
success establishes no live migration readiness, deployment or activation evidence.
