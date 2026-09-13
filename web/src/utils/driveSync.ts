import { parseBackupJson, type FullBackupPayload, type ParsedBackupResult } from './jsonBackup'

const API = 'https://www.googleapis.com/drive/v3/files'
const NAME = 'gtar_songbook_sync.json'
const FIELDS = 'id,name,version,modifiedTime,md5Checksum'
export class DriveSyncError extends Error {
  status: number
  isDriveQuota?: boolean
  constructor(message: string, status = 0, isDriveQuota = false) {
    super(message)
    this.status = status
    this.isDriveQuota = isDriveQuota
  }
}
export interface SyncFile { id: string; name?: string; version?: string; modifiedTime?: string; md5Checksum?: string }
function revision(file: SyncFile): string {
  for (const key of ['version', 'modifiedTime', 'md5Checksum'] as const) {
    if (typeof file[key] === 'string' && file[key]) return `${key}:${file[key]}`
  }
  throw new DriveSyncError('Drive metadata has no revision. Try Sync Now again.')
}
function sameFile(a: SyncFile | null, b: SyncFile | null): boolean {
  return a && b ? a.id === b.id && revision(a) === revision(b) : a === b
}
async function getMetadata(token: string, id: string): Promise<SyncFile> {
  return (await request(token, `${API}/${encodeURIComponent(id)}?${new URLSearchParams({ fields: FIELDS })}`)).json()
}
interface Snapshot { parents: string[] }
const snapshots = new Map<string, Snapshot>()
const REVISION_NAME = 'gtar_songbook_revision_v1.json'
export function clearDriveSession(token: string) { snapshots.delete(token) }
async function request(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) {
    if (response.status === 401) {
      throw new DriveSyncError('Google session expired. Sign in again.', 401)
    }
    if (response.status === 412) {
      throw new DriveSyncError('Cloud changed during sync. Try Sync Now again.', 412)
    }
    let errorDetail = ''
    try {
      const text = await response.text()
      try {
        const errJson = JSON.parse(text)
        if (errJson?.error?.message) errorDetail = String(errJson.error.message)
        const reason = errJson?.error?.errors?.[0]?.reason
        if (reason === 'storageQuotaExceeded' || errJson?.error?.code === 507) {
          throw new DriveSyncError('Google Drive storage quota exceeded. Free up space in your Google Drive account.', response.status, true)
        }
        if (reason === 'quotaExceeded' || reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded') {
          throw new DriveSyncError('Google Drive API quota limit reached. Try again later.', response.status, true)
        }
      } catch (inner) {
        if (inner instanceof DriveSyncError) throw inner
        if (text) errorDetail = text
      }
    } catch (e) {
      if (e instanceof DriveSyncError) throw e
    }
    if (response.status === 429) {
      throw new DriveSyncError('Google Drive rate limit exceeded. Try again later.', 429, true)
    }
    if (response.status === 507) {
      throw new DriveSyncError('Google Drive storage quota exceeded. Free up space in your Google Drive account.', 507, true)
    }
    if (response.status === 403 && /quota/i.test(errorDetail)) {
      throw new DriveSyncError(`Google Drive quota exceeded: ${errorDetail}`, 403, true)
    }
    throw new DriveSyncError(`Drive request failed (${response.status}). Local changes are saved.`, response.status)
  }
  return response
}
async function findSyncFiles(token: string): Promise<SyncFile[]> {
  const files: SyncFile[] = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ spaces: 'appDataFolder', q: `(name = '${NAME}' or name = '${REVISION_NAME}') and trashed = false`, fields: `files(${FIELDS}),nextPageToken`, pageSize: '100', ...(pageToken ? { pageToken } : {}) })
    const data = await (await request(token, `${API}?${query}`)).json()
    if (!Array.isArray(data.files)) throw new DriveSyncError('Invalid Drive file listing.')
    files.push(...data.files)
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return files
}
const fileKey = (file: SyncFile) => `${file.id}@${revision(file)}`
async function readCloudState(token: string, resolveAll = false): Promise<ParsedBackupResult | null> {
  snapshots.delete(token)
  const files = await findSyncFiles(token)
  const records = []
  for (const file of files) {
    const response = await request(token, `${API}/${encodeURIComponent(file.id)}?alt=media`)
    const raw = await response.text()
    const parsed = parseBackupJson(raw)
    if (!parsed.isValid || parsed.isSingleSetlist) throw new DriveSyncError(parsed.error ?? 'Expected a full library backup.')
    const envelope = JSON.parse(raw)
    const parents: unknown = envelope.syncParents ?? []
    if (file.name === REVISION_NAME && (envelope.syncProtocol !== 1 || !Array.isArray(parents) || parents.some(p => typeof p !== 'string'))) throw new DriveSyncError('Unsupported cloud revision; no data changed.')
    const after = await getMetadata(token, file.id)
    if (!sameFile(after, file)) throw new DriveSyncError('Cloud changed while downloading. Try Sync Now again.')
    records.push({ key: fileKey(file), parsed, parents: file.name === REVISION_NAME ? parents as string[] : [] })
  }
  const superseded = new Set(records.flatMap(record => record.parents))
  const heads = records.filter(record => !superseded.has(record.key))
  if (records.length && !heads.length) throw new DriveSyncError('Invalid cloud revision history. Sync stopped.')
  const allIdentical = heads.length <= 1 || heads.every(h =>
    JSON.stringify(h.parsed.songs) === JSON.stringify(heads[0].parsed.songs) &&
    JSON.stringify(h.parsed.setlists) === JSON.stringify(heads[0].parsed.setlists)
  )
  if (resolveAll || allIdentical) {
    snapshots.set(token, { parents: heads.map(head => head.key) })
  } else {
    // Do not blindly acknowledge divergent cloud heads while only selecting heads[0].
    // Preserve competing versions so divergent edits are not silently lost.
    snapshots.set(token, { parents: [heads[0].key] })
  }
  return heads[0]?.parsed ?? null
}
export async function pullCloudBackup(token: string) { return readCloudState(token, false) }
/** Only call after the user has explicitly selected a reconciled device library. */
export async function prepareCloudResolution(token: string) { await readCloudState(token, true) }
export async function pushCloudBackup(token: string, payload: FullBackupPayload): Promise<void> {
  const parsed = parseBackupJson(JSON.stringify(payload))
  if (!parsed.isValid || parsed.isSingleSetlist) throw new DriveSyncError(parsed.error ?? 'Invalid backup')
  const snapshot = snapshots.get(token)
  if (!snapshot) throw new DriveSyncError('Download and validate the cloud backup before uploading.')
  const boundary = `gtar_${crypto.randomUUID()}`
  const metadata: Record<string, unknown> = {
    name: REVISION_NAME,
    parents: ['appDataFolder'],
    ...(payload.allowedUsers && Array.isArray(payload.allowedUsers)
      ? { appProperties: { allowedUsers: JSON.stringify(payload.allowedUsers) } }
      : {})
  }
  const revisionPayload = {
    ...payload,
    syncProtocol: 1,
    syncParents: snapshot.parents,
    ...(payload.allowedUsers && Array.isArray(payload.allowedUsers) ? { allowedUsers: payload.allowedUsers } : {})
  }
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(revisionPayload)}\r\n--${boundary}--`
  snapshots.delete(token)
  // Create-only protocol: neither ETag availability nor a preflight read guards a
  // shared write. Every writer retains its own immutable file, including retries.
  const response = await request(token, `https://www.googleapis.com/upload/drive/v3/files?${new URLSearchParams({ uploadType: 'multipart', fields: FIELDS })}`, {
    method: 'POST', body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
  })
  const uploaded: SyncFile = await response.json()
  if (!uploaded.id) throw new DriveSyncError('Unexpected upload metadata. Pull again before uploading.')
  revision(uploaded)
}

/** Query and retrieve dynamic allowed users whitelist from the cloud sync files */
export async function pullCloudWhitelist(token: string): Promise<string[] | null> {
  try {
    const files = await findSyncFiles(token)
    if (!files.length) return null
    for (const file of files) {
      try {
        const response = await request(token, `${API}/${encodeURIComponent(file.id)}?alt=media`)
        const raw = await response.text()
        const parsed = parseBackupJson(raw)
        if (parsed.isValid && Array.isArray(parsed.allowedUsers) && parsed.allowedUsers.length > 0) {
          return parsed.allowedUsers
        }
      } catch {
        // Fallback to checking next revision file
      }
    }
    return null
  } catch {
    return null
  }
}

/** Download every retained revision for manual recovery, including conflicting heads. */
export async function readCloudRecovery(token: string) {
  const revisions = []
  for (const file of await findSyncFiles(token)) {
    const raw = await (await request(token, `${API}/${encodeURIComponent(file.id)}?alt=media`)).text()
    revisions.push({ file, raw })
  }
  return revisions
}
