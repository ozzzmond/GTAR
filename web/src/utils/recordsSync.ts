/**
 * RFC #188 S5: client side of per-record songbook sync (`/api/songbook/records`).
 *
 * The device remembers, per record, the server revision and checksum it last agreed on
 * (`known`). From that:
 * - a remote change to a record this device has not edited since is applied (fast-forward);
 * - a remote change to a record this device has also edited is a conflict: the local copy is
 *   kept, nothing is merged automatically, and the user chooses later;
 * - local edits are pushed with their base revision; the server rejects stale ones (conflict).
 * No last-write-wins anywhere. Replacing local data on a user's choice keeps a recovery snapshot.
 * The local library stays the source of truth on the device: every change goes through
 * persistLibrary() with the revision gate, so another tab or the editor is never overwritten.
 */
import { isDevEnv } from './env'
import { appLogger } from './logger'
import {
  libraryRevision,
  persistLibrary,
  RECORDS_DELETE_HOLD_KEY,
  recordsDeleteHoldActive,
  readPersistedLibrary,
  restoreLibraryRevision,
  setLastKnownPersistedLibraryRaw,
  validateLibrary,
  writeRecoverySnapshot,
} from './syncJournal'
import { normalizeSongbookIds, validateSongbookIntegrity } from './songbookFoundation'
import { normalizeCloudThemeSettings, persistCloudThemeSettings, readCloudThemeSettings, type CloudThemeSettings } from './backupSettings'
import {
  computeSongbookChecksum,
  performCloudSongbookSync,
  readCloudSyncMeta,
  saveCloudSyncBase,
  saveCloudSyncMeta,
  type CloudSyncResult,
  type ConflictingItem,
} from './cloudSongbookSync'
import {
  MAX_PUSH_CHANGES,
  libraryToRecords,
  recordChecksum,
  recordKey,
  type PullResponse,
  type PushResponse,
  type RecordChange,
  type RecordKind,
  type ServerRecord,
} from './songbookRecords'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'
import { generateUUID } from './uuid'

export const RECORDS_SYNC_STATE_KEY = 'gtar_records_sync_v1'
/** '1' = per-record sync on, '0' = off. Unset = the DEV default (see isRecordsSyncEnabled). */
export const RECORDS_SYNC_TOGGLE_KEY = 'gtar_records_sync_enabled'
/** RFC #188 S7: per-record sync is the default on DEV; '0' turns it off per device. PROD never runs it. */
export const RECORDS_SYNC_DEFAULT_ON = true
const REMOVED = recordChecksum(true, null)
export const RECORDS_SYNC_RUN_LOCK = 'gtar-records-sync-run'
/** Last answer from the server about per-record sync on this device: 'off' = classic fallback in use. */
export const RECORDS_SERVER_STATE_KEY = 'gtar_records_sync_server'
export function isRecordsServerUnavailable(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try { return storage.getItem(RECORDS_SERVER_STATE_KEY) === 'off' } catch { return false }
}
function markRecordsServer(state: 'on' | 'off', storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  try {
    const changed = storage.getItem(RECORDS_SERVER_STATE_KEY) !== state
    storage.setItem(RECORDS_SERVER_STATE_KEY, state)
    return changed
  } catch { return false }
}
const REQUEST_TIMEOUT_MS = 15000
const MAX_PULL_PAGES = 500

interface KnownRecord { rev: number; checksum: string }
export interface RecordConflict { kind: RecordKind; id: string; title: string; remote: ServerRecord | null }
interface RecordsSyncState { v: 1; userId: string | null; cursor: number; known: Record<string, KnownRecord>; conflicts: RecordConflict[] }

const emptyState = (userId: string | null = null): RecordsSyncState => ({ v: 1, userId, cursor: 0, known: {}, conflicts: [] })

