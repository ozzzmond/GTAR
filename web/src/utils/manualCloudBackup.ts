import { stableStringify } from './contentHash'
import { validTagColors } from './songTags'
import { appLogger } from './logger'
import { ensureRestoreSafetySnapshot, libraryWritesSaved, verifyRestoredLibrary } from './backupExport'
import { parseBackupJson } from './jsonBackup'
import { computeSongbookChecksum, type CloudSongbookRecord } from './cloudBackupFormat'
import type { SyncLibrary } from './syncMerge'
import { readPersistedLibrary } from './syncJournal'
export interface BackupAccount { token: string; userId: string; isCurrent?: () => boolean }
export class CloudBackupChanged extends Error { constructor() { super('Cloud backup changed. Review the new summary and confirm again.') } }
function headers(account: BackupAccount) {
  if (!account.token || !account.userId || account.isCurrent?.() === false) throw new Error('Sign in to back up to cloud')
  return { Authorization: `Bearer ${account.token}`, 'X-GTAR-Library-Owner': account.userId, 'Content-Type': 'application/json' }
}
export async function readCloudBackup(account: BackupAccount): Promise<CloudSongbookRecord | null> {
  const response = await fetch('/api/songbook/sync', { method: 'GET', headers: headers(account), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.error || 'Could not read cloud backup')
  const record = body.cloudRecord as CloudSongbookRecord | null
  if (record?.data.tagColors !== undefined && !validTagColors(record.data.tagColors)) throw new Error('Invalid cloud tag colors')
  if (record && computeSongbookChecksum(record.data) !== record.checksum) throw new Error('Cloud backup checksum verification failed')
  return record
}
export async function writeCloudBackup(account: BackupAccount, library: SyncLibrary, revision: Pick<CloudSongbookRecord, 'version' | 'checksum'> | null) {
  const checksum = computeSongbookChecksum(library)
  const response = await fetch('/api/songbook/sync', { method: 'POST', headers: headers(account), signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ action: 'upload', data: library, clientChecksum: checksum, expectedVersion: revision?.version ?? 0, expectedChecksum: revision?.checksum ?? null }) })
  if (response.status === 409) throw new CloudBackupChanged()
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.error || 'Cloud backup failed')
  const verified = await readCloudBackup(account)
  if (!verified || verified.checksum !== checksum || stableStringify(verified.data.tagColors) !== stableStringify(library.tagColors)) throw new Error('Cloud backup verification failed; cloud changed or upload was not saved')
  appLogger.info('BackupSaved', `Backup saved (cloud): ${library.songs.length} songs, ${library.setlists.length} setlists`)
  return verified
}

export async function restoreCloudBackup(before: SyncLibrary, incoming: SyncLibrary, mode: 'replace' | 'merge', apply: (library: SyncLibrary) => void | Promise<void>, storage: Storage) {
  const parsed = parseBackupJson(JSON.stringify(incoming), mode === 'merge' ? { mode, existingSongs: before.songs } : undefined)
  if (!parsed.isValid) throw new Error(parsed.error || 'Invalid cloud backup')
  const library = { ...(parsed.tagColors !== undefined ? { tagColors: parsed.tagColors } : {}), songs: parsed.songs, setlists: parsed.setlists, ...(parsed.folders !== undefined ? { folders: parsed.folders } : {}) }
  try { await ensureRestoreSafetySnapshot(before, storage) }
  catch (error) { throw new Error(`Restore aborted: safety snapshot failed to save (${error instanceof Error ? error.message : String(error)}). Device library preserved.`, { cause: error }) }
  if (JSON.stringify(readPersistedLibrary(storage)) !== JSON.stringify(before)) throw new Error('Device library changed while saving the safety snapshot. Restore aborted; review again.')
  await apply(library)
  const problems = [...await libraryWritesSaved(), ...verifyRestoredLibrary(before, library, mode, storage)]
  if (problems.length) throw new Error(`Restore could not be verified: ${problems.join('; ')}. Previous library is kept in the safety snapshot.`)
  appLogger.info('RestoreApplied', `Restore applied (${mode}, cloud): ${library.songs.length} songs, ${library.setlists.length} setlists`)
}
