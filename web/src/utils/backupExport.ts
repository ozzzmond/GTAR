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
import { COPY_JSON_MAX_BYTES, RESTORE_SNAPSHOT_KEY, createRestoreSafetySnapshot, normalizeBackupSong, triggerDownload, type VerifiedBackup } from './jsonBackup'
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
    const raw = JSON.stringify({ createdAt: new Date().toISOString(), library })
    try {
      await writeRecoverySnapshot(key, raw, storage)
      if (readRecoveryArchive(key, storage) !== raw) throw new Error('Safety snapshot archive could not be verified', { cause: error })
    } catch (archiveError) {
      throw new Error('Pre-restore safety snapshot creation failed', { cause: archiveError })
    }
    return { location: 'recovery-archive', key }
  }
}

const songShape = (song: Partial<ActiveSongState>) => {
  const s = normalizeBackupSong(song as ActiveSongState)
  return JSON.stringify([s.title, s.artist, s.rawContent, !!s.isDeleted])
}

/**
 * Reads the saved library back and checks the restored records are really there. Replace: the
 * saved library is exactly the backup (same song and setlist ids, same charts). Merge: every
 * song and setlist from the backup is present with the backup's chart; other records may exist.
 */
export function verifyRestoredLibrary(
  expected: { songs: ActiveSongState[]; setlists: WebSetlist[] }, mode: 'replace' | 'merge', storage: Storage,
): string[] {
  let saved: { songs: ActiveSongState[]; setlists: WebSetlist[] } | null
  try { saved = readPersistedLibrary(storage) } catch (error) {
    return [`saved library could not be read back (${error instanceof Error ? error.message : String(error)})`]
  }
  if (!saved) return ['saved library could not be read back']
  const errors: string[] = []
  const savedSongs = new Map(saved.songs.map(song => [String(song.id), song]))
  for (const song of expected.songs) {
    const found = savedSongs.get(String(song.id))
    if (!found) errors.push(`song ${String(song.id)} missing after restore`)
    else if (songShape(found) !== songShape(song)) errors.push(`song ${String(song.id)} differs after restore`)
    if (errors.length >= 5) break
  }
  const savedSetlists = new Set(saved.setlists.map(list => String(list.id)))
  for (const list of expected.setlists) if (!savedSetlists.has(String(list.id))) errors.push(`setlist ${String(list.id)} missing after restore`)
  if (mode === 'replace' && !errors.length && (saved.songs.length !== expected.songs.length || saved.setlists.length !== expected.setlists.length)) {
    errors.push(`saved library has ${saved.songs.length} songs / ${saved.setlists.length} setlists; backup has ${expected.songs.length} / ${expected.setlists.length}`)
  }
  return errors
}