export function isRecordsSyncEnabled(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  if (!isDevEnv) return false
  try {
    const value = storage.getItem(RECORDS_SYNC_TOGGLE_KEY)
    return value === null ? RECORDS_SYNC_DEFAULT_ON : value === '1'
  } catch { return false }
}
export function setRecordsSyncEnabled(enabled: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(RECORDS_SYNC_TOGGLE_KEY, enabled ? '1' : '0')
}

export function readRecordsSyncState(storage: Pick<Storage, 'getItem'> = localStorage): RecordsSyncState {
  try {
    const value = JSON.parse(storage.getItem(RECORDS_SYNC_STATE_KEY) ?? 'null')
    if (value && value.v === 1 && typeof value.cursor === 'number' && value.known && typeof value.known === 'object' && Array.isArray(value.conflicts)) return value
  } catch { /* unreadable state: start over, which is safe (everything re-checks by checksum) */ }
  return emptyState()
}
function saveState(state: RecordsSyncState, storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(RECORDS_SYNC_STATE_KEY, JSON.stringify(state))
}
export function pendingRecordConflicts(storage: Pick<Storage, 'getItem'> = localStorage): RecordConflict[] {
  return readRecordsSyncState(storage).conflicts
}

class RecordsSyncDisabledError extends Error {}
/** Why the server last said per-record sync is off (for the debug log). */
let lastDisabledReason: string | null = null
let loggedDisabledReason: string | null | undefined
class RecordsHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request<T>(token: string, method: 'GET' | 'POST', query: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/songbook/records${query}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  let json: (T & { success?: boolean; code?: string; error?: string }) | null = null
  try { json = await res.json() } catch { /* handled below */ }
  if (res.status === 404 && json?.code === 'RECORDS_SYNC_DISABLED') {
    const info = json as { reason?: string; latestMigration?: string | null }
    throw new RecordsSyncDisabledError(info.reason === 'tables'
      ? `database has no per-record tables (newest migration: ${info.latestMigration ?? 'unknown'})`
      : 'not enabled for this host')
  }
  if (!res.ok || !json || json.success === false) throw new RecordsHttpError(res.status, json?.error || `Request failed (${res.status})`)
  return json
}

interface LocalView { library: SyncLibrary; raw: string | null }
function readLocal(storage: Storage): LocalView {
  const raw = libraryRevision(storage)
  const persisted = readPersistedLibrary(storage)
  if (!persisted) throw new Error('No local songbook library available to sync')
  const theme = readCloudThemeSettings(storage)
  const normalized = normalizeSongbookIds(persisted.songs, persisted.setlists)
  return { raw, library: { songs: normalized.songs, setlists: normalized.setlists, ...(theme !== undefined ? { themeSettings: theme } : {}) } }
}

function recordTitle(kind: RecordKind, data: unknown): string {
  if (kind === 'theme') return 'Theme settings'
  const value = (data ?? {}) as { title?: string; name?: string }
  return (kind === 'song' ? value.title : value.name) || '(untitled)'
}

/** Mutable view of a library keyed by record, keeping the original order. */
class Working {
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  theme: CloudThemeSettings | undefined
  constructor(library: SyncLibrary) {
    this.songs = [...library.songs]
    this.setlists = [...library.setlists]
    this.theme = library.themeSettings
  }
  library(): SyncLibrary {
    return { songs: this.songs, setlists: this.setlists, ...(this.theme !== undefined ? { themeSettings: this.theme } : {}) }
  }
  apply(record: { kind: RecordKind; id: string; removed: boolean; data: unknown }): void {
    if (record.kind === 'theme') { this.theme = record.removed ? undefined : normalizeCloudThemeSettings(record.data as CloudThemeSettings); return }
    const list = (record.kind === 'song' ? this.songs : this.setlists) as Array<{ id?: string | number }>
    const index = list.findIndex(item => String(item.id) === record.id)
    if (record.removed) { if (index >= 0) list.splice(index, 1); return }
    if (index >= 0) list[index] = record.data as never
    else list.push(record.data as never)
  }
}

