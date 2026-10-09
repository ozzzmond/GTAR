import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'
import { readPersistedLibrary, persistLibrary } from './syncJournal'
import { normalizeSongbookIds, validateSongbookIntegrity } from './songbookFoundation'
import { generateUUID } from './uuid'

export const CLOUD_SYNC_META_KEY = 'gtar_cloud_sync_meta'
export const CLOUD_SYNC_BASE_KEY = 'gtar_cloud_sync_base'

export type CloudSyncStatus =
  | 'IDLE'
  | 'SYNCING'
  | 'IN_SYNC'
  | 'LOCAL_NEWER'
  | 'CLOUD_NEWER'
  | 'CONFLICT'
  | 'OFFLINE'
  | 'ERROR'

export type CloudSyncDecision = 'NOOP' | 'UPLOAD' | 'DOWNLOAD' | 'CONFLICT' | 'OFFLINE'

export type CloudSyncState =
  | 'LOCAL_ONLY'
  | 'CLOUD_ONLY'
  | 'SAME_STATE'
  | 'LOCAL_NEWER'
  | 'CLOUD_NEWER'
  | 'CONFLICT'
  | 'OFFLINE_OR_CLOUD_FAILURE'

export interface CloudSongbookRecord {
  userId?: string
  version: number
  checksum: string
  updatedAt: string
  data: SyncLibrary
}

export interface CloudSyncMeta {
  lastSyncedChecksum: string | null
  lastSyncedAt: number | null
  cloudVersion: number | null
  lastSyncedUserId?: string | null
}

export interface SyncDecisionResult {
  decision: CloudSyncDecision
  state: CloudSyncState
  reason: string
  localChecksum: string
  cloudChecksum: string | null
  baseChecksum: string | null
}

export interface ConflictingItem {
  id: string
  type: 'song' | 'setlist'
  title: string
  reason: string
}

export interface ReconciliationResult {
  merged: SyncLibrary
  conflicts: ConflictingItem[]
  hasConflicts: boolean
}

export interface CloudSyncResult {
  success: boolean
  status: CloudSyncStatus
  state: CloudSyncState
  actionTaken: 'NONE' | 'UPLOADED' | 'DOWNLOADED' | 'MERGED' | 'CONFLICT_DETECTED'
  version?: number
  checksum?: string
  error?: string
  conflicts?: ConflictingItem[]
  updatedLibrary?: SyncLibrary
}

/**
 * Deterministic checksum of a canonical songbook library.
 * Orders songs and setlists deterministically and digests canonical properties.
 */
