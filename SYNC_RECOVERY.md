# Songbook synchronization and recovery

## Current Web/PWA synchronization

The active client synchronizes songs and setlists through authenticated
`/api/songbook/sync` requests to Cloudflare Pages Functions. D1 stores the
caller-scoped songbook, checksum, version and update time. The server derives the
account from the verified session or Google identity; it does not accept an
arbitrary destination account supplied by the browser.

The device library is stored in the canonical `gtar_library_v1` localStorage
value. On DEV with library storage B1 on, it is a slim `gtar_library_v2` index in
localStorage with chart bodies in IndexedDB (#167). The client compares local and
cloud checksums with its last synchronized metadata to select no change, upload,
download or reconciliation. It also stores a local base snapshot
(`gtar_cloud_sync_base`) for three-way reconciliation. With B1 on, that base uses
the same slim format and references chart bodies already held in IndexedDB
(#189). If the base cannot be saved, the sync still completes and the Cloud
Songbook Sync dialog shows a warning; the next reconciliation then has no common
base and asks for a manual choice instead of guessing. Sync metadata from another
account is excluded from the decision. This is not a guarantee that changing
accounts transfers or clears the device library safely; export and review device
data before using another account.

Reconciliation uses stable song/setlist IDs. Independently edited songs with a
known base can retain local content and a cloud conflict copy; setlist conflicts
are reported. Without a common base, divergent same-ID records can prefer the
remote state. Do not assume every unknown-baseline conflict preserves both
versions automatically. Downloaded and merged libraries are checked for setlist
reference integrity before local persistence.

The **Cloud Songbook Sync** dialog provides **Sync Now** and conflict-resolution
controls. Review the listed conflicts and export a normal backup before choosing
merge or cloud download. A download or merge attempts to save a local safety
snapshot under `gtar_sync_recovery:` before replacing the library. Snapshot writes
are best effort: storage quota failures can prevent that snapshot. A merge is
persisted locally before its server upload; an upload failure does not undo the
local merge. Check the reported result and preserve backups before retrying.

The API updates the current D1 songbook and increments its version. Uploads are
compare-and-swap: the client sends the cloud version and checksum it last saw
(`expectedVersion`, `expectedChecksum`), and the server rejects a stale or
missing base with HTTP 409 `SONGBOOK_REVISION_CONFLICT`, so the client fetches and
reconciles before retrying. The whole songbook is one record, limited to 2 MB per
upload. The API does not provide the former Drive revision-file history or
automatic rollback. These descriptions are limits of the existing
implementation, not changes to synchronization behavior.

## Per-record sync (DEV)

RFC #188 (S4–S7). On DEV the Sync Center's **Sync engine** defaults to **Per-record**; it can be
switched back to **Classic** per device. PROD keeps the classic whole-songbook sync until a
separately approved release.

- **Server:** `/api/songbook/records`, enabled only when `SONGBOOK_RECORDS_SYNC=records-v1`
  (DEV `preview` vars) and migration `0009_songbook_records.sql` is applied. Otherwise it answers
  as disabled and the client uses `/api/songbook/sync`. Each song, setlist and the theme
  settings are one record with a revision; writes are compare-and-swap per record. The first
  access seeds the records from the whole-document songbook, and every write mirrors the
  records back into it, so classic sync and rollback keep working.
- **Client:** remembers, per record, the revision and checksum it last agreed on
  (`gtar_records_sync_v1`). Records not edited on this device are fast-forwarded. Records
  edited here and in the cloud are conflicts: the local copy is kept and nothing is merged
  automatically. The dialog's choices apply to all queued conflicts: keep this device
  (Upload), use cloud (Download) or keep both (Merge & Preserve, cloud copy). A recovery
  snapshot of both sides is saved before any choice. Fast-forwarding an unedited record writes
  no snapshot.
- **Automatic sync:** one tab per browser (Web Locks leader) syncs a few seconds after a save,
  on reconnect, when the page becomes visible and every two minutes. It pauses while the
  editor is open, a cross-tab conflict is unresolved or the Sync Center is open.
- **Rollback:** switch the device to Classic, or remove the DEV flag; the mirrored
  whole-document songbook is current.



Startup validates canonical IDs, record fields and setlist references while
retiring legacy browser storage. Original sources remain when retirement cannot
reconcile or persist them safely. The recovery banner offers **Export recovery
data**; its JSON includes the canonical library and retained legacy/journal/safety
snapshot storage values. It is a raw device recovery archive for manual review,
not a normal songbook backup or a download of server history.

Keep that archive before clearing browser storage or applying a repair. Use the
normal backup/import and editor flows to assemble the intended library. A normal
backup export fails if a setlist references a missing song; the backup dialog can
export raw recovery data instead. Restore the song with its original ID or review
the app's explicit reference-repair flow before attempting another normal export.
See [Web recovery and development notes](web/README.md).

## Historical interoperability

Google Drive AppData revision files and native Android/Room synchronization belong
to the retired implementation. Retained browser recovery handling can inspect old
Drive-era state, and legacy backup interoperability remains supported. The active
Web/PWA sync does not require Drive API setup or create Drive revision files.
Native Android source and release history remain in GTAR-Android-Legacy.

## Validation

Run `npm test`, `npm run lint:sync`, and `npm run build` from `web`. Current sync
regressions include `cloudSongbookSync.test.cjs`, `cloudSetlistSync.test.cjs`,
`deleteLifecycleRecovery.test.cjs`, and storage retirement/recovery suites.
Network and D1 behavior in these tests is simulated; passing them does not prove
live multi-device operation or deployment readiness. Whole-project `npm run lint`
remains a separate diagnostic; the focused lint gate does not waive its findings.