/** Current local records, keyed. */
function localRecords(library: SyncLibrary): Map<string, { kind: RecordKind; id: string; data: unknown; checksum: string }> {
  const map = new Map<string, { kind: RecordKind; id: string; data: unknown; checksum: string }>()
  for (const record of libraryToRecords(library)) map.set(recordKey(record.kind, record.id), { ...record, checksum: recordChecksum(false, record.data) })
  return map
}

/** Persists the library (revision-gated) and theme together; restores the library if the theme write fails. */
function persistApplied(storage: Storage, before: LocalView, next: SyncLibrary): void {
  const integrity = validateSongbookIntegrity(next.songs, next.setlists)
  if (!integrity.isValid) throw new Error(`Synced songbook failed referential integrity check: ${integrity.errors.join('; ')}`)
  const { themeSettings, ...library } = next
  persistLibrary(library, storage, { expectedRaw: before.raw })
  const themeChanged = themeSettings !== undefined && JSON.stringify(themeSettings) !== JSON.stringify(before.library.themeSettings)
  if (themeChanged) {
    try { persistCloudThemeSettings(themeSettings, storage) } catch (error) {
      try { restoreLibraryRevision(before.raw, storage); setLastKnownPersistedLibraryRaw(before.raw, storage) } catch { /* best effort */ }
      throw error
    }
  }
}

function conflictItems(conflicts: RecordConflict[]): ConflictingItem[] {
  return conflicts.map(conflict => ({ id: conflict.id, type: conflict.kind, title: conflict.title,
    reason: conflict.remote === null ? 'Missing in the cloud' : conflict.remote.removed ? 'Removed in the cloud, edited here' : 'Edited here and in the cloud' }))
}

function finish(storage: Storage, state: RecordsSyncState, library: SyncLibrary, applied: number, pushed: number, pushFailed: string | null): CloudSyncResult {
  saveState(state, storage)
  const fullySynced = state.conflicts.length === 0 && !pushFailed
  if (fullySynced) {
    // Keep the classic sync metadata coherent: the header status and a fallback to /api/songbook/sync rely on it.
    const meta = readCloudSyncMeta(storage)
    saveCloudSyncMeta({ lastSyncedChecksum: computeSongbookChecksum(library), lastSyncedAt: Date.now(), cloudVersion: meta.cloudVersion, lastSyncedUserId: state.userId }, storage)
    saveCloudSyncBase(library, storage)
  }
  const actionTaken: CloudSyncResult['actionTaken'] = state.conflicts.length ? 'CONFLICT_DETECTED'
    : applied && pushed ? 'MERGED' : applied ? 'DOWNLOADED' : pushed ? 'UPLOADED' : 'NONE'
  return {
    success: fullySynced,
    status: state.conflicts.length ? 'CONFLICT' : pushFailed ? 'ERROR' : 'IN_SYNC',
    state: state.conflicts.length ? 'CONFLICT' : pushFailed ? 'OFFLINE_OR_CLOUD_FAILURE' : 'SAME_STATE',
    actionTaken,
    checksum: computeSongbookChecksum(library),
    ...(applied ? { updatedLibrary: library } : {}),
    ...(state.conflicts.length ? { conflicts: conflictItems(state.conflicts),
      error: 'Some songs or setlists were edited here and in the cloud. Your edits are kept on this device. Export a backup, then choose how to resolve.' } : {}),
    ...(pushFailed ? { error: pushFailed } : {}),
  }
}

async function pullAll(token: string, state: RecordsSyncState): Promise<{ records: Map<string, ServerRecord>; state: RecordsSyncState }> {
  let current = state
  for (let attempt = 0; attempt < 2; attempt++) {
    const latest = new Map<string, ServerRecord>()
    let cursor = current.cursor
    let accountChanged = false
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const response = await request<PullResponse & { userId: string }>(token, 'GET', `?since=${cursor}`)
      if (current.userId !== response.userId) {
        if (current.userId !== null || Object.keys(current.known).length) { accountChanged = true; current = emptyState(response.userId); break }
        current = { ...current, userId: response.userId }
      }
      for (const record of response.records) latest.set(recordKey(record.kind, record.id), record)
      cursor = response.cursor
      if (!response.more) return { records: latest, state: { ...current, cursor } }
    }
    if (!accountChanged) throw new Error('Cloud change feed did not finish')
  }
  throw new Error('Cloud account changed during sync')
}

