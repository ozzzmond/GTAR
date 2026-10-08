# Songbook synchronization and recovery

## Current Web/PWA synchronization

The active client synchronizes songs and setlists through authenticated
`/api/songbook/sync` requests to Cloudflare Pages Functions. D1 stores the
caller-scoped songbook, checksum, version and update time. The server derives the
account from the verified session or Google identity; it does not accept an
arbitrary destination account supplied by the browser.

The device library is stored in the canonical `gtar_library_v1` localStorage
value. The client compares local and cloud checksums with its last synchronized
metadata to select no change, upload, download or reconciliation. It also stores
a local base snapshot for three-way reconciliation. Sync metadata from another
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

The API updates the current D1 songbook and increments its version. It does not
provide the former Drive revision-file history, a cross-device compare-and-swap
transaction, or automatic rollback. These descriptions are limits of the existing
implementation, not changes to synchronization behavior.

## Device recovery

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
