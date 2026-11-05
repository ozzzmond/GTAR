import { stableStringify } from './contentHash'
import { validTagColors } from './songTags'
import { appLogger } from './logger'
import { ensureRestoreSafetySnapshot, libraryWritesSaved, verifyRestoredLibrary } from './backupExport'
import { parseBackupJson } from './jsonBackup'
import { GTAR_APP_VERSION, GTAR_DEV_VERSION, GTAR_DEV_PROVENANCE } from '../types/gtar'
import { isDevEnv } from './env'
import { computeSongbookChecksum, verifySongbookChecksum, songbookUploadBody, SONGBOOK_CHECKSUM_SCHEME, SETTINGS_CHECKSUM_SCHEME, SMART_SETTINGS_CHECKSUM_SCHEME, validateCloudBackupSettings, type CloudBackupData, type CloudSongbookRecord } from './cloudBackupFormat'
import { DEFAULT_THEME_MODE_ASSIGNMENTS, loadThemeModeAssignments, readBackupSettingsV2, restoreBackupSettingsV2, settingsFromLegacy, normalizeCloudThemeSettings, settingsSignature, inspectSettingsRecovery, type SettingsLockOptions, type SettingsRestoreChoice } from './backupSettings'
import type { SyncLibrary } from './syncMerge'
import { readPersistedLibrary } from './syncJournal'
export interface BackupAccount { token: string; userId: string; isCurrent?: () => boolean }
export function captureCloudBackup(library: SyncLibrary, storage: Pick<Storage, 'getItem'> = localStorage): CloudBackupData {
  const settings = readBackupSettingsV2(storage)
  delete settings.appearance.themeMode
  settings.appearance.themeModeAssignments = loadThemeModeAssignments(storage)
  return { songs: library.songs, setlists: library.setlists, ...(library.folders !== undefined ? { folders: library.folders } : {}),
    ...(library.tagColors !== undefined ? { tagColors: library.tagColors } : {}),
    settingsSchemaVersion: 3, settings, checksumScheme: SMART_SETTINGS_CHECKSUM_SCHEME }
}
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
    scheme: failure?.scheme === SMART_SETTINGS_CHECKSUM_SCHEME ? SMART_SETTINGS_CHECKSUM_SCHEME : failure?.scheme === SETTINGS_CHECKSUM_SCHEME ? SETTINGS_CHECKSUM_SCHEME : failure?.scheme === SONGBOOK_CHECKSUM_SCHEME ? SONGBOOK_CHECKSUM_SCHEME : failure?.scheme === undefined ? 'unversioned' : 'unknown' }))
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
  if (scheme !== undefined && scheme !== SONGBOOK_CHECKSUM_SCHEME && scheme !== SETTINGS_CHECKSUM_SCHEME && scheme !== SMART_SETTINGS_CHECKSUM_SCHEME) throw new CloudBackupFailure('UNKNOWN_CHECKSUM_SCHEME', 'verify', 'Unsupported cloud backup checksum scheme. Update GTAR before restoring.', response.status, scheme)
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
export async function writeCloudBackup(account: BackupAccount, library: CloudBackupData, revision: Pick<CloudSongbookRecord, 'version' | 'checksum'> | null) {
  try {
    const errors = validateCloudBackupSettings(library)
    if (errors.length) throw new Error(errors.join('; '))
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
    if (!verified || verified.checksum !== checksum || stableStringify(verified.data.tagColors) !== stableStringify(library.tagColors) || stableStringify(verified.data.settings) !== stableStringify(library.settings)) throw new CloudBackupFailure('UPLOAD_VERIFICATION_FAILED', 'readback', 'Cloud backup verification failed; cloud changed or upload was not saved', response.status, SONGBOOK_CHECKSUM_SCHEME)
    appLogger.info('BackupSaved', `Backup saved (cloud): ${library.songs.length} songs, ${library.setlists.length} setlists`)
    return verified
  } catch (error) {
    const failure = error instanceof CloudBackupFailure ? error : new CloudBackupFailure('UPLOAD_REQUEST_FAILED', 'request', 'Cloud backup failed. Check your connection and retry.', undefined, SONGBOOK_CHECKSUM_SCHEME)
    logCloudBackupFailure('backup', failure); throw failure
  }
}