async function pushAll(token: string, state: RecordsSyncState, library: SyncLibrary, skip: Set<string>, force: Map<string, number> = new Map(),
  allowRemovals = true): Promise<{ pushed: number; failed: string | null }> {
  const local = localRecords(library)
  const changes: RecordChange[] = []
  for (const [key, record] of local) {
    if (skip.has(key)) continue
    const known = state.known[key]
    const baseRev = force.get(key) ?? known?.rev ?? 0
    if (!force.has(key) && known?.checksum === record.checksum) continue
    changes.push({ kind: record.kind, id: record.id, baseRev, data: record.data })
  }
  for (const [key, known] of Object.entries(state.known)) {
    // #208 F1: never send a deletion inferred from a library restored from an older copy.
    if (!allowRemovals) break
    if (local.has(key) || skip.has(key) || known.checksum === REMOVED) continue
    const [kind, ...rest] = key.split(':')
    changes.push({ kind: kind as RecordKind, id: rest.join(':'), baseRev: force.get(key) ?? known.rev, removed: true })
  }
  let pushed = 0
  for (let i = 0; i < changes.length; i += MAX_PUSH_CHANGES) {
    const batch = changes.slice(i, i + MAX_PUSH_CHANGES)
    let response: PushResponse
    try { response = await request<PushResponse>(token, 'POST', '', { changes: batch }) } catch (error) {
      if (error instanceof RecordsSyncDisabledError) throw error
      return { pushed, failed: `Cloud upload stopped: ${error instanceof Error ? error.message : String(error)}. Local edits are kept; sync again later.` }
    }
    for (const accepted of response.accepted) {
      state.known[recordKey(accepted.kind, accepted.id)] = { rev: accepted.rev, checksum: accepted.checksum }
      pushed++
    }
    for (const conflict of response.conflicts) {
      const key = recordKey(conflict.kind, conflict.id)
      const mine = local.get(key)
      state.conflicts = [...state.conflicts.filter(item => recordKey(item.kind, item.id) !== key),
        { kind: conflict.kind, id: conflict.id, title: recordTitle(conflict.kind, mine?.data ?? conflict.current?.data), remote: conflict.current }]
    }
    if (response.mirror === 'skipped-size') appLogger.warn('RecordsSync', 'Cloud copy for older clients not updated: songbook over 2 MB')
  }
  return { pushed, failed: null }
}

/**
 * One sync round: pull every remote change since the checkpoint, fast-forward unedited records,
 * queue conflicts, then push local edits. Throws RecordsSyncDisabledError when the server flag is off.
 */
