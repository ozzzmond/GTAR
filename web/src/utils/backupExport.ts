/**
 * #251 Cloud V2 P0: handing a verified backup file to the user, and the restore safety net.
 *
 * Export order: share sheet with the file (iOS Files / iCloud Drive / Google Drive / OneDrive via
 * the system file providers) → browser download → Copy JSON (small libraries only). The share sheet
 * needs a fresh tap: when the browser refuses (`NotAllowedError`) the prepared file is kept and the
 * caller asks for one more tap. A resolved share or a started download only means the file left
 * GTAR; saving is confirmed by the user, not by the app.
 */
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { COPY_JSON_MAX_BYTES, RESTORE_SNAPSHOT_KEY, createRestoreSafetySnapshot, stableStringify, triggerDownload, type VerifiedBackup } from './jsonBackup'
import { mergeBackupLibrary } from './setlistSongs'
import { mergeImportedSetlists } from './importIdentity'
import { canonicalSongKey } from './musicalKey'
import { recordBackupStatus, type BackupDelivery } from './backupStatus'
import { isQuotaError, readPersistedLibrary, readRecoveryArchive, writeRecoverySnapshot } from './syncJournal'
import { generateUUID } from './uuid'

export interface ExportEnvironment {
  navigator?: Pick<Navigator, 'share' | 'canShare'> & { clipboard?: Pick<Clipboard, 'writeText'> }
  makeFile?: (json: string, fileName: string) => File | null
  download?: (json: string, fileName: string) => void
}

export type ExportOutcome =
  | { kind: 'shared' }
  | { kind: 'share-cancelled' }
  /** The browser wants a fresh tap before opening the share sheet; the prepared file is kept. */
  | { kind: 'needs-tap' }
  | { kind: 'downloaded'; reason?: 'share-unavailable' | 'share-failed' }
  | { kind: 'copied' }
  | { kind: 'failed'; message: string }

function defaultFile(json: string, fileName: string): File | null {
  try { return typeof File === 'function' ? new File([json], fileName, { type: 'application/json' }) : null } catch { return null }
}
const nav = (env: ExportEnvironment) => env.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined)

/** True when this browser can put a file on the share sheet (checked without opening it). */
export function canShareBackupFile(backup: Pick<VerifiedBackup, 'json' | 'fileName'>, env: ExportEnvironment = {}): boolean {
  const n = nav(env)
  if (!n || typeof n.share !== 'function' || typeof n.canShare !== 'function') return false
  const file = (env.makeFile ?? defaultFile)(backup.json, backup.fileName)
  try { return !!file && n.canShare({ files: [file] }) } catch { return false }
}

function finish(backup: VerifiedBackup, delivery: BackupDelivery, outcome: ExportOutcome): ExportOutcome {
  recordBackupStatus(backup, delivery)
  return outcome
}

export function downloadBackup(backup: VerifiedBackup, env: ExportEnvironment = {}, reason?: 'share-unavailable' | 'share-failed'): ExportOutcome {
  try { (env.download ?? triggerDownload)(backup.json, backup.fileName) }
  catch (error) { return { kind: 'failed', message: error instanceof Error ? error.message : String(error) } }
  return finish(backup, 'download', { kind: 'downloaded', ...(reason ? { reason } : {}) })
}

/**
 * Share sheet first; download when sharing files is not supported or fails for another reason.
 * A user cancel is respected (no automatic download). `NotAllowedError` keeps the file for a tap.
 */
export async function shareOrDownloadBackup(backup: VerifiedBackup, env: ExportEnvironment = {}): Promise<ExportOutcome> {
  const n = nav(env)
  const file = (env.makeFile ?? defaultFile)(backup.json, backup.fileName)
  const supported = (() => {
    try { return !!n && !!file && typeof n.share === 'function' && typeof n.canShare === 'function' && n.canShare({ files: [file] }) } catch { return false }
  })()
  if (!supported) return downloadBackup(backup, env, 'share-unavailable')
  try {
    await n!.share!({ files: [file!], title: backup.fileName })
    return finish(backup, 'share', { kind: 'shared' })
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    if (name === 'AbortError') return { kind: 'share-cancelled' }
    if (name === 'NotAllowedError') return { kind: 'needs-tap' }
    return downloadBackup(backup, env, 'share-failed')
  }
}

export function canCopyBackup(backup: Pick<VerifiedBackup, 'bytes'>): boolean { return backup.bytes <= COPY_JSON_MAX_BYTES }

export async function copyBackup(backup: VerifiedBackup, env: ExportEnvironment = {}): Promise<ExportOutcome> {
  if (!canCopyBackup(backup)) return { kind: 'failed', message: `Backup is too large to copy safely (${(backup.bytes / 1024 / 1024).toFixed(1)} MB). Use Save backup file or Download.` }
  const clipboard = nav(env)?.clipboard
  if (!clipboard?.writeText) return { kind: 'failed', message: 'Clipboard is not available in this browser.' }
  try { await clipboard.writeText(backup.json) }
  catch (error) { return { kind: 'failed', message: error instanceof Error ? error.message : 'Failed to copy to clipboard.' } }
  return finish(backup, 'copy', { kind: 'copied' })
}