export function computeSongbookChecksum(library: SyncLibrary): string {
  const songs = [...library.songs]
    .map((s) => ({
      id: String(s.id || ''),
      title: (s.title || '').trim(),
      artist: (s.artist || '').trim(),
      key: (s.key || '').trim(),
      originalKey: (s.originalKey || '').trim(),
      capo: (s.capo || '').trim(),
      bpm: (s.bpm || '').trim(),
      time: (s.time || '').trim(),
      year: (s.year || '').trim(),
      format: String(s.format || 'PLAIN'),
      transposeOffset: Number(s.transposeOffset || 0),
      rawContent: (s.rawContent || '').replace(/\r\n/g, '\n'),
      isDeleted: Boolean(s.isDeleted),
      tags: songTags(s),
      isFavorite: Boolean(s.isFavorite),
      createdAt: s.createdAt ?? null,
      lastOpenedAt: s.lastOpenedAt ?? null,
      isMissing: Boolean(s.isMissing),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const setlists = [...library.setlists]
    .map((sl) => ({
      id: String(sl.id || ''),
      name: (sl.name || '').trim(),
      isDeleted: Boolean(sl.isDeleted),
      songs: (sl.songs || []).map((ref) => ({
        id: ref.id !== undefined ? String(ref.id) : '',
        title: (ref.title || '').trim(),
        artist: (ref.artist || '').trim(),
      })),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const canonicalString = JSON.stringify({ songs, setlists })

  let h1 = 0x811c9dc5
  for (let i = 0; i < canonicalString.length; i++) {
    h1 ^= canonicalString.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193)
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0')

  let h2 = 5381
  for (let i = 0; i < canonicalString.length; i++) {
    h2 = ((h2 << 5) + h2 + canonicalString.charCodeAt(i)) | 0
  }
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0')

  return `ck_${part1}${part2}`
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

/**
 * Reads persisted sync metadata from localStorage
 */
export function readCloudSyncMeta(storage?: Storage): CloudSyncMeta {
  const targetStorage = getStorage(storage)
  if (!targetStorage) {
    return { lastSyncedChecksum: null, lastSyncedAt: null, cloudVersion: null }
  }
  try {
    const raw = targetStorage.getItem(CLOUD_SYNC_META_KEY)
    if (!raw) {
      return { lastSyncedChecksum: null, lastSyncedAt: null, cloudVersion: null }
    }
    const parsed = JSON.parse(raw) as Partial<CloudSyncMeta>
    return {
      lastSyncedChecksum: typeof parsed.lastSyncedChecksum === 'string' ? parsed.lastSyncedChecksum : null,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : null,
      cloudVersion: typeof parsed.cloudVersion === 'number' ? parsed.cloudVersion : null,
      lastSyncedUserId: typeof parsed.lastSyncedUserId === 'string' ? parsed.lastSyncedUserId : null,
    }
  } catch {
    return { lastSyncedChecksum: null, lastSyncedAt: null, cloudVersion: null }
  }
}

/**
 * Saves sync metadata to localStorage
 */
export function saveCloudSyncMeta(meta: CloudSyncMeta, storage?: Storage): void {
  const targetStorage = getStorage(storage)
  if (!targetStorage) return
  try {
    targetStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(meta))
  } catch {
    // Storage quota or unavailable: continue in-memory
  }
}

/**
 * Reads persisted base snapshot library from localStorage for 3-way reconciliation
 */
export function readCloudSyncBase(storage?: Storage): SyncLibrary | null {
  const targetStorage = getStorage(storage)
  if (!targetStorage) return null
  try {
    const raw = targetStorage.getItem(CLOUD_SYNC_BASE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SyncLibrary>
    if (!parsed || !Array.isArray(parsed.songs) || !Array.isArray(parsed.setlists)) {
      return null
    }
    return {
      songs: parsed.songs,
      setlists: parsed.setlists,
    }
  } catch {
    return null
  }
}

/**
 * Saves base snapshot library to localStorage
 */
export function saveCloudSyncBase(library: SyncLibrary, storage?: Storage): void {
  const targetStorage = getStorage(storage)
  if (!targetStorage) return
  try {
    targetStorage.setItem(CLOUD_SYNC_BASE_KEY, JSON.stringify(library))
  } catch {
    // Storage quota or unavailable: continue in-memory
  }
}

/**
 * Pure evaluation function for deterministic sync decision
 */
export function evaluateSyncDecision({
  localData,
  cloudRecord,
  baseMeta,
  isOffline = false,
}: {
  localData: SyncLibrary
  cloudRecord: CloudSongbookRecord | null
  baseMeta: CloudSyncMeta | null
  isOffline?: boolean
}): SyncDecisionResult {
  const localChecksum = computeSongbookChecksum(localData)
  const cloudChecksum = cloudRecord ? cloudRecord.checksum : null
  const baseChecksum = baseMeta ? baseMeta.lastSyncedChecksum : null

  if (isOffline) {
    return {
      decision: 'OFFLINE',
      state: 'OFFLINE_OR_CLOUD_FAILURE',
      reason: 'Network offline or service unreachable',
      localChecksum,
      cloudChecksum,
      baseChecksum,
    }
  }

  // 1. Cloud has no record
  if (!cloudRecord) {
    if (localData.songs.length === 0 && localData.setlists.length === 0) {
      return {
        decision: 'NOOP',
        state: 'SAME_STATE',
        reason: 'Both local and cloud songbooks are empty',
        localChecksum,
        cloudChecksum,
        baseChecksum,
      }
    }
    return {
      decision: 'UPLOAD',
      state: 'LOCAL_ONLY',
      reason: 'Local songbook exists, cloud is empty; upload local data',
      localChecksum,
      cloudChecksum,
      baseChecksum,
    }
  }

  // 2. Both sides have identical checksum
  if (localChecksum === cloudChecksum) {
    return {
      decision: 'NOOP',
      state: 'SAME_STATE',
      reason: 'Local and cloud songbooks are identical',
      localChecksum,
      cloudChecksum,
      baseChecksum,
    }
  }

  // 3. Local is completely empty or pristine initial state, while cloud has songs
  const isLocalEmpty = localData.songs.length === 0 && localData.setlists.length === 0
  const hasCloudContent = cloudRecord.data.songs.length > 0 || cloudRecord.data.setlists.length > 0
  if (isLocalEmpty && hasCloudContent && !baseChecksum) {
    return {
      decision: 'DOWNLOAD',
      state: 'CLOUD_ONLY',
      reason: 'Local library is empty and cloud has songs; download cloud songbook',
      localChecksum,
      cloudChecksum,
      baseChecksum,
    }
  }

  // 4. Local has changed since base, but cloud is unchanged from base
  if (baseChecksum && cloudChecksum === baseChecksum && localChecksum !== baseChecksum) {
    return {
      decision: 'UPLOAD',
      state: 'LOCAL_NEWER',
      reason: 'Local songbook has newer changes since last sync',
      localChecksum,
      cloudChecksum,
      baseChecksum,
    }
  }

  // 5. Cloud has changed since base, but local is unchanged from base
  if (baseChecksum && localChecksum === baseChecksum && cloudChecksum !== baseChecksum) {
    return {
      decision: 'DOWNLOAD',
      state: 'CLOUD_NEWER',
      reason: 'Cloud songbook has newer changes since last sync',
      localChecksum,
      cloudChecksum,
      baseChecksum,
    }
  }

  // 6. Diverged state: both changed or no common base
  return {
    decision: 'CONFLICT',
    state: 'CONFLICT',
    reason: 'Local and cloud songbooks have diverged with independent changes',
    localChecksum,
    cloudChecksum,
    baseChecksum,
  }
}

// Preserve both the persisted string format and legacy array tags without collisions.
function songTags(song: ActiveSongState): string | string[] {
  return Array.isArray(song.tags) ? [...song.tags].sort() : (song.tags || '')
}

export function songEquals(a: ActiveSongState, b: ActiveSongState): boolean {
  return (
    a.title === b.title &&
    (a.artist || '') === (b.artist || '') &&
    (a.key || '') === (b.key || '') &&
    (a.originalKey || '') === (b.originalKey || '') &&
    (a.capo || '') === (b.capo || '') &&
    (a.bpm || '') === (b.bpm || '') &&
    (a.time || '') === (b.time || '') &&
    (a.year || '') === (b.year || '') &&
    (a.format || 'PLAIN') === (b.format || 'PLAIN') &&
    Number(a.transposeOffset || 0) === Number(b.transposeOffset || 0) &&
    (a.rawContent || '').replace(/\r\n/g, '\n') === (b.rawContent || '').replace(/\r\n/g, '\n') &&
    Boolean(a.isDeleted) === Boolean(b.isDeleted) &&
    JSON.stringify(songTags(a)) === JSON.stringify(songTags(b)) &&
    Boolean(a.isFavorite) === Boolean(b.isFavorite) &&
    (a.createdAt ?? null) === (b.createdAt ?? null) &&
    (a.lastOpenedAt ?? null) === (b.lastOpenedAt ?? null) &&
    Boolean(a.isMissing) === Boolean(b.isMissing)
  )
}

export function setlistEquals(a: WebSetlist, b: WebSetlist): boolean {
  if (a.name !== b.name) return false
  if (Boolean(a.isDeleted) !== Boolean(b.isDeleted)) return false
  if (a.songs.length !== b.songs.length) return false
  for (let i = 0; i < a.songs.length; i++) {
    const sA = a.songs[i]
    const sB = b.songs[i]
    if (String(sA.id || '') !== String(sB.id || '')) return false
    if (sA.title !== sB.title) return false
    if ((sA.artist || '') !== (sB.artist || '')) return false
  }
  return true
}

/**
 * Reconciles local and remote songbooks deterministically by stable UUID.
 * Never silently destroys differing edits: generates non-destructive conflict copies.
 */
export function reconcileSongbook(
  local: SyncLibrary,
  remote: SyncLibrary,
  base?: SyncLibrary | null
): ReconciliationResult {
  const conflicts: ConflictingItem[] = []
  const baseSongsMap = new Map<string, ActiveSongState>()
  if (base) {
    for (const s of base.songs) {
      if (s.id !== undefined && s.id !== null) {
        baseSongsMap.set(String(s.id), s)
      }
    }
  }

  const localSongsMap = new Map<string, ActiveSongState>()
  for (const s of local.songs) {
    if (s.id !== undefined && s.id !== null) {
      localSongsMap.set(String(s.id), s)
    }
  }

  const remoteSongsMap = new Map<string, ActiveSongState>()
  for (const s of remote.songs) {
    if (s.id !== undefined && s.id !== null) {
      remoteSongsMap.set(String(s.id), s)
    }
  }

  const allSongIds = new Set<string>([...localSongsMap.keys(), ...remoteSongsMap.keys()])
  const mergedSongs: ActiveSongState[] = []

  for (const id of allSongIds) {
    const localSong = localSongsMap.get(id)
    const remoteSong = remoteSongsMap.get(id)
    const baseSong = baseSongsMap.get(id)

    if (localSong && !remoteSong) {
      // Exists only locally
      if (baseSong && songEquals(localSong, baseSong)) {
        // Was deleted remotely, unchanged locally -> accept remote deletion
      } else {
        // Added locally or modified locally -> keep local
        mergedSongs.push(localSong)
      }
    } else if (!localSong && remoteSong) {
      // Exists only remotely
      if (baseSong && songEquals(remoteSong, baseSong)) {
        // Was deleted locally, unchanged remotely -> accept local deletion
      } else {
        // Added remotely or modified remotely -> keep remote
        mergedSongs.push(remoteSong)
      }
    } else if (localSong && remoteSong) {
      // Exists in both
      if (songEquals(localSong, remoteSong)) {
        mergedSongs.push(localSong)
      } else if (baseSong && songEquals(localSong, baseSong)) {
        // Local unchanged, remote modified -> accept remote
        mergedSongs.push(remoteSong)
      } else if (baseSong && songEquals(remoteSong, baseSong)) {
        // Remote unchanged, local modified -> accept local
        mergedSongs.push(localSong)
      } else {
        // True concurrent divergence or deletion asymmetry
        const localTombstone = Boolean(localSong.isDeleted)
        const remoteTombstone = Boolean(remoteSong.isDeleted)

        if (!baseSong) {
          conflicts.push({ id, type: 'song', title: localSong.title,
            reason: 'Different local and cloud versions share an ID without a common base' })
          mergedSongs.push(localSong, { ...remoteSong, id: generateUUID(), title: `${remoteSong.title} (Cloud Copy)` })
        } else if (localTombstone && remoteTombstone) {
          // Both sides marked it deleted -> keep tombstone without creating conflict copy
          mergedSongs.push({ ...localSong, isDeleted: true })
        } else if (localTombstone && !remoteTombstone) {
          // Local deleted it, remote edited it -> Conflict! Keep tombstone, preserve remote edit as active conflict copy
          conflicts.push({
            id,
            type: 'song',
            title: remoteSong.title,
            reason: 'Song was deleted locally while modified in the cloud',
          })
          mergedSongs.push(localSong)
          const conflictCopyId = generateUUID()
          const conflictCopy: ActiveSongState = {
            ...remoteSong,
            id: conflictCopyId,
            title: `${remoteSong.title} (Cloud Copy)`,
            isDeleted: false,
          }
          mergedSongs.push(conflictCopy)
        } else if (!localTombstone && remoteTombstone) {
          // Remote deleted it, local modified it -> Conflict! Keep edited local
          conflicts.push({
            id,
            type: 'song',
            title: localSong.title,
            reason: 'Song was modified locally while deleted in the cloud',
          })
          mergedSongs.push(localSong)
        } else {
          // Differing live edits require preservation even without a common base item.
          conflicts.push({
            id,
            type: 'song',
            title: localSong.title,
            reason: 'Both local and cloud versions were edited independently',
          })
          // Safe non-destructive preservation: keep local, duplicate remote as conflict copy
          mergedSongs.push(localSong)
          const conflictCopyId = generateUUID()
          const conflictCopy: ActiveSongState = {
            ...remoteSong,
            id: conflictCopyId,
            title: `${remoteSong.title} (Cloud Copy)`,
          }
          mergedSongs.push(conflictCopy)
        }
      }
    }
  }

  // Reconcile Setlists
  const baseSetlistsMap = new Map<string, WebSetlist>()
  if (base) {
    for (const sl of base.setlists) {
      if (sl.id !== undefined && sl.id !== null) {
        baseSetlistsMap.set(String(sl.id), sl)
      }
    }
  }

  const localSetlistsMap = new Map<string, WebSetlist>()
  for (const sl of local.setlists) {
    if (sl.id !== undefined && sl.id !== null) {
      localSetlistsMap.set(String(sl.id), sl)
    }
  }

  const remoteSetlistsMap = new Map<string, WebSetlist>()
  for (const sl of remote.setlists) {
    if (sl.id !== undefined && sl.id !== null) {
      remoteSetlistsMap.set(String(sl.id), sl)
    }
  }

  const allSetlistIds = new Set<string>([...localSetlistsMap.keys(), ...remoteSetlistsMap.keys()])
  const mergedSetlists: WebSetlist[] = []

  for (const id of allSetlistIds) {
    const localSl = localSetlistsMap.get(id)
    const remoteSl = remoteSetlistsMap.get(id)
    const baseSl = baseSetlistsMap.get(id)

    if (localSl && !remoteSl) {
      // Exists only locally
      if (baseSl && setlistEquals(localSl, baseSl)) {
        // Was deleted remotely, unchanged locally -> accept remote deletion
      } else {
        // Added locally or modified locally -> keep local
        mergedSetlists.push(localSl)
      }
    } else if (!localSl && remoteSl) {
      // Exists only remotely
      if (baseSl && setlistEquals(remoteSl, baseSl)) {
        // Was deleted locally, unchanged remotely -> accept local deletion
      } else {
        // Added remotely or modified remotely -> keep remote
        mergedSetlists.push(remoteSl)
      }
    } else if (localSl && remoteSl) {
      // Exists in both
      if (setlistEquals(localSl, remoteSl)) {
        mergedSetlists.push(localSl)
      } else if (baseSl && setlistEquals(localSl, baseSl)) {
        // Local unchanged from base, remote modified -> accept remote
        mergedSetlists.push(remoteSl)
      } else if (baseSl && setlistEquals(remoteSl, baseSl)) {
        // Remote unchanged from base, local modified -> accept local
        mergedSetlists.push(localSl)
      } else if (!baseSl) {
        // No common base and different: concurrent addition under same ID!
        conflicts.push({
          id,
          type: 'setlist',
          title: localSl.name,
          reason: 'Both local and cloud setlists were added independently with the same ID',
        })
        mergedSetlists.push(localSl)
        const conflictCopyId = generateUUID()
        const conflictCopy: WebSetlist = {
          ...remoteSl,
          id: conflictCopyId,
          name: `${remoteSl.name} (Cloud Copy)`,
          songs: remoteSl.songs.map((ref) => ({ ...ref })),
        }
        mergedSetlists.push(conflictCopy)
      } else {
        // Both modified from base! Check if one side was tombstoned vs edited, or both edited
        const localTombstone = Boolean(localSl.isDeleted)
        const remoteTombstone = Boolean(remoteSl.isDeleted)

        if (localTombstone && remoteTombstone) {
          // Both sides marked it deleted -> keep tombstone without creating conflict copy
          mergedSetlists.push({ ...localSl, isDeleted: true })
        } else if (localTombstone && !remoteTombstone) {
          // Local deleted it, remote edited it -> Conflict! Keep tombstone locally or conflict copy of remote
          conflicts.push({
            id,
            type: 'setlist',
            title: remoteSl.name,
            reason: 'Setlist was deleted locally while modified in the cloud',
          })
          mergedSetlists.push(localSl)
          const conflictCopyId = generateUUID()
          const conflictCopy: WebSetlist = {
            ...remoteSl,
            id: conflictCopyId,
            name: `${remoteSl.name} (Cloud Copy)`,
            isDeleted: false,
            songs: remoteSl.songs.map((ref) => ({ ...ref })),
          }
          mergedSetlists.push(conflictCopy)
        } else if (!localTombstone && remoteTombstone) {
          // Remote deleted it, local edited it -> Conflict! Keep edited local, tombstone copy
          conflicts.push({
            id,
            type: 'setlist',
            title: localSl.name,
            reason: 'Setlist was modified locally while deleted in the cloud',
          })
          mergedSetlists.push(localSl)
        } else {
          // True concurrent divergence: both edited name, order, or songs
          conflicts.push({
            id,
            type: 'setlist',
            title: localSl.name,
            reason: 'Both local and cloud setlists were edited independently',
          })
          // Deterministic non-destructive rule: keep local setlist, duplicate remote with (Cloud Copy)
          mergedSetlists.push(localSl)
          const conflictCopyId = generateUUID()
          const conflictCopy: WebSetlist = {
            ...remoteSl,
            id: conflictCopyId,
            name: `${remoteSl.name} (Cloud Copy)`,
            songs: remoteSl.songs.map((ref) => ({ ...ref })),
          }
          mergedSetlists.push(conflictCopy)
        }
      }
    }
  }

  return {
    merged: {
      songs: mergedSongs,
      setlists: mergedSetlists,
    },
    conflicts,
    hasConflicts: conflicts.length > 0,
  }
}

/**
 * Safely parses response JSON, returning null if body is empty or non-JSON (e.g. HTML 404/500/SPA fallback)
 */
async function safeParseJsonResponse<T>(res: Response | { ok?: boolean; status?: number; headers?: Headers | { get?: (h: string) => string | null }; json?: () => Promise<unknown>; text?: () => Promise<string> }): Promise<{ parsed: T | null; rawText: string; isJson: boolean }> {
  // If response object provides text(), read it to inspect raw body
  if (typeof res.text === 'function') {
    let rawText: string
    try {
      rawText = await res.text()
    } catch {
      return { parsed: null, rawText: '', isJson: false }
    }

    const contentType = (res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : null) || ''
    const trimmed = rawText.trim()
    const looksLikeJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))

    if (!looksLikeJson && !contentType.includes('application/json')) {
      return { parsed: null, rawText, isJson: false }
    }

    try {
      const parsed = JSON.parse(rawText) as T
      return { parsed, rawText, isJson: true }
    } catch {
      return { parsed: null, rawText, isJson: false }
    }
  }

  // Fallback for mocked test environments where only .json() is defined on the response object
  if (typeof res.json === 'function') {
    try {
      const parsed = (await res.json()) as T
      return { parsed, rawText: JSON.stringify(parsed), isJson: true }
    } catch {
      return { parsed: null, rawText: '', isJson: false }
    }
  }

  return { parsed: null, rawText: '', isJson: false }
}

/**
 * Executes Cloud Songbook Sync against the server API
 */
async function executeCloudSongbookSync(
  token: string,
  options?: {
    forceAction?: 'upload' | 'download' | 'merge_preserve'
    localLibraryOverride?: SyncLibrary
    storage?: Storage
  },
  retry?: { attempt: number; base: SyncLibrary; userId: string | null }
): Promise<CloudSyncResult> {
  const targetStorage = options?.storage || (typeof localStorage !== 'undefined' ? localStorage : ({} as Storage))

  // 1. Read and normalize local library
  const persistedAtStart = readPersistedLibrary(targetStorage)
  const rawLocal = options?.localLibraryOverride || persistedAtStart
  if (!rawLocal) {
    return {
      success: false,
      status: 'ERROR',
      state: 'OFFLINE_OR_CLOUD_FAILURE',
      actionTaken: 'NONE',
      error: 'No local songbook library available to sync',
    }
  }

  const normalized = normalizeSongbookIds(rawLocal.songs, rawLocal.setlists)
  const localLibrary: SyncLibrary = {
    songs: normalized.songs,
    setlists: normalized.setlists,
  }

  // 2. Fetch remote cloud songbook record
  let cloudRecord: CloudSongbookRecord | null
  let currentUserId: string | null
  try {
    const res = await fetch('/api/songbook/sync', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })

    const { parsed, rawText, isJson } = await safeParseJsonResponse<{
      success: boolean
      cloudRecord: CloudSongbookRecord | null
      userId?: string
      error?: string
    }>(res)

    if (!res.ok) {
      let errMsg = `Cloud server error (${res.status})`
      if (parsed?.error) {
        errMsg = parsed.error
      } else if (!isJson) {
        errMsg = `Cloud sync endpoint returned non-JSON (${res.status}): ${rawText.slice(0, 100).trim() || 'Empty response'}`
      }
      const isAuthError = res.status === 401 || res.status === 403
      return {
        success: false,
        status: isAuthError ? 'ERROR' : 'OFFLINE',
        state: 'OFFLINE_OR_CLOUD_FAILURE',
        actionTaken: 'NONE',
        error: res.status === 401 ? 'Session expired or unauthorized. Please sign in again.' : errMsg,
      }
    }

    if (!isJson || !parsed) {
      return {
        success: false,
        status: 'ERROR',
        state: 'OFFLINE_OR_CLOUD_FAILURE',
        actionTaken: 'NONE',
        error: `Cloud sync endpoint returned invalid non-JSON response (${res.status}): ${rawText.slice(0, 100).trim() || 'Empty body'}`,
      }
    }

    cloudRecord = parsed.cloudRecord
    currentUserId = parsed.userId || cloudRecord?.userId || null
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      status: 'OFFLINE',
      state: 'OFFLINE_OR_CLOUD_FAILURE',
      actionTaken: 'NONE',
      error: `Network failure: ${errMsg}`,
    }
  }

  if (retry && retry.userId !== currentUserId) {
    return { success: false, status: 'ERROR', state: 'CONFLICT', actionTaken: 'NONE',
      error: 'Account changed during reconciliation. Local data preserved; sign in again and export a backup.' }
  }

  // A rejected upload is reconciled against a fresh GET, never replayed blindly.
  const recoverConflict = async (pending: SyncLibrary): Promise<CloudSyncResult> => {
    try {
      const key = `gtar_sync_recovery:concurrency:${Date.now()}:${generateUUID()}`
      const snapshot = JSON.stringify({ local: pending, remote: cloudRecord?.data ?? null })
      targetStorage.setItem(key, snapshot)
      if (targetStorage.getItem(key) !== snapshot) throw new Error('Recovery snapshot unavailable')
      if ((retry?.attempt ?? 0) >= 2) {
        return { success: false, status: 'CONFLICT', state: 'CONFLICT', actionTaken: 'CONFLICT_DETECTED',
          error: 'Cloud keeps changing. Local edits and recovery snapshot preserved. Export a backup and retry sync when other devices are idle.' }
      }
      // Preserve edits made in this browser while the request was in flight.
      const latest = readPersistedLibrary(targetStorage)
      const preserved = latest && persistedAtStart && (retry || !options?.localLibraryOverride)
        ? reconcileSongbook(latest, pending, persistedAtStart).merged : pending
      const result = await executeCloudSongbookSync(token, {
        storage: targetStorage, forceAction: 'merge_preserve', localLibraryOverride: preserved,
      }, { attempt: (retry?.attempt ?? 0) + 1,
        base: cloudRecord?.data ?? { songs: [], setlists: [] }, userId: currentUserId })
      if (!result.success) result.error = `${result.error || 'Reconciliation incomplete'} Local edits and recovery snapshot preserved; reconnect and retry, or export a backup.`
      return result
    } catch (err) {
      return { success: false, status: 'ERROR', state: 'CONFLICT', actionTaken: 'NONE',
        error: `Cannot safely reconcile: ${err instanceof Error ? err.message : String(err)}. Local edits preserved; export a backup before retrying.` }
    }
  }

  // 3. Evaluate Decision
  let baseMeta = readCloudSyncMeta(targetStorage)
  const baseOwnerMatches = baseMeta.lastSyncedUserId === currentUserId
  // Strict multi-user isolation: if baseMeta belonged to a different user, clear it from decision
  if (currentUserId && baseMeta.lastSyncedUserId && baseMeta.lastSyncedUserId !== currentUserId) {
    baseMeta = {
      lastSyncedChecksum: null,
      lastSyncedAt: null,
      cloudVersion: null,
      lastSyncedUserId: currentUserId,
    }
  }

  const decisionResult = evaluateSyncDecision({
    localData: localLibrary,
    cloudRecord,
    baseMeta,
    isOffline: false,
  })

  // 4. Check for forceAction overrides or execute decided action
  const actionToExecute = retry && decisionResult.decision === 'NOOP' ? 'NOOP'
    : retry && !cloudRecord ? 'UPLOAD' : options?.forceAction
    ? options.forceAction === 'upload'
      ? 'UPLOAD'
      : options.forceAction === 'download'
      ? 'DOWNLOAD'
      : 'MERGE'
    : decisionResult.decision

  if (actionToExecute === 'NOOP') {
    try {
      const latest = readPersistedLibrary(targetStorage)
      const appliedLibrary = latest && persistedAtStart
        ? reconcileSongbook(latest, localLibrary, persistedAtStart).merged : localLibrary
      persistLibrary(appliedLibrary, targetStorage)
      saveCloudSyncMeta(
        {
          lastSyncedChecksum: decisionResult.localChecksum,
          lastSyncedAt: Date.now(),
          cloudVersion: cloudRecord?.version ?? baseMeta.cloudVersion,
          lastSyncedUserId: currentUserId || baseMeta.lastSyncedUserId,
        },
        targetStorage
      )
      saveCloudSyncBase(localLibrary, targetStorage)
      return {
        success: true,
        status: 'IN_SYNC',
        state: 'SAME_STATE',
        actionTaken: 'NONE',
        version: cloudRecord?.version,
        checksum: decisionResult.localChecksum,
        updatedLibrary: appliedLibrary,
      }
    } catch (err) {
      return { success: false, status: 'ERROR', state: decisionResult.state, actionTaken: 'NONE',
        error: `Cannot apply reconciled songbook: ${err instanceof Error ? err.message : String(err)}. Export a backup before retrying.` }
    }
  }

  if (actionToExecute === 'UPLOAD') {
    try {
      // Explicit replacement must also retain the cloud revision being replaced.
      if (options?.forceAction === 'upload' && cloudRecord) {
        const recoveryKey = `gtar_sync_recovery:upload:${Date.now()}:${generateUUID()}`
        const recoverySnapshot = JSON.stringify({ local: localLibrary, remote: cloudRecord.data })
        try {
          targetStorage.setItem(recoveryKey, recoverySnapshot)
          if (targetStorage.getItem(recoveryKey) !== recoverySnapshot) throw new Error('Snapshot readback failed')
        } catch {
          return { success: false, status: 'ERROR', state: decisionResult.state, actionTaken: 'NONE',
            error: 'Recovery snapshot could not be saved. Free browser storage or export a backup before replacing the cloud songbook.' }
        }
      }
      const uploadRes = await fetch('/api/songbook/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'upload',
          data: localLibrary,
          clientChecksum: decisionResult.localChecksum,
          expectedVersion: cloudRecord?.version ?? 0,
          expectedChecksum: cloudRecord?.checksum ?? null,
        }),
        signal: AbortSignal.timeout(15000),
      })

      const { parsed: uploadParsed, rawText: uploadRaw, isJson: uploadIsJson } = await safeParseJsonResponse<{
        success: boolean
        cloudRecord: { version: number; checksum: string; updatedAt: string }
        userId?: string
        error?: string
      }>(uploadRes)

      if (uploadRes.status === 409) return recoverConflict(localLibrary)

      if (!uploadRes.ok) {
        let errStr = `Upload failed (${uploadRes.status})`
        if (uploadParsed?.error) {
          errStr = uploadParsed.error
        } else if (!uploadIsJson) {
          errStr = `Upload returned non-JSON (${uploadRes.status}): ${uploadRaw.slice(0, 100).trim() || 'Empty response'}`
        }
        const isAuthError = uploadRes.status === 401 || uploadRes.status === 403
        return {
          success: false,
          status: isAuthError ? 'ERROR' : 'OFFLINE',
          state: decisionResult.state,
          actionTaken: 'NONE',
          error: uploadRes.status === 401 ? 'Session expired or unauthorized. Please sign in again.' : errStr,
        }
      }

      if (!uploadIsJson || !uploadParsed) {
        return {
          success: false,
          status: 'ERROR',
          state: decisionResult.state,
          actionTaken: 'NONE',
          error: `Upload returned invalid non-JSON response (${uploadRes.status}): ${uploadRaw.slice(0, 100).trim() || 'Empty body'}`,
        }
      }

      const uploadData = uploadParsed
      const latest = readPersistedLibrary(targetStorage)
      const appliedLibrary = latest && persistedAtStart
        ? reconcileSongbook(latest, localLibrary, persistedAtStart).merged : localLibrary
      persistLibrary(appliedLibrary, targetStorage)

      saveCloudSyncMeta(
        {
          lastSyncedChecksum: uploadData.cloudRecord.checksum,
          lastSyncedAt: Date.now(),
          cloudVersion: uploadData.cloudRecord.version,
          lastSyncedUserId: uploadData.userId || currentUserId || baseMeta.lastSyncedUserId,
        },
        targetStorage
      )
      saveCloudSyncBase(localLibrary, targetStorage)

      return {
        success: true,
        status: 'IN_SYNC',
        state: decisionResult.state,
        actionTaken: 'UPLOADED',
        version: uploadData.cloudRecord.version,
        checksum: uploadData.cloudRecord.checksum,
        updatedLibrary: appliedLibrary,
      }
    } catch (err) {
      return {
        success: false,
        status: 'OFFLINE',
        state: 'OFFLINE_OR_CLOUD_FAILURE',
        actionTaken: 'NONE',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  if (actionToExecute === 'DOWNLOAD' && cloudRecord) {
    try {
      const incoming = cloudRecord.data
      if (!incoming || !Array.isArray(incoming.songs) || !Array.isArray(incoming.setlists)) {
        return {
          success: false,
          status: 'ERROR',
          state: decisionResult.state,
          actionTaken: 'NONE',
          error: 'Cloud songbook payload is malformed or missing songs/setlists arrays',
        }
      }

      const normalizedIncoming = normalizeSongbookIds(incoming.songs, incoming.setlists)
      const downloadedLibrary: SyncLibrary = {
        songs: normalizedIncoming.songs,
        setlists: normalizedIncoming.setlists,
      }

      // Safety check referential integrity before committing downloaded library
      const integrity = validateSongbookIntegrity(downloadedLibrary.songs, downloadedLibrary.setlists)
      if (!integrity.isValid) {
        return {
          success: false,
          status: 'ERROR',
          state: decisionResult.state,
          actionTaken: 'NONE',
          error: `Downloaded cloud songbook failed referential integrity check: ${integrity.errors.join('; ')}`,
        }
      }

      // A download must not replace edits made while GET was in flight.
      const latest = readPersistedLibrary(targetStorage)
      if (JSON.stringify(latest) !== JSON.stringify(persistedAtStart)) {
        return { success: false, status: 'CONFLICT', state: 'CONFLICT', actionTaken: 'NONE',
          error: 'Local library changed during cloud download. Current edits preserved. Retry sync and merge, or export a backup.' }
      }

      // Read back durable recovery before any destructive local replacement.
      const recoveryKey = `gtar_sync_recovery:download:${Date.now()}:${generateUUID()}`
      const recoverySnapshot = JSON.stringify(latest ?? localLibrary)
      try {
        targetStorage.setItem(recoveryKey, recoverySnapshot)
        if (targetStorage.getItem(recoveryKey) !== recoverySnapshot) throw new Error('Snapshot readback failed')
      } catch (err) {
        throw new Error('Recovery snapshot could not be saved. Free browser storage or export a backup before retrying download.', { cause: err })
      }

      persistLibrary(downloadedLibrary, targetStorage)

      saveCloudSyncMeta(
        {
          lastSyncedChecksum: cloudRecord.checksum,
          lastSyncedAt: Date.now(),
          cloudVersion: cloudRecord.version,
          lastSyncedUserId: currentUserId || baseMeta.lastSyncedUserId,
        },
        targetStorage
      )
      saveCloudSyncBase(downloadedLibrary, targetStorage)

      return {
        success: true,
        status: 'IN_SYNC',
        state: decisionResult.state,
        actionTaken: 'DOWNLOADED',
        version: cloudRecord.version,
        checksum: cloudRecord.checksum,
        updatedLibrary: downloadedLibrary,
      }
    } catch (err) {
      return {
        success: false,
        status: 'ERROR',
        state: decisionResult.state,
        actionTaken: 'NONE',
        error: `Failed to apply downloaded cloud songbook: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  const storedBase = readCloudSyncBase(targetStorage)
  const baseSnapshot = retry?.base ?? (baseOwnerMatches && storedBase &&
    computeSongbookChecksum(storedBase) === baseMeta.lastSyncedChecksum ? storedBase : null)

  if (actionToExecute === 'MERGE' && cloudRecord) {
    try {
      const incoming = cloudRecord.data
      if (!incoming || !Array.isArray(incoming.songs) || !Array.isArray(incoming.setlists)) {
        return {
          success: false,
          status: 'ERROR',
          state: 'CONFLICT',
          actionTaken: 'NONE',
          error: 'Cloud songbook payload is malformed or missing songs/setlists arrays',
        }
      }

      if (!baseSnapshot) {
        return { success: false, status: 'CONFLICT', state: 'CONFLICT', actionTaken: 'CONFLICT_DETECTED',
          error: 'Common sync snapshot unavailable. Local edits preserved. Export a backup before choosing upload or download.' }
      }
      const reconciliation = reconcileSongbook(localLibrary, incoming, baseSnapshot)
      const mergedLib = reconciliation.merged

      // Referential check on merged library before persisting or uploading
      const integrity = validateSongbookIntegrity(mergedLib.songs, mergedLib.setlists)
      if (!integrity.isValid) {
        return {
          success: false,
          status: 'ERROR',
          state: 'CONFLICT',
          actionTaken: 'NONE',
          error: `Merged songbook failed referential integrity check: ${integrity.errors.join('; ')}`,
        }
      }

      // Require durable recovery before attempting a merge write.
      const recoveryKey = `gtar_sync_recovery:merge:${Date.now()}:${generateUUID()}`
      const recoverySnapshot = JSON.stringify({ local: localLibrary, remote: incoming })
      targetStorage.setItem(recoveryKey, recoverySnapshot)
      if (targetStorage.getItem(recoveryKey) !== recoverySnapshot) {
        throw new Error('Recovery snapshot unavailable. Export a backup before retrying.')
      }

      // Upload merged to cloud
      const uploadRes = await fetch('/api/songbook/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'resolve',
          data: mergedLib,
          clientChecksum: computeSongbookChecksum(mergedLib),
          expectedVersion: cloudRecord.version,
          expectedChecksum: cloudRecord.checksum,
        }),
        signal: AbortSignal.timeout(15000),
      })

      const { parsed: uploadParsed, rawText: uploadRaw, isJson: uploadIsJson } = await safeParseJsonResponse<{
        success: boolean
        cloudRecord: { version: number; checksum: string; updatedAt: string }
        userId?: string
        error?: string
      }>(uploadRes)

      if (uploadRes.status === 409) return recoverConflict(mergedLib)

      if (!uploadRes.ok) {
        let errStr = `Upload of merged songbook failed (${uploadRes.status})`
        if (uploadParsed?.error) {
          errStr = uploadParsed.error
        } else if (!uploadIsJson) {
          errStr = `Upload of merged songbook returned non-JSON (${uploadRes.status}): ${uploadRaw.slice(0, 100).trim() || 'Empty response'}`
        }
        const isAuthError = uploadRes.status === 401 || uploadRes.status === 403
        return {
          success: false,
          status: isAuthError ? 'ERROR' : 'OFFLINE',
          state: 'CONFLICT',
          actionTaken: 'NONE',
          error: uploadRes.status === 401 ? 'Session expired or unauthorized. Please sign in again.' : errStr,
        }
      }

      if (!uploadIsJson || !uploadParsed) {
        return {
          success: false,
          status: 'ERROR',
          state: 'CONFLICT',
          actionTaken: 'NONE',
          error: `Upload of merged songbook returned invalid non-JSON response (${uploadRes.status}): ${uploadRaw.slice(0, 100).trim() || 'Empty body'}`,
        }
      }

      const uploadData = uploadParsed
      const latest = readPersistedLibrary(targetStorage)
      const appliedLibrary = latest && persistedAtStart && (retry || !options?.localLibraryOverride)
        ? reconcileSongbook(latest, mergedLib, persistedAtStart).merged : mergedLib
      // Persist before acknowledging sync metadata. The base remains the uploaded
      // revision even if newer in-flight browser edits are still pending locally.
      persistLibrary(appliedLibrary, targetStorage)

      saveCloudSyncMeta(
        {
          lastSyncedChecksum: uploadData.cloudRecord.checksum,
          lastSyncedAt: Date.now(),
          cloudVersion: uploadData.cloudRecord.version,
          lastSyncedUserId: uploadData.userId || currentUserId || baseMeta.lastSyncedUserId,
        },
        targetStorage
      )
      saveCloudSyncBase(mergedLib, targetStorage)

      return {
        success: true,
        status: 'IN_SYNC',
        state: 'CONFLICT',
        actionTaken: 'MERGED',
        version: uploadData.cloudRecord.version,
        checksum: uploadData.cloudRecord.checksum,
        conflicts: reconciliation.conflicts,
        updatedLibrary: appliedLibrary,
      }
    } catch (err) {
      return {
        success: false,
        status: 'ERROR',
        state: 'CONFLICT',
        actionTaken: 'NONE',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // Conflict without explicit resolution command: report conflict details safely
  const reconciliation = cloudRecord ? reconcileSongbook(localLibrary, cloudRecord.data, baseSnapshot) : { conflicts: [] }
  return {
    success: false,
    status: 'CONFLICT',
    state: 'CONFLICT',
    actionTaken: 'CONFLICT_DETECTED',
    error: 'Conflicting edits detected between local device and cloud.',
    conflicts: reconciliation.conflicts,
  }
}

export function performCloudSongbookSync(
  token: string,
  options?: {
    forceAction?: 'upload' | 'download' | 'merge_preserve'
    localLibraryOverride?: SyncLibrary
    storage?: Storage
  }
): Promise<CloudSyncResult> {
  return executeCloudSongbookSync(token, options)
}