async function syncOnce(token: string, storage: Storage): Promise<CloudSyncResult> {
  const before = readLocal(storage)
  // #208 F1: after a storage fallback, read the whole feed so every record missing here can be restored.
  const hold = recordsDeleteHoldActive(storage)
  const saved = readRecordsSyncState(storage)
  const pulled = await pullAll(token, hold ? { ...saved, cursor: 0 } : saved)
  const state = pulled.state
  const working = new Working(before.library)
  const local = localRecords(before.library)
  let applied = 0
  let restored = 0

  for (const [key, remote] of pulled.records) {
    const known = state.known[key]
    const mine = local.get(key)
    if (hold && !mine && known && !remote.removed) {
      // Known record missing from the fallback copy: bring the cloud version back, do not delete it.
      working.apply(remote)
      state.known[key] = { rev: remote.rev, checksum: remote.checksum }
      state.conflicts = state.conflicts.filter(item => recordKey(item.kind, item.id) !== key)
      applied++
      restored++
      continue
    }
    const mineChecksum = mine ? mine.checksum : REMOVED
    if (mineChecksum === remote.checksum) {
      state.known[key] = { rev: remote.rev, checksum: remote.checksum }
      state.conflicts = state.conflicts.filter(item => recordKey(item.kind, item.id) !== key)
      continue
    }
    const editedHere = known ? mineChecksum !== known.checksum : mine !== undefined
    if (!editedHere) {
      working.apply(remote)
      state.known[key] = { rev: remote.rev, checksum: remote.checksum }
      applied++
      continue
    }
    state.conflicts = [...state.conflicts.filter(item => recordKey(item.kind, item.id) !== key),
      { kind: remote.kind, id: remote.id, title: recordTitle(remote.kind, mine?.data ?? remote.data), remote }]
  }

  const next = working.library()
  if (applied) persistApplied(storage, before, next)
  // Conflicted records are not pushed until the user decides.
  const skip = new Set(state.conflicts.map(item => recordKey(item.kind, item.id)))
  const { pushed, failed } = await pushAll(token, state, next, skip, new Map(), !hold)
  if (hold && !failed) {
    try { storage.removeItem(RECORDS_DELETE_HOLD_KEY) } catch { /* stays on; next sync repeats the safe path */ }
    appLogger.warn('RecordsSync', `Storage fallback recovered: ${restored} ${restored === 1 ? 'record' : 'records'} restored from the cloud; no cloud deletes sent`)
  }
  return finish(storage, state, next, applied, pushed, failed)
}

export type ConflictChoice = 'keep-local' | 'use-cloud' | 'keep-both'

/** Resolves every queued conflict the same way, after saving a recovery snapshot of both sides. */
async function resolveOnce(token: string, storage: Storage, choice: ConflictChoice): Promise<CloudSyncResult> {
  const state = readRecordsSyncState(storage)
  if (!state.conflicts.length) return syncOnce(token, storage)
  const before = readLocal(storage)
  const working = new Working(before.library)
  const cloudView = new Working(before.library)
  for (const conflict of state.conflicts) if (conflict.remote) cloudView.apply(conflict.remote)

  // Both versions stay recoverable whatever the choice.
  const snapshot: { local: SyncLibrary; remote?: SyncLibrary } = { local: before.library }
  try { validateLibrary(cloudView.library()); snapshot.remote = cloudView.library() } catch { /* cloud side alone is not a complete library */ }
  await writeRecoverySnapshot(`gtar_sync_recovery:records:${Date.now()}:${generateUUID()}`, JSON.stringify(snapshot), storage)

  const force = new Map<string, number>()
  let applied = 0
  for (const conflict of state.conflicts) {
    const key = recordKey(conflict.kind, conflict.id)
    const remote = conflict.remote
    if (choice === 'use-cloud') {
      if (remote) { working.apply(remote); state.known[key] = { rev: remote.rev, checksum: remote.checksum } }
      else delete state.known[key]
      applied++
    } else {
      // Local copy wins this record; the cloud copy is replaced (keep-local) or kept as a copy (keep-both).
      force.set(key, remote?.rev ?? 0)
      if (choice === 'keep-both' && remote && !remote.removed && conflict.kind !== 'theme') {
        const copyId = generateUUID()
        const original = remote.data as { title?: string; name?: string }
        const copy = conflict.kind === 'song'
          ? { ...(remote.data as ActiveSongState), id: copyId, title: `${original.title ?? 'Song'} (cloud copy)` }
          : { ...(remote.data as WebSetlist), id: copyId, name: `${original.name ?? 'Setlist'} (cloud copy)` }
        working.apply({ kind: conflict.kind, id: copyId, removed: false, data: copy })
        applied++
      }
    }
  }
  state.conflicts = []
  const next = working.library()
  if (applied) persistApplied(storage, before, next)
  const { pushed, failed } = await pushAll(token, state, next, new Set(), force, !recordsDeleteHoldActive(storage))
  return finish(storage, state, next, applied, pushed, failed)
}

