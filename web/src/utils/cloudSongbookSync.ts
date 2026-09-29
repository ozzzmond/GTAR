import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'
import { readPersistedLibrary, persistLibrary } from './syncJournal'
import { normalizeSongbookIds, validateSongbookIntegrity } from './songbookFoundation'
import { generateUUID } from './uuid'

export const CLOUD_SYNC_META_KEY = 'gtar_cloud_sync_meta'

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
      capo: (s.capo || '').trim(),
      bpm: (s.bpm || '').trim(),
      format: String(s.format || 'PLAIN'),
      transposeOffset: Number(s.transposeOffset || 0),
      rawContent: (s.rawContent || '').replace(/\r\n/g, '\n'),
      isDeleted: Boolean(s.isDeleted),
      tags: Array.isArray(s.tags) ? [...s.tags].sort().join(',') : '',
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const setlists = [...library.setlists]
    .map((sl) => ({
      id: String(sl.id || ''),
      name: (sl.name || '').trim(),
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

function songEquals(a: ActiveSongState, b: ActiveSongState): boolean {
  return (
    a.title === b.title &&
    (a.artist || '') === (b.artist || '') &&
    (a.key || '') === (b.key || '') &&
    (a.capo || '') === (b.capo || '') &&
    (a.bpm || '') === (b.bpm || '') &&
    (a.format || 'PLAIN') === (b.format || 'PLAIN') &&
    Number(a.transposeOffset || 0) === Number(b.transposeOffset || 0) &&
    (a.rawContent || '').replace(/\r\n/g, '\n') === (b.rawContent || '').replace(/\r\n/g, '\n') &&
    Boolean(a.isDeleted) === Boolean(b.isDeleted)
  )
}

function setlistEquals(a: WebSetlist, b: WebSetlist): boolean {
  if (a.name !== b.name) return false
  if (a.songs.length !== b.songs.length) return false
  for (let i = 0; i < a.songs.length; i++) {
    const sA = a.songs[i]
    const sB = b.songs[i]
    if (String(sA.id || '') !== String(sB.id || '')) return false
    if (sA.title !== sB.title) return false
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
        // BOTH sides modified differently! True record conflict!
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

  // Reconcile Setlists
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

    if (localSl && !remoteSl) {
      mergedSetlists.push(localSl)
    } else if (!localSl && remoteSl) {
      mergedSetlists.push(remoteSl)
    } else if (localSl && remoteSl) {
      if (setlistEquals(localSl, remoteSl)) {
        mergedSetlists.push(localSl)
      } else {
        // Merge setlist song references without duplicates
        const seenRefs = new Set<string>()
        const combinedRefs = [...localSl.songs, ...remoteSl.songs].filter((ref) => {
          const key = ref.id ? String(ref.id) : ref.title
          if (seenRefs.has(key)) return false
          seenRefs.add(key)
          return true
        })
        mergedSetlists.push({
          ...localSl,
          songs: combinedRefs,
        })
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
 * Executes Cloud Songbook Sync against the server API
 */
export async function performCloudSongbookSync(
  token: string,
  options?: {
    forceAction?: 'upload' | 'download' | 'merge_preserve'
    localLibraryOverride?: SyncLibrary
    storage?: Storage
  }
): Promise<CloudSyncResult> {
  const targetStorage = options?.storage || (typeof localStorage !== 'undefined' ? localStorage : ({} as Storage))

  // 1. Read and normalize local library
  const rawLocal = options?.localLibraryOverride || readPersistedLibrary(targetStorage)
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
  try {
    const res = await fetch('/api/songbook/sync', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })

    if (!res.ok) {
      let errMsg = `Cloud server error (${res.status})`
      try {
        const errJson = (await res.json()) as { error?: string }
        if (errJson?.error) errMsg = errJson.error
      } catch {
        // ignore
      }
      return {
        success: false,
        status: res.status === 403 ? 'ERROR' : 'OFFLINE',
        state: 'OFFLINE_OR_CLOUD_FAILURE',
        actionTaken: 'NONE',
        error: errMsg,
      }
    }

    const data = (await res.json()) as {
      success: boolean
      cloudRecord: CloudSongbookRecord | null
    }
    cloudRecord = data.cloudRecord
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

  // 3. Evaluate Decision
  const baseMeta = readCloudSyncMeta(targetStorage)
  const decisionResult = evaluateSyncDecision({
    localData: localLibrary,
    cloudRecord,
    baseMeta,
    isOffline: false,
  })

  // 4. Check for forceAction overrides or execute decided action
  const actionToExecute = options?.forceAction
    ? options.forceAction === 'upload'
      ? 'UPLOAD'
      : options.forceAction === 'download'
      ? 'DOWNLOAD'
      : 'MERGE'
    : decisionResult.decision

  if (actionToExecute === 'NOOP') {
    saveCloudSyncMeta(
      {
        lastSyncedChecksum: decisionResult.localChecksum,
        lastSyncedAt: Date.now(),
        cloudVersion: cloudRecord?.version ?? baseMeta.cloudVersion,
      },
      targetStorage
    )
    return {
      success: true,
      status: 'IN_SYNC',
      state: 'SAME_STATE',
      actionTaken: 'NONE',
      version: cloudRecord?.version,
      checksum: decisionResult.localChecksum,
      updatedLibrary: localLibrary,
    }
  }

  if (actionToExecute === 'UPLOAD') {
    try {
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
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (!uploadRes.ok) {
        let errStr = `Upload failed (${uploadRes.status})`
        try {
          const errData = (await uploadRes.json()) as { error?: string }
          if (errData?.error) errStr = errData.error
        } catch {
          // ignore
        }
        return {
          success: false,
          status: 'ERROR',
          state: decisionResult.state,
          actionTaken: 'NONE',
          error: errStr,
        }
      }

      const uploadData = (await uploadRes.json()) as {
        success: boolean
        cloudRecord: { version: number; checksum: string; updatedAt: string }
      }

      saveCloudSyncMeta(
        {
          lastSyncedChecksum: uploadData.cloudRecord.checksum,
          lastSyncedAt: Date.now(),
          cloudVersion: uploadData.cloudRecord.version,
        },
        targetStorage
      )

      return {
        success: true,
        status: 'IN_SYNC',
        state: decisionResult.state,
        actionTaken: 'UPLOADED',
        version: uploadData.cloudRecord.version,
        checksum: uploadData.cloudRecord.checksum,
        updatedLibrary: localLibrary,
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
      const normalizedIncoming = normalizeSongbookIds(incoming.songs, incoming.setlists)
      const downloadedLibrary: SyncLibrary = {
        songs: normalizedIncoming.songs,
        setlists: normalizedIncoming.setlists,
      }

      // Safety check referential integrity
      validateSongbookIntegrity(downloadedLibrary.songs, downloadedLibrary.setlists)

      // Save safety snapshot of local data before replacing
      try {
        targetStorage.setItem(`gtar_sync_recovery:${Date.now()}`, JSON.stringify(localLibrary))
      } catch {
        // quota
      }

      persistLibrary(downloadedLibrary, targetStorage)

      saveCloudSyncMeta(
        {
          lastSyncedChecksum: cloudRecord.checksum,
          lastSyncedAt: Date.now(),
          cloudVersion: cloudRecord.version,
        },
        targetStorage
      )

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

  if (actionToExecute === 'MERGE' && cloudRecord) {
    try {
      const reconciliation = reconcileSongbook(localLibrary, cloudRecord.data)
      const mergedLib = reconciliation.merged

      // Persist merged locally
      persistLibrary(mergedLib, targetStorage)

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
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (!uploadRes.ok) {
        throw new Error(`Upload of merged songbook failed (${uploadRes.status})`)
      }

      const uploadData = (await uploadRes.json()) as {
        success: boolean
        cloudRecord: { version: number; checksum: string; updatedAt: string }
      }

      saveCloudSyncMeta(
        {
          lastSyncedChecksum: uploadData.cloudRecord.checksum,
          lastSyncedAt: Date.now(),
          cloudVersion: uploadData.cloudRecord.version,
        },
        targetStorage
      )

      return {
        success: true,
        status: 'IN_SYNC',
        state: 'CONFLICT',
        actionTaken: 'MERGED',
        version: uploadData.cloudRecord.version,
        checksum: uploadData.cloudRecord.checksum,
        conflicts: reconciliation.conflicts,
        updatedLibrary: mergedLib,
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
  const reconciliation = cloudRecord ? reconcileSongbook(localLibrary, cloudRecord.data) : { conflicts: [] }
  return {
    success: false,
    status: 'CONFLICT',
    state: 'CONFLICT',
    actionTaken: 'CONFLICT_DETECTED',
    error: 'Conflicting edits detected between local device and cloud.',
    conflicts: reconciliation.conflicts,
  }
}
