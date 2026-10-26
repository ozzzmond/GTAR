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
import { normalizeCloudThemeSettings, persistCloudThemeSettings, readCloudThemeSettings, validateCloudThemeSettings, type CloudThemeSettings } from './backupSettings'
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
  MAX_PUSH_BODY_BYTES,
  MAX_RECORD_BYTES,
  MAX_RECORD_ID_LENGTH,
  RECORD_KINDS,
  THEME_RECORD_ID,
  libraryToRecords,
  recordChecksum,
  recordDataError,
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
import { isPristineSampleRecord } from '../data/defaultLibrary'
import { assertCommitAllowed, assertLibraryOwner, assertRoundStillCurrent, captureSessionGeneration, LibraryOwnershipError, readLibraryOwner,
  sameUser, StaleSyncRoundError, type SessionGeneration } from './libraryOwner'

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
function isSessionGenerationCurrent(expected: SessionGeneration | null, storage?: Pick<Storage, 'getItem'>): boolean {
  if (!expected || !expected.userId) return false
  const current = captureSessionGeneration(storage)
  if (!current || !current.userId) return false
  return sameUser(current.userId, expected.userId) && current.token === expected.token
}
function markRecordsServer(state: 'on' | 'off', storage: Pick<Storage, 'getItem' | 'setItem'>, gen?: SessionGeneration | null): boolean {
  if (gen !== undefined && !isSessionGenerationCurrent(gen, storage)) return false
  try {
    const changed = storage.getItem(RECORDS_SERVER_STATE_KEY) !== state
    storage.setItem(RECORDS_SERVER_STATE_KEY, state)
    return changed
  } catch { return false }
}
const REQUEST_TIMEOUT_MS = 15000
const MAX_PULL_PAGES = 500

interface KnownRecord { rev: number; checksum: string }
export interface RecordConflict { kind: RecordKind; id: string; title: string; remote: ServerRecord | null
  /** #240: why this record is held back, when it is not a plain two-sided edit. */
  note?: string
  /** #240 P1-F1: held back only because songs it lists are missing; re-checked every round. */
  dependency?: true }
export function isDependencyConflict(conflict: RecordConflict): boolean {
  if (conflict.dependency) return true
  if (conflict.kind !== 'setlist' || !conflict.remote || conflict.remote.removed) return false
  return !conflict.note || /lists songs that are not in your library|no song with that exact ID|missing-songs|missing|quarantine|held/i.test(conflict.note)
}
export function isValidConflictEnvelope(conflict: unknown): conflict is RecordConflict {
  if (!conflict || typeof conflict !== 'object' || Array.isArray(conflict)) return false
  const c = conflict as Record<string, unknown>
  if (typeof c.kind !== 'string' || !RECORD_KINDS.includes(c.kind as RecordKind)) return false
  if (typeof c.id !== 'string' || !c.id || c.id.length > MAX_RECORD_ID_LENGTH) return false
  if (c.kind === 'theme' && c.id !== THEME_RECORD_ID) return false
  if (c.remote === null || c.remote === undefined) {
    return c.remote === null
  }
  if (typeof c.remote !== 'object' || Array.isArray(c.remote)) return false
  const r = c.remote as Record<string, unknown>
  if (r.kind !== c.kind) return false
  if (typeof r.id !== 'string' || r.id !== c.id) return false
  if (typeof r.rev !== 'number' || !Number.isSafeInteger(r.rev) || r.rev <= 0) return false
  if (typeof r.removed !== 'boolean') return false
  if (typeof r.checksum !== 'string' || !r.checksum) return false

  if (r.removed) {
    if (r.data !== null && r.data !== undefined) return false
    if (r.checksum !== recordChecksum(true, null)) return false
    return true
  }

  if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) return false
  const problem = recordDataError(r.kind as RecordKind, r.id, r.data)
  if (problem) return false
  if (r.kind === 'theme') {
    if (validateCloudThemeSettings(r.data).length > 0) return false
  }
  if (r.checksum !== recordChecksum(false, r.data)) return false
  return true
}

