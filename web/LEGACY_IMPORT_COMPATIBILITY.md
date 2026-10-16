# Legacy import compatibility (PR #68)

G2 removed automatic IDs at import boundaries. Before G2, `normalizeBackupSong`
and `parseBackupJson` generated IDs for absent song/setlist IDs. Rejecting every
such file regressed valid legacy backups; it also correctly stopped automatic
identity inference and repeated background imports.

| Format | Classification | Handling |
| --- | --- | --- |
| Full backups, including Android-origin `metadata.appName=GTAR` | SUPPORTED_WITH_STABLE_ID / SUPPORTED_WITH_EXPLICIT_IMPORT_AS_NEW | Stable IDs retain existing G2 validation. Missing IDs require confirmation and additive import. |
| `SINGLE_SETLIST` with embedded charts | SUPPORTED_WITH_STABLE_ID / SUPPORTED_WITH_EXPLICIT_IMPORT_AS_NEW | Preserve entry order, including repeats. Conflicting charts for one canonical ID reject. |
| JSON Bridge song objects, arrays and full backups | SUPPORTED_WITH_STABLE_ID / SUPPORTED_WITH_EXPLICIT_IMPORT_AS_NEW | Legacy preview exposes Import as New. Import the complete legacy payload through durable merge. |
| JSON Bridge native `GTAR_SETLIST` | SUPPORTED_WITH_EXPLICIT_IMPORT_AS_NEW | Adapt `chordsContent`, retain the setlist and chart order, convert ISO creation date to Web milliseconds. |
| Band Sync messages | SUPPORTED_WITH_STABLE_ID; ID-less: UNSUPPORTED_WITH_CLEAR_ERROR | Background reception cannot establish explicit user intent. Keep rejection; sender must export a file and receiver must confirm Import as New. |
| `GTAR_SHARED_SETLIST` | SUPPORTED_WITH_EXPLICIT_IMPORT_AS_NEW | Existing shared-setlist preview already requires an Import/Stage action before creating fresh local records. Unchanged by G2. |
| Recovery archives, future schemas, malformed entries, canonical collisions, ambiguous or dangling references | UNSUPPORTED_WITH_CLEAR_ERROR | Retain rejection and original recovery bytes; no best-effort migration. |

Import as New is available through Backup & Restore, Import Songs & Setlists,
and JSON Bridge. A missing ID means the **whole incoming payload** becomes new
records after explicit confirmation, even if other records have stable IDs.
It never replaces current records, tombstones, or settings, including when the
file was selected through Wipe & Replace. Every retry/repeated import requires
confirmation. Cancelling creates no IDs and writes nothing.

Preview uses temporary positional IDs without randomness. Legacy title/artist
references must resolve uniquely inside the incoming file; the confirmation
explicitly describes this binding. They never select a record from the existing
library. Authoritative IDs must resolve inside that file. Canonical source ID
collisions are rejected before confirmation; generated IDs are checked against
existing and newly allocated IDs. Source JSON is never modified.

The existing durable merge enforces cross-tab revision checks before changing
React state. Persistence failures remain visible, and recovery archives and
restore snapshots remain intact. Strict `parseBackupJson` and Band Sync retain
G2 rejection of unconfirmed ID-less input.
