import { stableStringify } from './contentHash'
import { validTagColors } from './songTags'
import { appLogger } from './logger'
import { ensureRestoreSafetySnapshot, libraryWritesSaved, verifyRestoredLibrary } from './backupExport'
import { parseBackupJson } from './jsonBackup'
import { GTAR_APP_VERSION, GTAR_DEV_VERSION, GTAR_DEV_PROVENANCE } from '../types/gtar'
import { isDevEnv } from './env'
import { computeSongbookChecksum, verifySongbookChecksum, songbookUploadBody, SONGBOOK_CHECKSUM_SCHEME, type CloudSongbookRecord } from './cloudBackupFormat'
import type { SyncLibrary } from './syncMerge'
import { readPersistedLibrary } from './syncJournal'
export interface BackupAccount { token: string; userId: string; isCurrent?: () => boolean }
function headers(account: BackupAccount) {
  if (!account.token || !account.userId || account.isCurrent?.() === false) throw new CloudBackupFailure('SIGN_IN_REQUIRED', 'session', 'Sign in to back up to cloud')
  return { Authorization: `Bearer ${account.token}`, 'X-GTAR-Library-Owner': account.userId, 'Content-Type': 'application/json' }
}
type CloudOperation = 'read' | 'backup' | 'restore'
export class CloudBackupFailure extends Error {
  code: string
  stage: string
  status?: number
  scheme?: string
  constructor(code: string, stage: string, message: string, status?: number, scheme?: string) {
    super(message); this.code = code; this.stage = stage; this.status = status; this.scheme = scheme
  }
}
export class CloudBackupChanged extends CloudBackupFailure {
  constructor() { super('REVISION_CONFLICT', 'upload', 'Cloud backup changed. Review the new summary and confirm again.', 409, SONGBOOK_CHECKSUM_SCHEME) }
}
const loggedFailures = new WeakSet<object>()
/** Only fixed local codes/allowlisted scheme names enter the logger. Never pass an Error or response body. */
export function logCloudBackupFailure(operation: CloudOperation, error: unknown): void {
  if (error instanceof Object && loggedFailures.has(error)) return
  if (error instanceof Object) loggedFailures.add(error)
  const failure = error instanceof CloudBackupFailure ? error : null
  appLogger.error('CloudBackupFailure', JSON.stringify({ operation, stage: failure?.stage ?? 'operation',
    code: failure?.code ?? (error instanceof CloudBackupChanged ? 'REVISION_CONFLICT' : 'OPERATION_FAILED'),
    ...(failure?.status !== undefined ? { httpStatus: failure.status } : {}),
    version: isDevEnv ? GTAR_DEV_VERSION : GTAR_APP_VERSION, build: GTAR_DEV_PROVENANCE.commitSha,
    scheme: failure?.scheme === SONGBOOK_CHECKSUM_SCHEME ? SONGBOOK_CHECKSUM_SCHEME : failure?.scheme === undefined ? 'unversioned' : 'unknown' }))
}
function requireCurrent(account: BackupAccount) {
  if (account.isCurrent?.() === false) throw new CloudBackupFailure('ACCOUNT_CHANGED', 'session', 'Sign in again; account changed.')
}
async function fetchCloudBackup(account: BackupAccount): Promise<CloudSongbookRecord | null> {
  const response = await fetch('/api/songbook/sync', { method: 'GET', headers: headers(account), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  requireCurrent(account)
  if (!response.ok) throw new CloudBackupFailure('READ_HTTP_FAILED', 'response', 'Could not read cloud backup. Retry, or sign in again.', response.status)
  let body
  try { body = await response.json() } catch { throw new CloudBackupFailure('INVALID_RESPONSE', 'decode', 'Cloud backup response could not be read. Retry.', response.status) }
  requireCurrent(account)
  if (!body?.success) throw new CloudBackupFailure('READ_FAILED', 'response', 'Could not read cloud backup. Retry.', response.status)
  const record = body.cloudRecord as CloudSongbookRecord | null
  if (record === null) return null
  if (!record || !record.data || !Array.isArray(record.data.songs) || !Array.isArray(record.data.setlists)) throw new CloudBackupFailure('INVALID_PAYLOAD', 'verify', 'Cloud backup is invalid. Restore is unavailable.', response.status)
  if (record.userId !== undefined && record.userId !== account.userId) throw new CloudBackupFailure('ACCOUNT_MISMATCH', 'verify', 'Cloud backup account did not match. Sign in again.', response.status)
  const scheme = record.data.checksumScheme
  if (scheme !== undefined && scheme !== SONGBOOK_CHECKSUM_SCHEME) throw new CloudBackupFailure('UNKNOWN_CHECKSUM_SCHEME', 'verify', 'Unsupported cloud backup checksum scheme. Update GTAR before restoring.', response.status, scheme)
  let valid = false
  try { valid = verifySongbookChecksum(record) && (record.data.tagColors === undefined || validTagColors(record.data.tagColors)) } catch { /* Malformed payload fails closed. */ }
  if (!valid) throw new CloudBackupFailure('CHECKSUM_VERIFICATION_FAILED', 'verify', 'Cloud backup checksum verification failed. Restore is unavailable. Retry or use a verified backup file.', response.status, scheme)
  return record
}
export async function readCloudBackup(account: BackupAccount): Promise<CloudSongbookRecord | null> {
  try { return await fetchCloudBackup(account) }
  catch (error) {
    const failure = error instanceof CloudBackupFailure ? error : new CloudBackupFailure('READ_REQUEST_FAILED', 'request', 'Could not read cloud backup. Check your connection and retry.')
    logCloudBackupFailure('read', failure); throw failure
  }
}
export async function writeCloudBackup(account: BackupAccount, library: SyncLibrary, revision: Pick<CloudSongbookRecord, 'version' | 'checksum'> | null) {
  try {
    const checksum = computeSongbookChecksum(library)
    const response = await fetch('/api/songbook/sync', { method: 'POST', headers: headers(account), signal: AbortSignal.timeout(15000),
      body: songbookUploadBody('upload', library, checksum, revision?.version ?? 0, revision?.checksum ?? null) })
    requireCurrent(account)
    let body
    try { body = await response.json() } catch { throw new CloudBackupFailure('INVALID_RESPONSE', 'upload', 'Cloud backup response could not be read. Retry.', response.status, SONGBOOK_CHECKSUM_SCHEME) }
    requireCurrent(account)
    if (response.status === 409 && body?.code === 'SONGBOOK_REVISION_CONFLICT') throw new CloudBackupChanged()
    if (!response.ok || !body?.success) throw new CloudBackupFailure(
      response.status === 409 ? 'UPLOAD_REFUSED' : 'UPLOAD_HTTP_FAILED', 'upload',
      response.status === 409 ? 'Cloud upload refused. Reload GTAR and sign in again before retrying.' : 'Cloud backup failed. Retry.', response.status, SONGBOOK_CHECKSUM_SCHEME)
    const verified = await fetchCloudBackup(account)
    if (!verified || verified.checksum !== checksum || stableStringify(verified.data.tagColors) !== stableStringify(library.tagColors)) throw new CloudBackupFailure('UPLOAD_VERIFICATION_FAILED', 'readback', 'Cloud backup verification failed; cloud changed or upload was not saved', response.status, SONGBOOK_CHECKSUM_SCHEME)
    appLogger.info('BackupSaved', `Backup saved (cloud): ${library.songs.length} songs, ${library.setlists.length} setlists`)
    return verified
  } catch (error) {
    const failure = error instanceof CloudBackupFailure ? error : new CloudBackupFailure('UPLOAD_REQUEST_FAILED', 'request', 'Cloud backup failed. Check your connection and retry.', undefined, SONGBOOK_CHECKSUM_SCHEME)
    logCloudBackupFailure('backup', failure); throw failure
  }
}

async function applyCloudBackup(before: SyncLibrary, incoming: SyncLibrary, mode: 'replace' | 'merge', apply: (library: SyncLibrary) => void | Promise<void>, storage: Storage) {
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

export async function restoreCloudBackup(before: SyncLibrary, incoming: SyncLibrary, mode: 'replace' | 'merge', apply: (library: SyncLibrary) => void | Promise<void>, storage: Storage) {
  try { return await applyCloudBackup(before, incoming, mode, apply, storage) }
  catch (error) {
    const failure = new CloudBackupFailure('RESTORE_FAILED', 'restore', error instanceof Error ? error.message : 'Cloud restore failed.', undefined, (incoming as CloudSongbookRecord['data']).checksumScheme)
    logCloudBackupFailure('restore', failure); throw failure
  }
}