export function isValidRecoverableConflict(conflict: RecordConflict): conflict is RecordConflict & { remote: ServerRecord } {
  if (conflict.kind !== 'setlist' || !conflict.id) return false
  if (!isValidConflictEnvelope(conflict)) return false
  if (!conflict.remote || conflict.remote.removed) return false
  return true
}

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
/** #208 F6: the caller became busy before remote changes were applied; nothing was written. */
class RecordsSyncDeferredError extends Error {}
/** Why the server last said per-record sync is off (for the debug log). */
let lastDisabledReason: string | null = null
let loggedDisabledReason: string | null | undefined
class RecordsHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request<T>(token: string, method: 'GET' | 'POST', query: string, body?: unknown, owner?: string): Promise<T> {
  const res = await fetch(`/api/songbook/records${query}`, {
    method,
    // #247: uploads state which account owns the library they come from; the server refuses a mismatch.
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(owner ? { 'X-GTAR-Library-Owner': owner } : {}) },
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

/**
 * #240 F8: setlist entries whose song id is not a song in the library. Exact ids only: a matching
 * title/artist is not an identity (the stored library and the cloud both require the exact id), so
 * an entry with a stale id counts as missing here and is never relinked by title.
 */
function entriesWithoutSong(songs: ActiveSongState[], setlists: WebSetlist[]): Array<{ setlistId: string; setlistName: string; songRef: WebSetlist['songs'][number] }> {
  const ids = new Set(songs.map(song => String(song.id)))
  const missing: Array<{ setlistId: string; setlistName: string; songRef: WebSetlist['songs'][number] }> = []
  for (const setlist of setlists) {
    for (const ref of setlist.songs ?? []) {
      if (ref?.id === undefined || ref.id === null || !ids.has(String(ref.id))) missing.push({ setlistId: String(setlist.id), setlistName: setlist.name, songRef: ref })
    }
  }
  return missing
}

/**
 * #240: cloud changes that would leave a setlist listing a song that is not in the library are held
 * back instead of failing the whole sync. Nothing is deleted or rewritten automatically:
 * - a cloud deletion of a song this device still lists in a setlist → the song stays on this device;
 * - a cloud setlist that lists songs missing here → this device keeps its own version (or none).
 * Each held record becomes a conflict (with the cloud record) for the user to decide; the rest of the
 * round is applied normally. Returns how many records were held back.
 */
function holdBackMissingReferences(next: SyncLibrary, local: SyncLibrary, applied: Map<string, ServerRecord>,
  state: RecordsSyncState, knownBefore: Record<string, KnownRecord>): number {
  let held = 0
  const hold = (key: string, note: string, localData: unknown) => {
    const remote = applied.get(key)!
    applied.delete(key)
    if (knownBefore[key]) state.known[key] = knownBefore[key]
    else if (localData) state.known[key] = { rev: 0, checksum: recordChecksum(false, localData) }
    else delete state.known[key]
    state.conflicts = [...state.conflicts.filter(item => recordKey(item.kind, item.id) !== key),
      { kind: remote.kind, id: remote.id, title: recordTitle(remote.kind, localData ?? remote.data), remote, note, dependency: true }]
    appLogger.warn('RecordsSync', `Held back a cloud change for "${recordTitle(remote.kind, localData ?? remote.data)}": ${note}`)
    held++
  }
  for (let pass = 0; pass < 8; pass++) {
    const danglingReferences = entriesWithoutSong(next.songs, next.setlists)
    if (!danglingReferences.length) break
    let progressed = false
    for (const ref of danglingReferences) {
      const songId = ref.songRef.id !== undefined && ref.songRef.id !== null ? String(ref.songRef.id) : null
      const songKey = songId !== null ? recordKey('song', songId) : null
      const setlistKey = recordKey('setlist', String(ref.setlistId))
      const localSong = songId !== null ? local.songs.find(song => String(song.id) === songId) : undefined
      if (songKey && localSong && applied.get(songKey)?.removed) {
        if (!next.songs.some(song => String(song.id) === songId)) {
          const at = Math.min(local.songs.indexOf(localSong), next.songs.length)
          next.songs = [...next.songs.slice(0, at), localSong, ...next.songs.slice(at)]
        }
        hold(songKey, `Removed in the cloud, but setlist "${ref.setlistName}" on this device still lists it`, localSong)
        progressed = true
      } else if (applied.has(setlistKey)) {
        const localList = local.setlists.find(list => String(list.id) === String(ref.setlistId))
        next.setlists = localList
          ? next.setlists.map(list => String(list.id) === String(ref.setlistId) ? localList : list)
          : next.setlists.filter(list => String(list.id) !== String(ref.setlistId))
        const absent = entriesWithoutSong(next.songs, [applied.get(setlistKey)!.data as WebSetlist]).map(item => `"${item.songRef?.title || item.songRef?.id || 'untitled'}"`)
        hold(setlistKey, `The cloud version lists songs that are not in your library (no song with that exact ID): ${absent.join(', ')}. ` +
          '"Download Cloud" keeps this setlist without those entries; "Keep Local Only" keeps this device\'s version. ' +
          'Either way, the cloud version is first saved in Review local recovery.', localList)
        progressed = true
      }
    }
    if (!progressed) break
  }
  return held
}

/** #240: removes setlist entries that point to no song in the library (logged); same array when nothing is missing.
 * Used only after an explicit user choice (conflict resolution), never on its own. */
export function dropMissingSetlistEntries(songs: ActiveSongState[], setlists: WebSetlist[]): WebSetlist[] {
  const danglingReferences = entriesWithoutSong(songs, setlists)
  if (!danglingReferences.length) return setlists
  const missing = new Map<string, Set<unknown>>()
  for (const ref of danglingReferences) {
    const key = String(ref.setlistId)
    if (!missing.has(key)) missing.set(key, new Set())
    missing.get(key)!.add(ref.songRef)
  }
  return setlists.map(setlist => {
    const gone = missing.get(String(setlist.id))
    if (!gone) return setlist
    const kept = setlist.songs.filter(ref => !gone.has(ref))
    appLogger.warn('RecordsSync', `Setlist "${setlist.name}": removed ${setlist.songs.length - kept.length} entr${setlist.songs.length - kept.length === 1 ? 'y' : 'ies'} for songs that no longer exist`,
      setlist.songs.filter(ref => gone.has(ref)).map(ref => ref.title || ref.id).join(', '))
    return { ...setlist, songs: kept }
  })
}

/** Current local records, keyed. */
function localRecords(library: SyncLibrary): Map<string, { kind: RecordKind; id: string; data: unknown; checksum: string }> {
  const map = new Map<string, { kind: RecordKind; id: string; data: unknown; checksum: string }>()
  for (const record of libraryToRecords(library)) map.set(recordKey(record.kind, record.id), { ...record, checksum: recordChecksum(false, record.data) })
  return map
}

/** Persists the library (revision-gated) and theme together; restores the library if the theme write fails. */
/** Returns the library revision this write produced (#208 F6: results are delivered only while it is still current). */
function persistApplied(storage: Storage, before: LocalView, next: SyncLibrary, ownerUserId?: string | null,
  gen?: SessionGeneration | null): string | null {
  // #247: a round that started for one account must not write after the library changed hands.
  // Revalidates session generation immediately before any local library write.
  if (ownerUserId !== undefined) assertCommitAllowed(ownerUserId, storage, gen)
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
  return libraryRevision(storage)
}

function conflictItems(conflicts: RecordConflict[]): ConflictingItem[] {
  return conflicts.map(conflict => ({ id: conflict.id, type: conflict.kind, title: conflict.title,
    reason: conflict.note ?? (conflict.remote === null ? 'Missing in the cloud' : conflict.remote.removed ? 'Removed in the cloud, edited here' : 'Edited here and in the cloud') }))
}

/** #204 S1: a quiet "nothing changed" line at most every 10 minutes; changes are always logged. */
let lastQuietSyncLog = 0
function logSyncOutcome(state: RecordsSyncState, applied: number, pushed: number, pushFailed: string | null): void {
  if (state.conflicts.length) { appLogger.warn('RecordsSync', `Per-record sync: ${state.conflicts.length} conflict(s) need a decision`, `cursor ${state.cursor}`); return }
  if (pushFailed) return // already logged by the caller or carried in the result
  if (!applied && !pushed) {
    if (Date.now() - lastQuietSyncLog < 10 * 60 * 1000) return
    lastQuietSyncLog = Date.now()
  }
  appLogger.info('RecordsSync', `✅ Per-record sync OK: ${applied} from cloud, ${pushed} uploaded`, `cursor ${state.cursor}`)
}

function finish(gen: SessionGeneration | null, storage: Storage, state: RecordsSyncState, library: SyncLibrary, applied: number, pushed: number, pushFailed: string | null, appliedRevision?: string | null): CloudSyncResult {
  assertRoundStillCurrent(state.userId, storage, pushed, gen) // #247 F3: no metadata or IN_SYNC for a round that changed hands
  saveState(state, storage)
  logSyncOutcome(state, applied, pushed, pushFailed)
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
    ...(applied ? { updatedLibrary: library, ...(appliedRevision !== undefined ? { appliedRevision } : {}) } : {}),
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
  allowRemovals = true, ownerStorage: Storage = localStorage, gen: SessionGeneration | null = null): Promise<{ pushed: number; failed: string | null; accepted: Set<string> }> {
  // #247: never upload a library this account does not own, nor after the session moved to another account.
  assertCommitAllowed(state.userId, ownerStorage, gen)
  const local = localRecords(library)
  const acceptedKeys = new Set<string>()
  const changes: RecordChange[] = []
  for (const [key, record] of local) {
    if (skip.has(key)) continue
    const known = state.known[key]
    // #227: unchanged first-run samples stay on this device; they are never added to the cloud.
    if (!known && !force.has(key) && isPristineSampleRecord(record.kind, record.data)) continue
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
  // #240 F5: a forced "keep this device" for a record this device does not have (e.g. a held-back cloud
  // setlist it never applied) is an explicit deletion of the cloud copy, at the cloud's revision.
  if (allowRemovals) {
    for (const [key, rev] of force) {
      if (local.has(key) || skip.has(key) || rev <= 0 || changes.some(change => recordKey(change.kind, change.id) === key)) continue
      const [kind, ...rest] = key.split(':')
      changes.push({ kind: kind as RecordKind, id: rest.join(':'), baseRev: rev, removed: true })
    }
  }
  // #208 F5: batches are bounded by bytes as well as by count. A record the server would refuse
  // on its own is left out (kept on this device) and reported, so the rest still syncs.
  const encoder = new TextEncoder()
  const tooLarge: string[] = []
  const batches: RecordChange[][] = []
  let current: RecordChange[] = []
  let currentBytes = 0
  for (const change of changes) {
    const dataBytes = change.removed ? 0 : encoder.encode(JSON.stringify(change.data)).byteLength
    if (dataBytes > MAX_RECORD_BYTES) { tooLarge.push(`${recordTitle(change.kind, change.data)} (${Math.ceil(dataBytes / 1024)} KB)`); continue }
    const bytes = encoder.encode(JSON.stringify(change)).byteLength + 1
    if (current.length && (current.length >= MAX_PUSH_CHANGES || currentBytes + bytes > MAX_PUSH_BODY_BYTES)) { batches.push(current); current = []; currentBytes = 0 }
    current.push(change)
    currentBytes += bytes
  }
  if (current.length) batches.push(current)
  const oversize = tooLarge.length
    ? `Not uploaded, too large to sync (max ${MAX_RECORD_BYTES / 1024} KB each): ${tooLarge.join(', ')}. They stay on this device.` : null
  let pushed = 0
  for (const batch of batches) {
    let response: PushResponse
    try {
      assertCommitAllowed(state.userId, ownerStorage, gen) // each batch: the previous one was awaited
      const owner = readLibraryOwner(ownerStorage)
      if (!owner) throw new LibraryOwnershipError('unbound')
      response = await request<PushResponse>(token, 'POST', '', { changes: batch }, owner.userId)
    } catch (error) {
      if (error instanceof LibraryOwnershipError) throw error
      if (error instanceof RecordsSyncDisabledError) throw error
      if (error instanceof StaleSyncRoundError) {
        throw new StaleSyncRoundError(error.reason, pushed)
      }
      return { pushed, accepted: acceptedKeys, failed: `Cloud upload stopped: ${error instanceof Error ? error.message : String(error)}. Local edits are kept; sync again later.${oversize ? ` ${oversize}` : ''}` }
    }
    for (const accepted of response.accepted) {
      state.known[recordKey(accepted.kind, accepted.id)] = { rev: accepted.rev, checksum: accepted.checksum }
      acceptedKeys.add(recordKey(accepted.kind, accepted.id))
      pushed++
    }
    for (const conflict of response.conflicts) {
      const key = recordKey(conflict.kind, conflict.id)
      const mine = local.get(key)
      state.conflicts = [...state.conflicts.filter(item => recordKey(item.kind, item.id) !== key),
        { kind: conflict.kind, id: conflict.id, title: recordTitle(conflict.kind, mine?.data ?? conflict.current?.data), remote: conflict.current,
          ...(conflict.reason === 'referenced' ? { note: 'Deleted here, but a setlist in the cloud still lists it' }
            : conflict.reason === 'missing-songs' ? { note: 'Lists songs that the cloud no longer has' } : {}) }]
    }
    if (response.mirror === 'skipped-size') appLogger.warn('RecordsSync', 'Cloud copy for older clients not updated: songbook over 2 MB')
  }
  if (oversize) appLogger.warn('RecordsSync', oversize)
  return { pushed, failed: oversize, accepted: acceptedKeys }
}

/**
 * One sync round: pull every remote change since the checkpoint, fast-forward unedited records,
 * queue conflicts, then push local edits. Throws RecordsSyncDisabledError when the server flag is off.
 */
export type FirstSyncChoice = 'cloud' | 'combine'

async function syncOnce(gen: SessionGeneration | null, token: string, storage: Storage, canApply?: () => boolean, firstSync?: FirstSyncChoice): Promise<CloudSyncResult> {
  const before = readLocal(storage)
  // #208 F1: after a storage fallback, read the whole feed so every record missing here can be restored.
  const hold = recordsDeleteHoldActive(storage)
  const saved = readRecordsSyncState(storage)
  const fresh = Object.keys(saved.known).length === 0 && saved.cursor === 0 && !saved.conflicts.length
  const pulled = await pullAll(token, hold ? { ...saved, cursor: 0 } : saved)
  const state = pulled.state
  // #247: the library is applied to and uploaded from only for the account that owns it.
  assertLibraryOwner(state.userId, storage)
  const working = new Working(before.library)
  const local = localRecords(before.library)

  // #227: the first sync on this device, when the cloud already has a library. Pristine samples never
  // count. Nothing to lose → this device simply takes the cloud library. Songs of its own → the user
  // chooses once: take the cloud library (own songs kept in recovery) or combine.
  if (fresh && [...pulled.records.values()].some(r => !r.removed)) {
    const own = [...local.entries()].filter(([key, record]) => record.kind !== 'theme' && !isPristineSampleRecord(record.kind, record.data) &&
      pulled.records.get(key)?.checksum !== record.checksum)
    if (own.length && !firstSync) {
      return { success: false, status: 'IDLE', state: 'SAME_STATE', actionTaken: 'NONE',
        firstSyncChoice: { songs: own.filter(([, r]) => r.kind === 'song').length, setlists: own.filter(([, r]) => r.kind === 'setlist').length } }
    }
    const samplesHere = [...local.values()].some(record => isPristineSampleRecord(record.kind, record.data))
    if (firstSync === 'cloud' || (!own.length && samplesHere)) return adoptCloud(gen, storage, before, pulled.records, state, own.length > 0, canApply)
  }
  let applied = 0
  let restored = 0
  const knownBefore = { ...state.known }
  const appliedRemote = new Map<string, ServerRecord>()

  for (const [key, remote] of pulled.records) {
    const known = state.known[key]
    const mine = local.get(key)
    if (hold && !mine && known && !remote.removed) {
      // Known record missing from the fallback copy: bring the cloud version back, do not delete it.
      working.apply(remote)
      appliedRemote.set(key, remote)
      state.known[key] = { rev: remote.rev, checksum: remote.checksum }
      state.conflicts = state.conflicts.filter(item => recordKey(item.kind, item.id) !== key)
      applied++
      restored++
      continue
    }
    const mineChecksum = mine ? mine.checksum : REMOVED
    // The feed returns this device's own uploads too (the cursor only moves on pull). A record the
    // cloud still holds at the revision this device last synced has no remote change: nothing to
    // apply, and a later local edit or deletion is simply pushed below, not a conflict.
    if (known && remote.rev === known.rev && remote.checksum === known.checksum && mineChecksum !== remote.checksum) continue
    if (mineChecksum === remote.checksum) {
      state.known[key] = { rev: remote.rev, checksum: remote.checksum }
      state.conflicts = state.conflicts.filter(item => recordKey(item.kind, item.id) !== key)
      continue
    }
    const editedHere = known ? mineChecksum !== known.checksum : mine !== undefined
    if (!editedHere) {
      working.apply(remote)
      appliedRemote.set(key, remote)
      state.known[key] = { rev: remote.rev, checksum: remote.checksum }
      // #240 P1-F1: the current cloud version replaces a held one; hold-back below re-checks it.
      state.conflicts = state.conflicts.filter(item => !(isDependencyConflict(item) && recordKey(item.kind, item.id) === key))
      applied++
      continue
    }
    state.conflicts = [...state.conflicts.filter(item => recordKey(item.kind, item.id) !== key),
      { kind: remote.kind, id: remote.id, title: recordTitle(remote.kind, mine?.data ?? remote.data), remote }]
  }

  // #240 P1-F1 / R1: a setlist held back because songs it lists were missing is applied once every one of
  // those songs (exact id) is in the library again, provided this device has not changed it since.
  let authoritativeCache: Map<string, ServerRecord> | null = null
  for (const conflict of [...state.conflicts]) {
    if (!isDependencyConflict(conflict) || !isValidRecoverableConflict(conflict)) continue
    const key = recordKey('setlist', conflict.id)
    if (pulled.records.has(key)) continue
    const mine = local.get(key)
    const mineChecksum = mine ? mine.checksum : REMOVED
    const editedHere = knownBefore[key] ? mineChecksum !== knownBefore[key].checksum : mine !== undefined
    const songIds = new Set(working.library().songs.map(song => String(song.id)))
    const entries = ((conflict.remote.data as WebSetlist | null)?.songs ?? [])
    const dependenciesMet = entries.every(ref => ref?.id !== undefined && ref.id !== null && songIds.has(String(ref.id)))
    if (editedHere) {
      delete conflict.dependency
      if (dependenciesMet) delete conflict.note
      continue
    }
    if (!dependenciesMet) {
      conflict.dependency = true
      continue
    }
    let authRecord: ServerRecord | undefined = pulled.records.get(key)
    if (!authRecord) {
      if (!authoritativeCache) {
        authoritativeCache = (await pullAll(token, emptyState(state.userId))).records
      }
      authRecord = authoritativeCache.get(key)
    }
    if (!authRecord) {
      appLogger.warn('RecordsSync', `Automatic recovery rejected for "${conflict.title}": record not found on server`)
      continue
    }
    const matches = authRecord.kind === conflict.remote.kind &&
      authRecord.id === conflict.remote.id &&
      authRecord.rev === conflict.remote.rev &&
      authRecord.checksum === conflict.remote.checksum &&
      authRecord.removed === conflict.remote.removed
    if (!matches) {
      appLogger.warn('RecordsSync', `Automatic recovery rejected for "${conflict.title}": server record has rev ${authRecord.rev}, conflict claimed rev ${conflict.remote.rev}`)
      conflict.remote = authRecord
      delete conflict.dependency
      continue
    }
    working.apply(conflict.remote)
    appliedRemote.set(key, conflict.remote)
    state.known[key] = { rev: conflict.remote.rev, checksum: conflict.remote.checksum }
    state.conflicts = state.conflicts.filter(item => recordKey(item.kind, item.id) !== key)
    appLogger.info('RecordsSync', `Applied the held-back cloud setlist "${conflict.title}": its songs are available again`)
    applied++
  }

  const next = working.library()
  applied -= holdBackMissingReferences(next, before.library, appliedRemote, state, knownBefore)
  // #208 F6: never write remote changes under an open editor; nothing is saved, the next run repeats.
  if (applied && canApply && !canApply()) throw new RecordsSyncDeferredError('Sync deferred: the songbook is being edited')
  const appliedRevision = applied ? persistApplied(storage, before, next, state.userId, gen) : undefined
  // Conflicted records are not pushed until the user decides.
  const skip = new Set(state.conflicts.map(item => recordKey(item.kind, item.id)))
  const { pushed, failed } = await pushAll(token, state, next, skip, new Map(), !hold, storage, gen)
  assertRoundStillCurrent(state.userId, storage, pushed, gen) // #247 F3: the last await is over; re-check before any write
  if (hold && !failed) {
    try { storage.removeItem(RECORDS_DELETE_HOLD_KEY) } catch { /* stays on; next sync repeats the safe path */ }
    appLogger.warn('RecordsSync', `Storage fallback recovered: ${restored} ${restored === 1 ? 'record' : 'records'} restored from the cloud; no cloud deletes sent`)
  }
  return finish(gen, storage, state, next, applied, pushed, failed, appliedRevision)
}

export type ConflictChoice = 'keep-local' | 'use-cloud' | 'keep-both'

/** Resolves every queued conflict the same way, after saving a recovery snapshot of both sides. */
async function resolveOnce(gen: SessionGeneration | null, token: string, storage: Storage, choice: ConflictChoice): Promise<CloudSyncResult> {
  const state = readRecordsSyncState(storage)
  if (!state.conflicts.length) return syncOnce(gen, token, storage)

  // Fail-closed identity and integrity check on all persisted conflicts before any mutation or snapshot:
  for (const conflict of state.conflicts) {
    if (!isValidConflictEnvelope(conflict)) {
      appLogger.warn('RecordsSync', 'Persisted conflict rejected: invalid identity or integrity boundary')
      return {
        success: false,
        status: 'CONFLICT',
        state: 'CONFLICT',
        actionTaken: 'NONE',
        conflicts: conflictItems(state.conflicts),
        error: 'Some saved conflicts have invalid identity or data integrity. Your library was not modified.',
      }
    }
  }

  // #247: the saved conflicts belong to the account that pulled them; act only for that account.
  const pulled = await pullAll(token, emptyState(state.userId))
  if (!pulled.state.userId || (state.userId && pulled.state.userId !== state.userId)) throw new LibraryOwnershipError('mismatch')
  assertLibraryOwner(pulled.state.userId, storage)

  const before = readLocal(storage)
  const local = localRecords(before.library)

  // Verify that any remote records presented as current match authoritative server data:
  let serverChanged = false
  for (let i = 0; i < state.conflicts.length; i++) {
    const conflict = state.conflicts[i]
    const key = recordKey(conflict.kind, conflict.id)
    const authoritativeRecord = pulled.records.get(key)
    const localRec = local.get(key)
    const mineChecksum = localRec ? localRec.checksum : REMOVED
    if (authoritativeRecord && mineChecksum === authoritativeRecord.checksum && authoritativeRecord.removed === (mineChecksum === REMOVED)) {
      // The server already matches the local record (e.g. from an earlier write whose acknowledgement was lost)
      state.known[key] = { rev: authoritativeRecord.rev, checksum: authoritativeRecord.checksum }
      continue
    }
    if (!conflict.remote) {
      if (authoritativeRecord && !authoritativeRecord.removed) {
        state.conflicts[i] = { ...conflict, remote: authoritativeRecord }
        serverChanged = true
      }
    } else {
      if (!authoritativeRecord) {
        serverChanged = true
      } else {
        const matches = authoritativeRecord.kind === conflict.remote.kind &&
          authoritativeRecord.id === conflict.remote.id &&
          authoritativeRecord.rev === conflict.remote.rev &&
          authoritativeRecord.checksum === conflict.remote.checksum &&
          authoritativeRecord.removed === conflict.remote.removed
        if (!matches) {
          state.conflicts[i] = { ...conflict, remote: authoritativeRecord }
          serverChanged = true
        }
      }
    }
  }

  if (serverChanged) {
    saveState(state, storage)
    appLogger.warn('RecordsSync', 'Authoritative server records changed or unverified; fresh conflict requires review')
    return {
      success: false,
      status: 'CONFLICT',
      state: 'CONFLICT',
      actionTaken: 'NONE',
      conflicts: conflictItems(state.conflicts),
      error: 'The cloud version of some records changed since this conflict was detected. Please review the updated conflicts.',
    }
  }

  const working = new Working(before.library)
  const cloudView = new Working(before.library)
  for (const conflict of state.conflicts) if (conflict.remote) cloudView.apply(conflict.remote)

  // Both versions stay recoverable whatever the choice.
  // #240: the cloud records themselves are kept too, so a choice that drops a cloud version stays recoverable
  // even when the cloud side is not a valid library on its own (e.g. a setlist listing missing songs).
  const snapshot: { local: SyncLibrary; remote?: SyncLibrary; remoteRecords: Array<ServerRecord | null> } = { local: before.library, remoteRecords: state.conflicts.map(conflict => conflict.remote) }
  try { validateLibrary(cloudView.library()); snapshot.remote = cloudView.library() } catch { /* cloud side alone is not a complete library */ }
  await writeRecoverySnapshot(`gtar_sync_recovery:records:${Date.now()}:${generateUUID()}`, JSON.stringify(snapshot), storage)
  // #240 P2-F4: an editor save during the snapshot write makes this view stale: nothing is applied or
  // uploaded; the conflicts stay and the user chooses again on the current library.
  if (libraryRevision(storage) !== before.raw) return changedDuringResolution()

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
        // #240 P2-F3: one copy per cloud version, whatever the retries or devices (no duplicate copies).
        const copyId = await stableCopyId(conflict.kind, conflict.id, remote.rev, remote.checksum)
        const original = remote.data as { title?: string; name?: string }
        const copy = conflict.kind === 'song'
          ? { ...(remote.data as ActiveSongState), id: copyId, title: `${original.title ?? 'Song'} (cloud copy)` }
          : { ...(remote.data as WebSetlist), id: copyId, name: `${original.name ?? 'Setlist'} (cloud copy)` }
        working.apply({ kind: conflict.kind, id: copyId, removed: false, data: copy })
        applied++
      }
    }
  }
  // #240 F5: a conflict is cleared only when its choice is done: applied here (use-cloud) or
  // acknowledged by the cloud (keep-local / keep-both). Anything else stays for the next attempt.
  const resolving = state.conflicts
  state.conflicts = []
  const next = working.library()
  // #240: the user chose; a setlist entry whose song is gone either way is dropped (logged) so the
  // choice can be saved. The cleaned setlist is pushed like any other local change.
  const cleaned = dropMissingSetlistEntries(next.songs, next.setlists)
  if (cleaned !== next.setlists) { next.setlists = cleaned; applied++ }
  const appliedRevision = applied ? persistApplied(storage, before, next, state.userId, gen) : undefined
  if (libraryRevision(storage) !== (appliedRevision ?? before.raw)) return changedDuringResolution()
  const { pushed, failed, accepted } = await pushAll(token, state, next, new Set(), force, !recordsDeleteHoldActive(storage), storage, gen)
  assertRoundStillCurrent(state.userId, storage, pushed, gen) // #247 F3
  for (const conflict of resolving) {
    const key = recordKey(conflict.kind, conflict.id)
    if (!force.has(key) || accepted.has(key) || state.conflicts.some(item => recordKey(item.kind, item.id) === key)) continue
    state.conflicts = [...state.conflicts, conflict]
  }
  if (!failed && state.conflicts.length) appLogger.warn('RecordsSync', `${state.conflicts.length} conflict choice(s) not confirmed by the cloud yet; kept for the next attempt`)
  // #240 P2-F4: a save during the upload is kept; this round is not reported as converged.
  if (libraryRevision(storage) !== (appliedRevision ?? before.raw)) {
    saveState(state, storage)
    return { ...changedDuringResolution(), ...(failed ? { error: failed } : {}) }
  }
  return finish(gen, storage, state, next, applied, pushed, failed, appliedRevision)
}