/** Replaces the whole device library with the cloud records (explicit "Download from Cloud"). */
async function replaceWithCloud(token: string, storage: Storage): Promise<CloudSyncResult> {
  const before = readLocal(storage)
  const pulled = await pullAll(token, emptyState())
  const state = pulled.state
  const working = new Working({ songs: [], setlists: [] })
  for (const [key, remote] of pulled.records) {
    working.apply(remote)
    state.known[key] = { rev: remote.rev, checksum: remote.checksum }
  }
  const next = working.library()
  await writeRecoverySnapshot(`gtar_sync_recovery:download:${Date.now()}:${generateUUID()}`, JSON.stringify({ local: before.library, remote: next }), storage)
  persistApplied(storage, before, next)
  return finish(storage, state, next, 1, 0, null)
}

/**
 * Entry point used by performCloudSongbookSync when per-record sync is on.
 * Returns null when the server has the feature off, so the caller uses the classic sync.
 * forceAction maps the existing dialog buttons: upload = keep this device's versions,
 * download = use the cloud's, merge_preserve = keep both (cloud copies).
 */
export async function performRecordsSync(token: string, options: { forceAction?: 'upload' | 'download' | 'merge_preserve'; storage?: Storage } = {}): Promise<CloudSyncResult | null> {
  // One records sync at a time across this browser's tabs (manual and automatic).
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks?.request) return locks.request(RECORDS_SYNC_RUN_LOCK, () => runRecordsSync(token, options))
  return runRecordsSync(token, options)
}

async function runRecordsSync(token: string, options: { forceAction?: 'upload' | 'download' | 'merge_preserve'; storage?: Storage }): Promise<CloudSyncResult | null> {
  const storage = options.storage ?? localStorage
  try {
    if (!options.forceAction) return await syncOnce(token, storage)
    const hasConflicts = readRecordsSyncState(storage).conflicts.length > 0
    if (options.forceAction === 'download') return hasConflicts ? await resolveOnce(token, storage, 'use-cloud') : await replaceWithCloud(token, storage)
    return await resolveOnce(token, storage, options.forceAction === 'upload' ? 'keep-local' : 'keep-both')
  } catch (error) {
    if (error instanceof RecordsSyncDisabledError) { lastDisabledReason = error.message || null; return null }
    const status = error instanceof RecordsHttpError ? error.status : 0
    appLogger.warn('RecordsSync', 'Per-record sync did not finish', error instanceof Error ? error.message : String(error))
    return {
      success: false,
      status: status === 401 || status === 403 ? 'ERROR' : status === 0 ? 'OFFLINE' : 'ERROR',
      state: 'OFFLINE_OR_CLOUD_FAILURE',
      actionTaken: 'NONE',
      error: status === 401 ? 'Session expired or unauthorized. Please sign in again.'
        : `${error instanceof Error ? error.message : String(error)}. Local edits are kept on this device.`,
    }
  }
}

/**
 * The dialog's sync call: per-record sync when it is on for this device and on the server,
 * otherwise the classic whole-songbook sync. Classic sync is never mixed into a records round.
 */
export async function performSongbookSync(token: string, options: { forceAction?: 'upload' | 'download' | 'merge_preserve'; storage?: Storage } = {}): Promise<CloudSyncResult> {
  const storage = options.storage ?? localStorage
  if (isRecordsSyncEnabled(storage)) {
    const result = await performRecordsSync(token, options)
    if (result) { markRecordsServer('on', storage); return result }
    // Logged once when it changes, not on every sync.
    // Logged when the state or the reason changes (once per page for a given reason), not on every sync.
    if (markRecordsServer('off', storage) || loggedDisabledReason !== lastDisabledReason) {
      loggedDisabledReason = lastDisabledReason
      appLogger.warn('RecordsSync', 'Server has per-record sync off; using classic sync', lastDisabledReason ?? undefined)
    }
  }
  return performCloudSongbookSync(token, options)
}