export interface SafetySnapshotResult { location: 'restore-snapshot' | 'recovery-archive'; key: string }

/**
 * Pre-restore copy of the current library, verified by reading it back. The usual single
 * localStorage snapshot is tried first; when it does not fit, the same snapshot goes to the
 * recovery archives (IndexedDB when available). Throws when neither could be verified: the
 * caller must not change the library then.
 */
export async function ensureRestoreSafetySnapshot(library: { songs: ActiveSongState[]; setlists: WebSetlist[] }, storage: Storage): Promise<SafetySnapshotResult> {
  try {
    createRestoreSafetySnapshot(library, storage)
    return { location: 'restore-snapshot', key: RESTORE_SNAPSHOT_KEY }
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause
    if (!isQuotaError(cause) && !isQuotaError(error)) throw error
    const key = `gtar_sync_recovery:restore-snapshot:${generateUUID()}`
    // #257 review: `local` is the recovery format Recovery Review reads (choose / export / cleanup).
    const raw = JSON.stringify({ local: library, restoreSnapshotAt: new Date().toISOString() })
    try {
      await writeRecoverySnapshot(key, raw, storage)
      if (readRecoveryArchive(key, storage) !== raw) throw new Error('Safety snapshot archive could not be verified', { cause: error })
    } catch (archiveError) {
      throw new Error('Pre-restore safety snapshot creation failed', { cause: archiveError })
    }
    return { location: 'recovery-archive', key }
  }
}

type Library = { songs: ActiveSongState[]; setlists: WebSetlist[] }

/** The persisted representation: JSON round-trip (undefined fields dropped) and canonical song keys, as persistLibrary stores them. */
function canonicalLibrary(library: Library): Library {
  const plain = JSON.parse(JSON.stringify({ songs: library.songs, setlists: library.setlists })) as Library
  return { songs: plain.songs.map(song => song.key === undefined ? song : { ...song, key: canonicalSongKey(song.key) }), setlists: plain.setlists }
}

/** What the restore handlers must have saved: the backup itself (replace) or the existing merge rules applied to it (merge). */
export function expectedRestoredLibrary(before: Library, incoming: Library, mode: 'replace' | 'merge'): Library {
  if (mode === 'replace') return { songs: incoming.songs, setlists: incoming.setlists }
  const merged = mergeBackupLibrary(before.songs, incoming.songs, incoming.setlists)
  return { songs: merged.songs, setlists: mergeImportedSetlists(before.setlists, merged.setlists) }
}

function recordDiff(kind: 'song' | 'setlist', expected: Record<string, unknown>[], saved: Record<string, unknown>[], out: string[]): void {
  if (expected.length !== saved.length) out.push(`${kind} count ${saved.length} saved, ${expected.length} expected`)
  const n = Math.max(expected.length, saved.length)
  for (let i = 0; i < n && out.length < 6; i++) {
    const want = expected[i], got = saved[i]
    if (!want || !got) continue
    if (String(want.id) !== String(got.id)) { out.push(`${kind} order or membership differs at position ${i + 1} (${String(got.id)} saved, ${String(want.id)} expected)`); continue }
    if (stableStringify(want) === stableStringify(got)) continue
    const fields = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter(f => stableStringify(want[f]) !== stableStringify(got[f])).sort()
    out.push(`${kind} ${String(want.id)} differs in ${fields.join(', ')}`)
  }
}

/**
 * #251 F1: reads the saved library back and compares the complete canonical library with what the
 * restore should have produced: every song and setlist, every supported field, chart content,
 * order, setlist membership and references, trash state. Any unexplained difference is an error.
 */
export function verifyRestoredLibrary(before: Library, incoming: Library, mode: 'replace' | 'merge', storage: Storage): string[] {
  let saved: Library | null
  try { saved = readPersistedLibrary(storage) } catch (error) {
    return [`saved library could not be read back (${error instanceof Error ? error.message : String(error)})`]
  }
  if (!saved) return ['saved library could not be read back']
  let expected: Library
  try { expected = canonicalLibrary(expectedRestoredLibrary(before, incoming, mode)) } catch (error) {
    return [`expected library could not be computed (${error instanceof Error ? error.message : String(error)})`]
  }
  const actual = canonicalLibrary(saved)
  const errors: string[] = []
  recordDiff('song', expected.songs as unknown as Record<string, unknown>[], actual.songs as unknown as Record<string, unknown>[], errors)
  recordDiff('setlist', expected.setlists as unknown as Record<string, unknown>[], actual.setlists as unknown as Record<string, unknown>[], errors)
  if (!errors.length && stableStringify(expected) !== stableStringify(actual)) errors.push('saved library differs from the backup')
  return errors
}
