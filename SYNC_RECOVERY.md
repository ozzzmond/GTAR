# Sync preservation and recovery

Stable IDs are authoritative for songs and setlists. Different stable IDs are never collapsed based on a current or historical title. Name matching remains for legacy references without IDs, and ambiguous references stop validation. This intentionally replaces the previous automatic same-title arrangement collapse: independently identified arrangements can remain duplicates until the user reconciles them.

The Web/PWA client uses three-way reconciliation against a durable account baseline. A record changed differently on both sides, including delete-versus-edit and divergent setlist membership/order, stops synchronization. Unknown baselines never choose cloud content over a differing local record. Both versions remain available in device recovery snapshots and/or retained Drive files. Empty new devices can still restore a cloud library. Setlists whose names collide across a rename retain their IDs and references.

Each attempt saves a recovery snapshot and pending before/merged state before uploading. Upload acknowledgment is durable before local apply; successful local persistence advances the baseline. A restart resumes pending acknowledged apply against its original input and preserves intervening edits or raises a conflict. Failed/uncertain uploads leave the prior baseline intact. Storage failures stop sync. Tokens are not persisted in these journals. A device library is bound to one verified account ID: account changes stop automatic sync rather than uploading the previous account's data. Sign back into the original account to continue; cross-account library transfer is deliberately manual.

Web stores songs, trash, and setlists in one atomic localStorage value. The frozen legacy Android client used transactional Room writes with an intervening-edit check. Snapshots are retained, not automatically pruned; storage exhaustion stops sync safely. Export archives before any manual storage repair.

## Drive protocol v1

The old `gtar_songbook_sync.json` is read as a legacy root. Every new upload creates a separate `gtar_songbook_revision_v1.json` file in appDataFolder. Each payload contains `syncProtocol: 1` and `syncParents`, an array of observed `fileId@version:<version>` keys (metadata fallbacks are modifiedTime and md5Checksum). Existing files are never updated or deleted by this protocol. A legacy writer changing a root after it was observed produces a different root key and is detected as an additional head on a later pull.

Readers enumerate all pages, validate payloads and metadata, and find heads by removing acknowledged parent versions. A single head is reconciled locally. Identical sibling heads can be acknowledged together; divergent sibling heads stop for explicit recovery. Missing metadata or invalid history stops writes. An uncertain create consumes the upload permission and requires another pull; the accepted file, if any, remains discoverable. Simultaneous initial creation has the same semantics as concurrent later writes.

This is retained revision history, not an atomic compare-and-swap or a global lock. Safety relies on creating independent files, not on an unverified If-Match header. Google documents [files.create](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create) as creating a file (including multipart/resumable uploads), and [application data storage](https://developers.google.com/workspace/drive/api/guides/appdata) describes creating files with the appDataFolder parent. The [files.update reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) was also reviewed; this implementation does not rely on conditional update behavior. Documentation checked 2026-09-12; live OAuth/Drive concurrency has not been tested here.

Upgrade every syncing device before relying on this protocol. Old versions cannot read revision files and retain their former overwrite behavior. History is not compacted; download and storage costs grow with the number of revisions. Late concurrent writers can produce another conflict after resolution, while preserving all files.

## Resolving a conflict

1. Use **Download sync recovery data** in the Web/PWA app. For the frozen legacy Android client, use **Export sync recovery data** in its Settings. The archive includes current device data, saved attempt snapshots, and raw cloud revisions. Check cloudError: an unavailable cloud download does not mean those files were exported. Retry with a valid session/connection.
2. Extract the desired normal full-backup objects from the archive, compare charts and setlists, and use the existing backup import/editor flows to assemble the intended device library. Recovery archives themselves are intentionally not directly importable. Keep the original archive.
3. From the conflict status, choose **Publish resolved device library** and confirm only after reviewing that device's content. This creates a revision acknowledging all currently observed heads. Prior cloud files remain retained. It does not erase an unobserved concurrent writer.

If a full backup has a missing setlist song, normal export fails with a reference error. Restore the missing song with its original ID, or deliberately repair the setlist in the UI, then export again. The backup dialog downloads a raw recovery archive on export failure; it preserves the unresolved entries. Sync rejects unresolved references too.

## Presentation and validation

The hosted web owner gate is unchanged: token expiry (30-second safety margin), sign-out, or failed cached-token verification locks the app and unmounts presentation. Local data remains saved; offline reload does not bypass owner verification. The frozen legacy Android client permitted local editing/presentation after sign-out or token errors. Its historical behavior differs from the active Web/PWA owner gate. The web presentation expiry/offline-reload test mounts the real presentation component in jsdom; it is not a long performance or physical-display test.

PR validation runs web tests, production build, strict sync/backup/auth/URL/wake-lock lint, and repository/release-controller checks. No remote branch protection was modified.

`npm run lint:sync` uses all existing ESLint rules and zero allowed warnings on the critical modules. `npm run lint` remains the whole-project diagnostic; existing UI/casting lint debt is not suppressed or baselined away. Generated dev-dist files are excluded as build outputs. Extend the lint gate as remaining modules are repaired; this is not a claim that the whole tree is lint-clean.