/** Historical themes are appearance only; omitted groups never clear device values. */
export function cloudBackupSettings(incoming: CloudBackupData) {
  const errors = validateCloudBackupSettings(incoming)
  if (errors.length) throw new Error(errors.join('; '))
  const settings = incoming.settings ?? (incoming.themeSettings === undefined ? { appearance: {}, preferences: {} }
    : settingsFromLegacy(normalizeCloudThemeSettings(incoming.themeSettings))
  )
  // Defaults apply only during a confirmed legacy appearance restore, never during verification.
  return Object.keys(settings.appearance ?? {}).length && !settings.appearance.themeModeAssignments
    ? { ...settings, appearance: { ...settings.appearance, themeModeAssignments: { ...DEFAULT_THEME_MODE_ASSIGNMENTS } } }
    : settings
}
export interface CloudRestoreOptions extends SettingsLockOptions {
  account?: BackupAccount
  expectedSettingsSignature?: string | null
  choice?: SettingsRestoreChoice
}
async function applyCloudBackup(before: SyncLibrary, incoming: CloudBackupData, mode: 'replace' | 'merge', apply: (library: SyncLibrary) => void | Promise<void>, storage: Storage, options: CloudRestoreOptions) {
  const settings = cloudBackupSettings(incoming)
  const parsed = parseBackupJson(JSON.stringify({ ...incoming, schemaVersion: 2, settings }), mode === 'merge' ? { mode, existingSongs: before.songs } : undefined)
  if (!parsed.isValid) throw new Error(parsed.error || 'Invalid cloud backup')
  const choice = options.choice ?? { appearance: true, preferences: true }
  const hasSettings = (choice.appearance && Object.keys(settings.appearance ?? {}).length > 0) ||
    (choice.preferences && Object.keys(settings.preferences ?? {}).length > 0)
  const signature = options.expectedSettingsSignature === undefined ? settingsSignature(storage) : options.expectedSettingsSignature
  const guard = () => {
    if (options.account) requireCurrent(options.account)
    if (signature === null || settingsSignature(storage) !== signature) throw new Error('Device settings changed. Review and confirm again.')
  }
  guard()
  if (hasSettings && inspectSettingsRecovery(storage).state !== 'none') throw new Error('Resolve the previous settings recovery in This device (file) before restoring settings. Nothing was changed.')
  const library = { ...(parsed.tagColors !== undefined ? { tagColors: parsed.tagColors } : {}), songs: parsed.songs, setlists: parsed.setlists, ...(parsed.folders !== undefined ? { folders: parsed.folders } : {}) }
  try { await ensureRestoreSafetySnapshot(before, storage) }
  catch (error) { throw new Error(`Restore aborted: safety snapshot failed to save (${error instanceof Error ? error.message : String(error)}). Device library preserved.`, { cause: error }) }
  guard()
  if (JSON.stringify(readPersistedLibrary(storage)) !== JSON.stringify(before)) throw new Error('Device library changed while saving the safety snapshot. Restore aborted; review again.')
  await apply(library)
  const problems = [...await libraryWritesSaved(), ...verifyRestoredLibrary(before, library, mode, storage)]
  if (problems.length) throw new Error(`Restore could not be verified: ${problems.join('; ')}. Settings were not changed. Previous library is kept in the safety snapshot.`)
  try {
    guard()
    const result = await restoreBackupSettingsV2(settings, choice, storage, { locks: options.locks, beforeWrite: guard })
    if (result.recoveryCopy && result.recoveryCopy !== 'removed') throw new Error('Settings saved and verified, but the previous-settings copy is still kept. Review it in This device (file).')
  } catch (error) {
    throw new Error(`Library restored and verified; settings restore did not complete: ${error instanceof Error ? error.message : String(error)}. Previous library is kept in the safety snapshot. Review settings recovery in This device (file).`, { cause: error })
  }
  appLogger.info('RestoreApplied', `Restore applied (${mode}, cloud): ${library.songs.length} songs, ${library.setlists.length} setlists`)
}

export async function restoreCloudBackup(before: SyncLibrary, incoming: CloudBackupData, mode: 'replace' | 'merge', apply: (library: SyncLibrary) => void | Promise<void>, storage: Storage, options: CloudRestoreOptions = {}) {
  try { return await applyCloudBackup(before, incoming, mode, apply, storage, options) }
  catch (error) {
    const failure = new CloudBackupFailure('RESTORE_FAILED', 'restore', error instanceof Error ? error.message : 'Cloud restore failed.', undefined, incoming.checksumScheme)
    logCloudBackupFailure('restore', failure); throw failure
  }
}