function changedDuringResolution(): CloudSyncResult {
  appLogger.info('RecordsSync', 'The songbook changed during a conflict choice; nothing was overwritten. Sync again to finish.')
  return { success: false, status: 'IDLE', state: 'SAME_STATE', actionTaken: 'NONE', deferred: true,
    error: 'Your songbook changed while this choice was being applied. Nothing was lost; choose again to finish.' }
}

/** #240 P2-F3: a stable id for the "keep both" copy of one cloud version (UUID-shaped SHA-256). */
async function stableCopyId(kind: RecordKind, id: string, rev: number, checksum: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gtar-keep-both:${kind}:${id}:${rev}:${checksum}`)))
  const hex = Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** #227: this device takes the cloud library on its first sync. Own songs (if any) go to recovery first. */
async function adoptCloud(gen: SessionGeneration | null, storage: Storage, before: LocalView, records: Map<string, ServerRecord>, state: RecordsSyncState,
  keepRecovery: boolean, canApply?: () => boolean): Promise<CloudSyncResult> {
  const working = new Working({ songs: [], setlists: [], ...(before.library.themeSettings !== undefined ? { themeSettings: before.library.themeSettings } : {}) })
  const knownBefore = { ...state.known }
  for (const [key, remote] of records) {
    if (!remote.removed) working.apply(remote)
    state.known[key] = { rev: remote.rev, checksum: remote.checksum }
  }
  const next = working.library()
  holdBackMissingReferences(next, before.library, new Map(records), state, knownBefore)
  if (canApply && !canApply()) throw new RecordsSyncDeferredError('Sync deferred: the songbook is being edited')
  if (keepRecovery) await writeRecoverySnapshot(`gtar_sync_recovery:download:${Date.now()}:${generateUUID()}`, JSON.stringify({ local: before.library, remote: next }), storage)
  const appliedRevision = persistApplied(storage, before, next, state.userId, gen)
  appLogger.info('RecordsSync', `First sync on this device: took the cloud library (${next.songs.length} songs)${keepRecovery ? '; this device\'s own songs kept in recovery' : ''}`)
  return finish(gen, storage, state, next, records.size, 0, null, appliedRevision)
}

/** Replaces the whole device library with the cloud records (explicit "Download from Cloud"). */
async function replaceWithCloud(gen: SessionGeneration | null, token: string, storage: Storage): Promise<CloudSyncResult> {
  const before = readLocal(storage)
  const pulled = await pullAll(token, emptyState())
  const state = pulled.state
  assertLibraryOwner(state.userId, storage)
  const working = new Working({ songs: [], setlists: [] })
  const knownBefore = { ...state.known }
  for (const [key, remote] of pulled.records) {
    working.apply(remote)
    state.known[key] = { rev: remote.rev, checksum: remote.checksum }
  }
  const next = working.library()
  holdBackMissingReferences(next, before.library, new Map(pulled.records), state, knownBefore)
  // #227 item 4: count what actually differs; when the device already equals the cloud, write nothing.
  const mine = localRecords(before.library)
  const theirs = localRecords(next)
  let changed = 0
  for (const key of new Set([...mine.keys(), ...theirs.keys()])) if (mine.get(key)?.checksum !== theirs.get(key)?.checksum) changed++
  const replaced = { songs: next.songs.length, setlists: next.setlists.length, changed }
  if (!changed) {
    appLogger.info('RecordsSync', `Replace with the cloud copy: this device already matches the cloud (${next.songs.length} songs); nothing changed`)
    return { ...finish(gen, storage, state, before.library, 0, 0, null), replaced }
  }
  await writeRecoverySnapshot(`gtar_sync_recovery:download:${Date.now()}:${generateUUID()}`, JSON.stringify({ local: before.library, remote: next }), storage)
  const appliedRevision = persistApplied(storage, before, next, state.userId, gen)
  appLogger.info('RecordsSync', `Replaced this device with the cloud copy: ${next.songs.length} songs, ${next.setlists.length} setlists (${changed} changed); the previous device copy is in recovery`)
  return { ...finish(gen, storage, state, next, changed, 0, null, appliedRevision), replaced }
}

/**
 * Entry point used by performCloudSongbookSync when per-record sync is on.
 * Returns null when the server has the feature off, so the caller uses the classic sync.
 * forceAction maps the existing dialog buttons: upload = keep this device's versions,
 * download = use the cloud's, merge_preserve = keep both (cloud copies).
 */
export async function performRecordsSync(token: string, options: { forceAction?: 'upload' | 'download' | 'merge_preserve'; storage?: Storage;
  /** #208 F6: checked right before remote changes are written; false defers the whole round. */
  canApply?: () => boolean
  /** #227: the user's answer to a first-sync choice. */
  firstSync?: FirstSyncChoice } = {}): Promise<CloudSyncResult | null> {
  const targetStorage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  const gen = captureSessionGeneration(targetStorage) // #247 F3: the sign-in this round was started under (before any wait)
  // Fail closed when authenticated session cannot be established at request time:
  // no unsafe queued execution, stale completion or sync persistence. Preserve valid local data and pending changes.
  if (!gen || !gen.userId) {
    appLogger.warn('RecordsSync', 'Sync blocked: missing authenticated request-time session')
    return {
      success: false,
      status: 'ERROR',
      state: 'OFFLINE_OR_CLOUD_FAILURE',
      actionTaken: 'NONE',
      error: 'Session expired or unauthorized. Please sign in again.',
    }
  }
  // One records sync at a time across this browser's tabs (manual and automatic).
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks?.request) return locks.request(RECORDS_SYNC_RUN_LOCK, () => runRecordsSync(gen, token, options))
  return runRecordsSync(gen, token, options)
}

async function runRecordsSync(gen: SessionGeneration, token: string, options: { forceAction?: 'upload' | 'download' | 'merge_preserve'; storage?: Storage; canApply?: () => boolean; firstSync?: FirstSyncChoice }): Promise<CloudSyncResult | null> {
  const storage = options.storage ?? localStorage
  // Revalidate session generation and account at actual queue execution before any network request or mutation.
  // Stale queued work must fail closed.
  const currentGen = captureSessionGeneration(storage)
  if (!currentGen || !currentGen.userId) {
    appLogger.warn('RecordsSync', 'Queued sync discarded: session expired or signed out before execution')
    return {
      success: false,
      status: 'ERROR',
      state: 'OFFLINE_OR_CLOUD_FAILURE',
      actionTaken: 'NONE',
      error: 'Session expired or unauthorized. Please sign in again.',
    }
  }
  if (!sameUser(currentGen.userId, gen.userId ?? '') || currentGen.token !== gen.token) {
    appLogger.warn('RecordsSync', 'Queued sync discarded: session changed or token rotated before execution')
    return {
      success: false,
      status: 'ERROR',
      state: 'OFFLINE_OR_CLOUD_FAILURE',
      actionTaken: 'NONE',
      error: 'Session expired or unauthorized. Please sign in again.',
    }
  }
  try {
    if (!options.forceAction) return await syncOnce(gen, token, storage, options.canApply, options.firstSync)
    const hasConflicts = readRecordsSyncState(storage).conflicts.length > 0
    if (options.forceAction === 'download') return hasConflicts ? await resolveOnce(gen, token, storage, 'use-cloud') : await replaceWithCloud(gen, token, storage)
    return await resolveOnce(gen, token, storage, options.forceAction === 'upload' ? 'keep-local' : 'keep-both')
  } catch (error) {
    if (error instanceof RecordsSyncDisabledError) { lastDisabledReason = error.message || null; return null }
    if (error instanceof RecordsSyncDeferredError) return { success: false, status: 'IDLE', state: 'SAME_STATE', actionTaken: 'NONE', deferred: true }
    if (error instanceof StaleSyncRoundError) {
      appLogger.warn('RecordsSync', `Sync round discarded: ${error.reason}`)
      return { success: false, status: 'ERROR', state: 'OFFLINE_OR_CLOUD_FAILURE', actionTaken: 'NONE', error: error.message }
    }
    if (error instanceof LibraryOwnershipError) {
      appLogger.warn('RecordsSync', `Sync blocked: library ownership ${error.ownership}`)
      return { success: false, status: 'ERROR', state: 'OFFLINE_OR_CLOUD_FAILURE', actionTaken: 'NONE', error: error.message, ownership: error.ownership }
    }
    const status = error instanceof RecordsHttpError ? error.status : 0
    // #240: "Offline" only for a network failure, not for any error raised on this device.
    const offline = !(error instanceof RecordsHttpError) && ((typeof navigator !== 'undefined' && navigator.onLine === false) ||
      error instanceof TypeError || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')))
    appLogger.warn('RecordsSync', 'Per-record sync did not finish', error instanceof Error ? error.message : String(error))
    return {
      success: false,
      status: offline ? 'OFFLINE' : 'ERROR',
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
export async function performSongbookSync(token: string, options: { forceAction?: 'upload' | 'download' | 'merge_preserve'; storage?: Storage; firstSync?: FirstSyncChoice } = {}): Promise<CloudSyncResult> {
  const storage = options.storage ?? localStorage
  const gen = captureSessionGeneration(storage)
  if (isRecordsSyncEnabled(storage)) {
    const result = await performRecordsSync(token, options)
    if (result) {
      if (isSessionGenerationCurrent(gen, storage)) markRecordsServer('on', storage, gen)
      return result
    }
    // Logged once when it changes, not on every sync.
    // Logged when the state or the reason changes (once per page for a given reason), not on every sync.
    if (isSessionGenerationCurrent(gen, storage)) {
      if (markRecordsServer('off', storage, gen) || loggedDisabledReason !== lastDisabledReason) {
        loggedDisabledReason = lastDisabledReason
        appLogger.warn('RecordsSync', 'Server has per-record sync off; using classic sync', lastDisabledReason ?? undefined)
      }
    } else {
      return {
        success: false,
        status: 'ERROR',
        state: 'OFFLINE_OR_CLOUD_FAILURE',
        actionTaken: 'NONE',
        error: 'Session expired or unauthorized. Please sign in again.',
      }
    }
  }
  return performCloudSongbookSync(token, options)
}
