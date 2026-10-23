import { canonicalCatalogLineage } from './catalogSetlistLineage'
import { libraryRevision, restoreLibraryRevision, isQuotaError, writeRecoverySnapshot, recoverySnapshotFailureMessage, RecoveryRetentionError, readPersistedLibrary, persistLibrary, setLastKnownPersistedLibraryRaw } from './syncJournal'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'
import { normalizeSongbookIds, validateSongbookIntegrity } from './songbookFoundation'
import { generateUUID } from './uuid'
import {
  CLOUD_THEME_SETTINGS_VERSION,
  DEFAULT_CUSTOM_COLORS,
  THEME_MODES,
  validateCloudThemeSettings,
  normalizeCloudThemeSettings,
  readCloudThemeSettings,
  persistCloudThemeSettings,
  cloudThemeSettingsEquals,
  isCustomizedThemeSettings,
  type CloudThemeSettings,
  type ThemeMode,
  type FactoryThemeOverrides,
  type CustomThemeColors,
} from './backupSettings'

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
  type: 'song' | 'setlist' | 'theme'
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
 * Preserves exact legacy checksum semantics when themeSettings is absent.
 */
export function computeSongbookChecksum(library: SyncLibrary): string {
  const songs = [...library.songs]
    .map((s) => ({
      id: String(s.id || ''),
      title: (s.title || '').trim(),
      artist: (s.artist || '').trim(),
      key: (s.key || '').trim(),
      originalKey: (s.originalKey || '').trim(),
      ...(s.confirmedChartKey ? { confirmedChartKey: s.confirmedChartKey } : {}),
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
      sharedSourceSongId: s.sharedSourceSongId || null,
      sharedSourceRevision: s.sharedSourceRevision ?? null,
      publishedCatalogSongId: s.publishedCatalogSongId || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const setlists = [...library.setlists]
    .map((sl) => ({
      id: String(sl.id || ''),
      ...(sl.catalogSource ? { catalogSource: canonicalCatalogLineage(sl.catalogSource) } : {}),
      name: (sl.name || '').trim(),
      isDeleted: Boolean(sl.isDeleted),
      songs: (sl.songs || []).map((ref) => ({
        id: ref.id !== undefined ? String(ref.id) : '',
        title: (ref.title || '').trim(),
        artist: (ref.artist || '').trim(),
      })),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const canonicalPayload =
    library.themeSettings !== undefined
      ? { songs, setlists, themeSettings: normalizeCloudThemeSettings(library.themeSettings) }
      : { songs, setlists }
  const canonicalString = JSON.stringify(canonicalPayload)

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
    let themeSettings: CloudThemeSettings | undefined
    if (parsed.themeSettings !== undefined) {
      if (validateCloudThemeSettings(parsed.themeSettings).length > 0) {
        return null
      }
      themeSettings = normalizeCloudThemeSettings(parsed.themeSettings)
    }
    return {
      songs: parsed.songs,
      setlists: parsed.setlists,
      ...(themeSettings !== undefined ? { themeSettings } : {}),
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

  const hasLocalSongsOrSetlists = localData.songs.length > 0 || localData.setlists.length > 0
  const hasLocalTheme = localData.themeSettings !== undefined
  const hasLocalCustomTheme = isCustomizedThemeSettings(localData.themeSettings)

  // 1. Cloud has no record
  if (!cloudRecord) {
    if (!hasLocalSongsOrSetlists && !hasLocalTheme) {
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

  const isValidCloudArrays = Boolean(
    cloudRecord.data &&
      Array.isArray(cloudRecord.data.songs) &&
      Array.isArray(cloudRecord.data.setlists)
  )
  const hasCloudSongsOrSetlists =
    isValidCloudArrays &&
    (cloudRecord.data.songs.length > 0 || cloudRecord.data.setlists.length > 0)
  const cloudTheme = isValidCloudArrays ? cloudRecord.data.themeSettings : undefined
  const hasCloudTheme = cloudTheme !== undefined
  const hasCloudCustomTheme = isCustomizedThemeSettings(cloudTheme)
  const localSongsSetlistsChecksum = computeSongbookChecksum({
    songs: localData.songs,
    setlists: localData.setlists,
  })
  const cloudSongsSetlistsChecksum = isValidCloudArrays
    ? computeSongbookChecksum({
        songs: cloudRecord.data.songs,
        setlists: cloudRecord.data.setlists,
      })
    : null
  const songsSetlistsEqual =
    cloudSongsSetlistsChecksum !== null && localSongsSetlistsChecksum === cloudSongsSetlistsChecksum

  // 3. First sync (no baseChecksum)
  if (!baseChecksum) {
    if (
      !hasLocalSongsOrSetlists &&
      (!hasLocalCustomTheme || !hasCloudCustomTheme || cloudThemeSettingsEquals(localData.themeSettings, cloudTheme)) &&
      (hasCloudSongsOrSetlists || (hasCloudTheme && !hasLocalCustomTheme))
    ) {
      return {
        decision: 'DOWNLOAD',
        state: 'CLOUD_ONLY',
        reason: 'Local library is empty and cloud has songs; download cloud songbook',
        localChecksum,
        cloudChecksum,
        baseChecksum,
      }
    }
    if (!hasCloudSongsOrSetlists && !hasCloudCustomTheme && (hasLocalSongsOrSetlists || hasLocalCustomTheme)) {
      return {
        decision: 'UPLOAD',
        state: 'LOCAL_NEWER',
        reason: 'Local songbook or theme customization exists while cloud is empty/default; upload local data',
        localChecksum,
        cloudChecksum,
        baseChecksum,
      }
    }
    if (songsSetlistsEqual) {
      if (cloudThemeSettingsEquals(localData.themeSettings, cloudTheme)) {
        return {
          decision: 'NOOP',
          state: 'SAME_STATE',
          reason: 'Local and cloud songbooks and themes are identical',
          localChecksum,
          cloudChecksum,
          baseChecksum,
        }
      }
      if (hasLocalCustomTheme && !hasCloudCustomTheme) {
        return {
          decision: 'UPLOAD',
          state: 'LOCAL_NEWER',
          reason: 'Local theme customization preserved over default/absent cloud theme',
          localChecksum,
          cloudChecksum,
          baseChecksum,
        }
      }
      if (hasCloudCustomTheme && !hasLocalCustomTheme) {
        return {
          decision: 'DOWNLOAD',
          state: 'CLOUD_NEWER',
          reason: 'Cloud theme customization downloaded over default/absent local theme',
          localChecksum,
          cloudChecksum,
          baseChecksum,
        }
      }
      if (!hasLocalCustomTheme && !hasCloudCustomTheme) {
        if (hasLocalTheme && !hasCloudTheme) {
          return {
            decision: 'UPLOAD',
            state: 'LOCAL_NEWER',
            reason: 'Local theme settings uploaded to legacy cloud record',
            localChecksum,
            cloudChecksum,
            baseChecksum,
          }
        }
        if (!hasLocalTheme && hasCloudTheme) {
          return {
            decision: 'DOWNLOAD',
            state: 'CLOUD_NEWER',
            reason: 'Cloud theme settings downloaded to local device',
            localChecksum,
            cloudChecksum,
            baseChecksum,
          }
        }
      }
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

  // 5. Cloud has changed since base, but local is unchanged from base (or legacy base where local songs/setlists are unchanged)
  if (
    baseChecksum &&
    (localChecksum === baseChecksum ||
      (localSongsSetlistsChecksum === baseChecksum &&
        (!hasLocalCustomTheme || !hasCloudTheme))) &&
    cloudChecksum !== baseChecksum
  ) {
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
    (a.confirmedChartKey || '') === (b.confirmedChartKey || '') &&
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
    Boolean(a.isMissing) === Boolean(b.isMissing) &&
    (a.publishedCatalogSongId || null) === (b.publishedCatalogSongId || null)
  )
}

export function setlistEquals(a: WebSetlist, b: WebSetlist): boolean {
  if (JSON.stringify(canonicalCatalogLineage(a.catalogSource)) !== JSON.stringify(canonicalCatalogLineage(b.catalogSource))) return false
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
    .join(',')}}`
}

/**
 * Deterministic RFC 4122 v4-shaped UUID derived from a seed. Used for conflict
 * copies so repeated reconciliation of the same alternatives yields the same ID.
 */
function deterministicUuid(seed: string): string {
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b1, 0x85ebca6b]
  const bytes = new Uint8Array(16)
  seeds.forEach((init, part) => {
    let h = init >>> 0
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i) + part
      h = Math.imul(h, 0x01000193) >>> 0
    }
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d) >>> 0
    h ^= h >>> 12
    for (let b = 0; b < 4; b++) bytes[part * 4 + b] = (h >>> (b * 8)) & 0xff
  })
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Identity = kind + stable source ID + canonical revision content (never the display name alone). */
function conflictCopyId(kind: 'song' | 'setlist', sourceId: string, item: unknown): string {
  const { id: _ignored, ...content } = item as Record<string, unknown>
  void _ignored
  return deterministicUuid(`gtar-conflict-copy:${kind}:${sourceId}:${stableStringify(content)}`)
}

type SongIdRemap = Map<string, string>

/** Rebind only references carrying a stable ID that has an explicit resolved mapping. Never guesses by title/artist. */
function rebindSetlist(sl: WebSetlist, remap: SongIdRemap): WebSetlist {
  if (remap.size === 0) return sl
  let changed = false
  const songs = sl.songs.map((ref) => {
    const mapped = ref.id !== undefined && ref.id !== null ? remap.get(String(ref.id)) : undefined
    if (mapped === undefined) return ref
    changed = true
    return { ...ref, id: mapped }
  })
  return changed ? { ...sl, songs } : sl
}

/** Direction-independent winner for two tombstones with differing content. */
function pickTombstoneWinner<T>(a: T, b: T): T {
  return stableStringify(a) <= stableStringify(b) ? a : b
}

/**
 * Reconciles local and remote songbooks deterministically by stable UUID.
 * Never silently destroys differing edits: generates non-destructive conflict copies
 * whose IDs are derived from source ID + revision content, so repeated reconciliation
 * of the same unresolved alternatives is idempotent.
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
  // Source song ID -> resolved copy ID, per origin side, for setlist provenance.
  const localRemap: SongIdRemap = new Map()
  const remoteRemap: SongIdRemap = new Map()

  // A copy that already exists on either side is handled by its own iteration (idempotent, keeps user edits).
  const pushSongCopy = (copy: ActiveSongState) => {
    if (localSongsMap.has(String(copy.id)) || remoteSongsMap.has(String(copy.id))) return
    if (mergedSongs.some((s) => s.id === copy.id)) return
    mergedSongs.push(copy)
  }
  const songCopy = (id: string, source: ActiveSongState, origin: 'Cloud' | 'Local', live: boolean) => {
    const copy: ActiveSongState = {
      ...source,
      id: conflictCopyId('song', id, source),
      title: `${source.title} (${origin} Copy)`,
    }
    if (live) copy.isDeleted = false
    return copy
  }

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
        const localTombstone = Boolean(localSong.isDeleted)
        const remoteTombstone = Boolean(remoteSong.isDeleted)

        if (localTombstone && remoteTombstone && !baseSong) {
          // No common base: retain both tombstoned revisions until explicit resolution
          conflicts.push({ id, type: 'song', title: localSong.title,
            reason: 'Different local and cloud versions share an ID without a common base' })
          mergedSongs.push(localSong)
          pushSongCopy(songCopy(id, remoteSong, 'Cloud', false))
        } else if (localTombstone && remoteTombstone) {
          // Both deleted: keep one tombstone, direction-independent; both revisions stay in recovery snapshots
          mergedSongs.push({ ...pickTombstoneWinner(localSong, remoteSong), isDeleted: true })
        } else if (localTombstone !== remoteTombstone) {
          // Delete vs edit is handled identically in both directions, with or without a common base:
          // keep the tombstone and preserve the edited revision as a recoverable copy.
          const deleted = localTombstone ? localSong : remoteSong
          const edited = localTombstone ? remoteSong : localSong
          const origin = localTombstone ? 'Cloud' : 'Local'
          conflicts.push({
            id,
            type: 'song',
            title: edited.title,
            reason: localTombstone
              ? 'Song was deleted locally while modified in the cloud'
              : 'Song was modified locally while deleted in the cloud',
          })
          const copy = songCopy(id, edited, origin, true)
          // Local-origin revision first so ordering is stable regardless of direction
          if (localTombstone) {
            mergedSongs.push({ ...deleted, isDeleted: true })
            pushSongCopy(copy)
          } else {
            pushSongCopy(copy)
            mergedSongs.push({ ...deleted, isDeleted: true })
          }
          ;(localTombstone ? remoteRemap : localRemap).set(id, String(copy.id))
        } else if (!baseSong) {
          conflicts.push({ id, type: 'song', title: localSong.title,
            reason: 'Different local and cloud versions share an ID without a common base' })
          const copy = songCopy(id, remoteSong, 'Cloud', false)
          mergedSongs.push(localSong)
          pushSongCopy(copy)
          remoteRemap.set(id, String(copy.id))
        } else {
          // Differing live edits require preservation even without a common base item.
          conflicts.push({
            id,
            type: 'song',
            title: localSong.title,
            reason: 'Both local and cloud versions were edited independently',
          })
          // Safe non-destructive preservation: keep local, duplicate remote as conflict copy
          const copy = songCopy(id, remoteSong, 'Cloud', false)
          mergedSongs.push(localSong)
          pushSongCopy(copy)
          remoteRemap.set(id, String(copy.id))
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

  const pushSetlistCopy = (copy: WebSetlist) => {
    if (localSetlistsMap.has(String(copy.id)) || remoteSetlistsMap.has(String(copy.id))) return
    if (mergedSetlists.some((s) => s.id === copy.id)) return
    mergedSetlists.push(copy)
  }
  const setlistCopy = (id: string, source: WebSetlist, origin: 'Cloud' | 'Local', remap: SongIdRemap, live: boolean) => {
    const rebound = rebindSetlist(source, remap)
    const copy: WebSetlist = {
      ...rebound,
      id: conflictCopyId('setlist', id, source),
      name: `${source.name} (${origin} Copy)`,
      songs: rebound.songs.map((ref) => ({ ...ref })),
    }
    if (live) copy.isDeleted = false
    return copy
  }

  for (const id of allSetlistIds) {
    const localSl = localSetlistsMap.get(id)
    const remoteSl = remoteSetlistsMap.get(id)
    const baseSl = baseSetlistsMap.get(id)

    if (localSl && !remoteSl) {
      // Exists only locally
      if (baseSl && setlistEquals(localSl, baseSl)) {
        // Was deleted remotely, unchanged locally -> accept remote deletion
      } else {
        // Added locally or modified locally -> keep local, bound to its own resolved charts
        mergedSetlists.push(rebindSetlist(localSl, localRemap))
      }
    } else if (!localSl && remoteSl) {
      // Exists only remotely
      if (baseSl && setlistEquals(remoteSl, baseSl)) {
        // Was deleted locally, unchanged remotely -> accept local deletion
      } else {
        // Added remotely or modified remotely -> keep remote, bound to the remote chart revisions
        mergedSetlists.push(rebindSetlist(remoteSl, remoteRemap))
      }
    } else if (localSl && remoteSl) {
      // Exists in both
      const reboundRemote = rebindSetlist(remoteSl, remoteRemap)
      const reboundLocal = rebindSetlist(localSl, localRemap)
      if (setlistEquals(localSl, remoteSl) || setlistEquals(reboundLocal, reboundRemote)) {
        // Identical references bind to the surviving original IDs; a prior resolution is idempotent
        mergedSetlists.push(setlistEquals(localSl, remoteSl) ? localSl : reboundLocal)
      } else if (baseSl && setlistEquals(localSl, baseSl)) {
        // Local unchanged from base, remote modified -> accept remote
        mergedSetlists.push(reboundRemote)
      } else if (baseSl && setlistEquals(remoteSl, baseSl)) {
        // Remote unchanged from base, local modified -> accept local
        mergedSetlists.push(reboundLocal)
      } else {
        const localTombstone = Boolean(localSl.isDeleted)
        const remoteTombstone = Boolean(remoteSl.isDeleted)

        if (localTombstone && remoteTombstone) {
          // Both sides marked it deleted -> keep one tombstone without creating conflict copy
          mergedSetlists.push({ ...pickTombstoneWinner(localSl, remoteSl), isDeleted: true })
        } else if (localTombstone !== remoteTombstone) {
          // Symmetric delete vs edit, with or without a common base
          const deleted = localTombstone ? localSl : remoteSl
          const edited = localTombstone ? remoteSl : localSl
          conflicts.push({
            id,
            type: 'setlist',
            title: edited.name,
            reason: localTombstone
              ? 'Setlist was deleted locally while modified in the cloud'
              : 'Setlist was modified locally while deleted in the cloud',
          })
          mergedSetlists.push({ ...deleted, isDeleted: true })
          pushSetlistCopy(setlistCopy(id, edited, localTombstone ? 'Cloud' : 'Local',
            localTombstone ? remoteRemap : localRemap, true))
        } else if (!baseSl) {
          // No common base and different: concurrent addition under same ID!
          conflicts.push({
            id,
            type: 'setlist',
            title: localSl.name,
            reason: 'Both local and cloud setlists were added independently with the same ID',
          })
          mergedSetlists.push(reboundLocal)
          pushSetlistCopy(setlistCopy(id, remoteSl, 'Cloud', remoteRemap, false))
        } else {
          // True concurrent divergence: both edited name, order, or songs
          conflicts.push({
            id,
            type: 'setlist',
            title: localSl.name,
            reason: 'Both local and cloud setlists were edited independently',
          })
          // Deterministic non-destructive rule: keep local setlist, duplicate remote with (Cloud Copy)
          mergedSetlists.push(reboundLocal)
          pushSetlistCopy(setlistCopy(id, remoteSl, 'Cloud', remoteRemap, false))
        }
      }
    }
  }

  const mergedThemeSettings = reconcileThemeSettings(local.themeSettings, remote.themeSettings, base, conflicts)

  return {
    merged: {
      songs: mergedSongs,
      setlists: mergedSetlists,
      ...(mergedThemeSettings !== undefined ? { themeSettings: mergedThemeSettings } : {}),
    },
    conflicts,
    hasConflicts: conflicts.length > 0,
  }
}

function reconcileThemeSettings(
  localTheme: CloudThemeSettings | undefined,
  remoteTheme: CloudThemeSettings | undefined,
  base: SyncLibrary | null | undefined,
  conflicts: ConflictingItem[]
): CloudThemeSettings | undefined {
  if (localTheme === undefined && remoteTheme === undefined) {
    return undefined
  }
  // Missing legacy remote themeSettings never resets local themes
  if (remoteTheme === undefined) {
    return localTheme ? normalizeCloudThemeSettings(localTheme) : undefined
  }
  if (localTheme === undefined) {
    return normalizeCloudThemeSettings(remoteTheme)
  }

  const normLocal = normalizeCloudThemeSettings(localTheme)
  const normRemote = normalizeCloudThemeSettings(remoteTheme)

  if (cloudThemeSettingsEquals(normLocal, normRemote)) {
    return normLocal
  }

  if (!base) {
    const localCustom = isCustomizedThemeSettings(normLocal)
    const remoteCustom = isCustomizedThemeSettings(normRemote)
    if (!localCustom && remoteCustom) {
      return normRemote
    }
    if (localCustom && !remoteCustom) {
      return normLocal
    }
    conflicts.push({
      id: 'theme:settings',
      type: 'theme',
      title: 'Stage Color Theme',
      reason: 'Local and cloud theme customizations diverged without a common sync base',
    })
    return normLocal
  }

  const normBase = normalizeCloudThemeSettings(
    base.themeSettings ?? {
      version: CLOUD_THEME_SETTINGS_VERSION,
      themeMode: 'solarized-dark',
      customThemeColors: DEFAULT_CUSTOM_COLORS,
      factoryThemeOverrides: {},
    }
  )

  if (cloudThemeSettingsEquals(normLocal, normBase)) {
    return normRemote
  }
  if (cloudThemeSettingsEquals(normRemote, normBase)) {
    return normLocal
  }

  const localMode = normLocal.themeMode ?? 'solarized-dark'
  const remoteMode = normRemote.themeMode ?? 'solarized-dark'
  const baseMode = normBase.themeMode ?? 'solarized-dark'
  let mergedMode: ThemeMode
  if (localMode === remoteMode) {
    mergedMode = localMode
  } else if (localMode === baseMode) {
    mergedMode = remoteMode
  } else if (remoteMode === baseMode) {
    mergedMode = localMode
  } else {
    mergedMode = localMode
    conflicts.push({
      id: 'theme:mode',
      type: 'theme',
      title: 'Active Theme Mode',
      reason: 'Active theme mode was changed differently on this device and in the cloud',
    })
  }

  const localPaletteJson = JSON.stringify(normLocal.customThemeColors)
  const remotePaletteJson = JSON.stringify(normRemote.customThemeColors)
  const basePaletteJson = JSON.stringify(normBase.customThemeColors)
  let mergedCustomPalette: CustomThemeColors
  if (localPaletteJson === remotePaletteJson) {
    mergedCustomPalette = normLocal.customThemeColors!
  } else if (localPaletteJson === basePaletteJson) {
    mergedCustomPalette = normRemote.customThemeColors!
  } else if (remotePaletteJson === basePaletteJson) {
    mergedCustomPalette = normLocal.customThemeColors!
  } else {
    mergedCustomPalette = normLocal.customThemeColors!
    conflicts.push({
      id: 'theme:custom-palette',
      type: 'theme',
      title: 'Custom Theme Palette',
      reason: 'Standalone custom palette was edited differently on this device and in the cloud',
    })
  }

  const mergedOverrides: FactoryThemeOverrides = {}
  for (const slot of THEME_MODES) {
    if (slot === 'custom') continue
    const lSlot = normLocal.factoryThemeOverrides?.[slot]
    const rSlot = normRemote.factoryThemeOverrides?.[slot]
    const bSlot = normBase.factoryThemeOverrides?.[slot]
    const lStr = lSlot ? JSON.stringify(lSlot) : null
    const rStr = rSlot ? JSON.stringify(rSlot) : null
    const bStr = bSlot ? JSON.stringify(bSlot) : null

    if (lStr === rStr) {
      if (lSlot) mergedOverrides[slot] = lSlot
    } else if (lStr === bStr) {
      if (rSlot) mergedOverrides[slot] = rSlot
    } else if (rStr === bStr) {
      if (lSlot) mergedOverrides[slot] = lSlot
    } else {
      if (lSlot) mergedOverrides[slot] = lSlot
      conflicts.push({
        id: `theme:factory:${slot}`,
        type: 'theme',
        title: `Factory Theme (${slot})`,
        reason: `Factory theme "${slot}" was customized differently on this device and in the cloud`,
      })
    }
  }

  return normalizeCloudThemeSettings({
    version: CLOUD_THEME_SETTINGS_VERSION,
    themeMode: mergedMode,
    customThemeColors: mergedCustomPalette,
    factoryThemeOverrides: mergedOverrides,
  })
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

  // 1. Read and normalize local library and theme settings
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

  let themeAtStart: CloudThemeSettings | undefined
  try {
    themeAtStart = readCloudThemeSettings(targetStorage)
  } catch (err) {
    return {
      success: false,
      status: 'ERROR',
      state: 'OFFLINE_OR_CLOUD_FAILURE',
      actionTaken: 'NONE',
      error: `Local theme settings failed validation: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  let localThemeSettings = themeAtStart
  if (options?.localLibraryOverride && 'themeSettings' in options.localLibraryOverride) {
    if (options.localLibraryOverride.themeSettings !== undefined) {
      const themeErrors = validateCloudThemeSettings(options.localLibraryOverride.themeSettings)
      if (themeErrors.length > 0) {
        return {
          success: false,
          status: 'ERROR',
          state: 'OFFLINE_OR_CLOUD_FAILURE',
          actionTaken: 'NONE',
          error: `Local theme settings failed validation: ${themeErrors.join('; ')}`,
        }
      }
      localThemeSettings = normalizeCloudThemeSettings(options.localLibraryOverride.themeSettings)
    } else {
      localThemeSettings = undefined
    }
  }

  const normalized = normalizeSongbookIds(rawLocal.songs, rawLocal.setlists)
  const localLibrary: SyncLibrary = {
    songs: normalized.songs,
    setlists: normalized.setlists,
    ...(localThemeSettings !== undefined ? { themeSettings: localThemeSettings } : {}),
  }
  const startSnapshot: SyncLibrary | null = persistedAtStart
    ? { ...persistedAtStart, ...(themeAtStart !== undefined ? { themeSettings: themeAtStart } : {}) }
    : null

  const readLatestWithTheme = (): SyncLibrary | null => {
    const latest = readPersistedLibrary(targetStorage)
    if (!latest) return null
    const latestTheme = readCloudThemeSettings(targetStorage)
    return {
      ...latest,
      ...(latestTheme !== undefined ? { themeSettings: latestTheme } : {}),
    }
  }

  const persistLibraryAndThemeAtomically = (
    libraryToApply: SyncLibrary,
    expectedRaw: string | null,
    shouldPersistTheme = true
  ) => {
    persistLibrary(libraryToApply, targetStorage, { expectedRaw })
    if (shouldPersistTheme && libraryToApply.themeSettings !== undefined) {
      try {
        persistCloudThemeSettings(libraryToApply.themeSettings, targetStorage)
      } catch (themeErr) {
        try {
          restoreLibraryRevision(expectedRaw, targetStorage)
          setLastKnownPersistedLibraryRaw(expectedRaw, targetStorage)
        } catch { /* Recovery snapshot already saved */ }
        throw themeErr
      }
    }
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

  // Validate remote themeSettings at client boundary before evaluation or application
  if (
    cloudRecord &&
    cloudRecord.data &&
    typeof cloudRecord.data === 'object' &&
    'themeSettings' in cloudRecord.data &&
    cloudRecord.data.themeSettings !== undefined
  ) {
    const remoteThemeErrors = validateCloudThemeSettings(cloudRecord.data.themeSettings)
    if (remoteThemeErrors.length > 0) {
      return {
        success: false,
        status: 'ERROR',
        state: 'OFFLINE_OR_CLOUD_FAILURE',
        actionTaken: 'NONE',
        error: `Cloud theme settings failed validation: ${remoteThemeErrors.join('; ')}`,
      }
    }
    cloudRecord = {
      ...cloudRecord,
      data: {
        ...cloudRecord.data,
        themeSettings: normalizeCloudThemeSettings(cloudRecord.data.themeSettings),
      },
    }
  }

  // A rejected upload is reconciled against a fresh GET, never replayed blindly.
  const recoverConflict = async (pending: SyncLibrary): Promise<CloudSyncResult> => {
    try {
      const key = `gtar_sync_recovery:concurrency:${Date.now()}:${generateUUID()}`
      const snapshot = JSON.stringify({ local: pending, remote: cloudRecord?.data ?? null })
      await writeRecoverySnapshot(key, snapshot, targetStorage)
      if (targetStorage.getItem(key) !== snapshot) throw new Error('Recovery snapshot unavailable')
      if ((retry?.attempt ?? 0) >= 2) {
        return { success: false, status: 'CONFLICT', state: 'CONFLICT', actionTaken: 'CONFLICT_DETECTED',
          error: 'Cloud keeps changing. Local edits and recovery snapshot preserved. Export a backup and retry sync when other devices are idle.' }
      }
      // Preserve edits made in this browser while the request was in flight.
      const latestFull = readLatestWithTheme()
      const preserved = latestFull && startSnapshot
        ? reconcileSongbook(latestFull, pending, startSnapshot).merged : pending
      const result = await executeCloudSongbookSync(token, {
        storage: targetStorage, forceAction: 'merge_preserve', localLibraryOverride: preserved,
      }, { attempt: (retry?.attempt ?? 0) + 1,
        base: cloudRecord?.data ?? { songs: [], setlists: [] }, userId: currentUserId })
      if (!result.success) result.error = `${result.error || 'Reconciliation incomplete'} Local edits and recovery snapshot preserved; reconnect and retry, or export a backup.`
      return result
    } catch (err) {
      return { success: false, status: 'ERROR', state: 'CONFLICT', actionTaken: 'NONE',
        error: isQuotaError(err) || err instanceof RecoveryRetentionError
          ? recoverySnapshotFailureMessage(err, 'sync')
          : `Cannot safely reconcile: ${err instanceof Error ? err.message : String(err)}. Local edits preserved; export a backup before retrying.` }
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

  const storedBase = readCloudSyncBase(targetStorage)
  const storedBaseFullChecksum = storedBase ? computeSongbookChecksum(storedBase) : null
  const storedBaseLegacyChecksum = storedBase
    ? computeSongbookChecksum({ songs: storedBase.songs, setlists: storedBase.setlists })
    : null
  const baseChecksumMatches =
    Boolean(storedBase && (storedBaseFullChecksum === baseMeta.lastSyncedChecksum || storedBaseLegacyChecksum === baseMeta.lastSyncedChecksum))
  const baseSnapshot = retry?.base ?? (baseOwnerMatches && baseChecksumMatches ? storedBase : null)

  const decisionResult = evaluateSyncDecision({
    localData: localLibrary,
    cloudRecord,
    baseMeta,
    isOffline: false,
  })

  // Support safe disjoint factory-theme-slot edits when a valid common base snapshot exists
  const canAutoMergeDisjointThemeEdits =
    !options?.forceAction &&
    !retry &&
    decisionResult.decision === 'CONFLICT' &&
    Boolean(cloudRecord && Array.isArray(cloudRecord.data?.songs) && Array.isArray(cloudRecord.data?.setlists)) &&
    Boolean(baseSnapshot) &&
    localLibrary.themeSettings !== undefined &&
    cloudRecord?.data?.themeSettings !== undefined &&
    !reconcileSongbook(localLibrary, cloudRecord.data, baseSnapshot).hasConflicts

  // 4. Check for forceAction overrides or execute decided action
  const actionToExecute = retry && decisionResult.decision === 'NOOP' ? 'NOOP'
    : retry && !cloudRecord ? 'UPLOAD' : options?.forceAction
    ? options.forceAction === 'upload'
      ? 'UPLOAD'
      : options.forceAction === 'download'
      ? 'DOWNLOAD'
      : 'MERGE'
    : canAutoMergeDisjointThemeEdits
    ? 'MERGE'
    : decisionResult.decision

  if (actionToExecute === 'NOOP') {
    try {
      const expectedRaw = libraryRevision(targetStorage)
      const latestFull = readLatestWithTheme()
      if (persistedAtStart && !latestFull) throw new Error('Local library removed during sync. Retry before replacing it.')
      if (!persistedAtStart && latestFull) throw new Error('Local library appeared during sync. Retry to preserve current edits.')
      const appliedLibrary = latestFull && startSnapshot
        ? reconcileSongbook(latestFull, localLibrary, startSnapshot).merged : localLibrary
      persistLibraryAndThemeAtomically(
        appliedLibrary,
        expectedRaw,
        appliedLibrary.themeSettings !== undefined && !cloudThemeSettingsEquals(appliedLibrary.themeSettings, latestFull?.themeSettings)
      )
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
          await writeRecoverySnapshot(recoveryKey, recoverySnapshot, targetStorage)
        } catch (err) {
          return { success: false, status: 'ERROR', state: decisionResult.state, actionTaken: 'NONE',
            error: recoverySnapshotFailureMessage(err, 'replacing the cloud songbook') }
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
      const expectedRaw = libraryRevision(targetStorage)
      const latestFull = readLatestWithTheme()
      if (persistedAtStart && !latestFull) throw new Error('Local library removed during sync. Retry before replacing it.')
      if (!persistedAtStart && latestFull) throw new Error('Local library appeared during sync. Retry to preserve current edits.')
      const appliedLibrary = latestFull && startSnapshot
        ? reconcileSongbook(latestFull, localLibrary, startSnapshot).merged : localLibrary
      persistLibraryAndThemeAtomically(
        appliedLibrary,
        expectedRaw,
        appliedLibrary.themeSettings !== undefined && !cloudThemeSettingsEquals(appliedLibrary.themeSettings, latestFull?.themeSettings)
      )

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
      const incomingTheme =
        incoming.themeSettings !== undefined ? normalizeCloudThemeSettings(incoming.themeSettings) : undefined
      const canonicalRemoteLibrary: SyncLibrary = {
        songs: normalizedIncoming.songs,
        setlists: normalizedIncoming.setlists,
        ...(incomingTheme !== undefined ? { themeSettings: incomingTheme } : {}),
      }

      // Safety check referential integrity before committing downloaded library
      const integrity = validateSongbookIntegrity(canonicalRemoteLibrary.songs, canonicalRemoteLibrary.setlists)
      if (!integrity.isValid) {
        return {
          success: false,
          status: 'ERROR',
          state: decisionResult.state,
          actionTaken: 'NONE',
          error: `Downloaded cloud songbook failed referential integrity check: ${integrity.errors.join('; ')}`,
        }
      }

      const expectedCloudChecksum = computeSongbookChecksum(canonicalRemoteLibrary)
      if (cloudRecord.checksum !== expectedCloudChecksum) {
        return {
          success: false,
          status: 'ERROR',
          state: decisionResult.state,
          actionTaken: 'NONE',
          error: `Cloud songbook checksum mismatch: expected ${cloudRecord.checksum}, computed ${expectedCloudChecksum}`,
        }
      }

      // Preserve local theme when remote is a legacy payload lacking themeSettings,
      // or on automatic first-sync download when remote theme is default and local is customized.
      const preserveLocalTheme =
        incomingTheme === undefined ||
        (!options?.forceAction &&
          !baseMeta.lastSyncedChecksum &&
          isCustomizedThemeSettings(localLibrary.themeSettings) &&
          !isCustomizedThemeSettings(incomingTheme))

      const effectiveTheme = preserveLocalTheme ? localLibrary.themeSettings : incomingTheme
      const downloadedLibrary: SyncLibrary = {
        songs: canonicalRemoteLibrary.songs,
        setlists: canonicalRemoteLibrary.setlists,
        ...(effectiveTheme !== undefined ? { themeSettings: effectiveTheme } : {}),
      }

      // A download must not replace edits made while GET was in flight.
      const expectedRaw = libraryRevision(targetStorage)
      const latest = readPersistedLibrary(targetStorage)
      const latestTheme = readCloudThemeSettings(targetStorage)
      if (
        JSON.stringify(latest) !== JSON.stringify(persistedAtStart) ||
        !cloudThemeSettingsEquals(latestTheme, themeAtStart)
      ) {
        return { success: false, status: 'CONFLICT', state: 'CONFLICT', actionTaken: 'NONE',
          error: 'Local library changed during cloud download. Current edits preserved. Retry sync and merge, or export a backup.' }
      }

      // Read back durable recovery before any destructive local replacement.
      const recoveryKey = `gtar_sync_recovery:download:${Date.now()}:${generateUUID()}`
      const recoveryCandidate: SyncLibrary = latest
        ? { ...latest, ...(themeAtStart !== undefined ? { themeSettings: themeAtStart } : {}) }
        : localLibrary
      const recoverySnapshot = JSON.stringify(recoveryCandidate)
      try {
        await writeRecoverySnapshot(recoveryKey, recoverySnapshot, targetStorage)
      } catch (err) {
        throw new Error(recoverySnapshotFailureMessage(err, 'download'), { cause: err })
      }

      // Storage estimation yields to the event loop: recheck both library and theme.
      if (libraryRevision(targetStorage) !== expectedRaw ||
          !cloudThemeSettingsEquals(readCloudThemeSettings(targetStorage), themeAtStart)) {
        return { success: false, status: 'CONFLICT', state: 'CONFLICT', actionTaken: 'NONE',
          error: 'Local library or theme updated in another tab or during recovery preparation. Current edits preserved. Retry download.' }
      }
      persistLibraryAndThemeAtomically(
        downloadedLibrary,
        expectedRaw,
        !preserveLocalTheme && incomingTheme !== undefined
      )

      saveCloudSyncMeta(
        {
          lastSyncedChecksum: cloudRecord.checksum,
          lastSyncedAt: Date.now(),
          cloudVersion: cloudRecord.version,
          lastSyncedUserId: currentUserId || baseMeta.lastSyncedUserId,
        },
        targetStorage
      )
      saveCloudSyncBase(canonicalRemoteLibrary, targetStorage)

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

      const normalizedIncoming = normalizeSongbookIds(incoming.songs, incoming.setlists)
      const incomingTheme =
        incoming.themeSettings !== undefined ? normalizeCloudThemeSettings(incoming.themeSettings) : undefined
      const canonicalRemoteLibrary: SyncLibrary = {
        songs: normalizedIncoming.songs,
        setlists: normalizedIncoming.setlists,
        ...(incomingTheme !== undefined ? { themeSettings: incomingTheme } : {}),
      }
      const remoteIntegrity = validateSongbookIntegrity(canonicalRemoteLibrary.songs, canonicalRemoteLibrary.setlists)
      if (!remoteIntegrity.isValid) {
        return {
          success: false,
          status: 'ERROR',
          state: 'CONFLICT',
          actionTaken: 'NONE',
          error: `Cloud songbook failed referential integrity check: ${remoteIntegrity.errors.join('; ')}`,
        }
      }
      const expectedRemoteChecksum = computeSongbookChecksum(canonicalRemoteLibrary)
      if (cloudRecord.checksum !== expectedRemoteChecksum) {
        return {
          success: false,
          status: 'ERROR',
          state: 'CONFLICT',
          actionTaken: 'NONE',
          error: `Cloud songbook checksum mismatch: expected ${cloudRecord.checksum}, computed ${expectedRemoteChecksum}`,
        }
      }

      const reconciliation = reconcileSongbook(localLibrary, canonicalRemoteLibrary, baseSnapshot)
      if (retry && reconciliation.conflicts.some((c) => c.type === 'theme')) {
        return {
          success: false,
          status: 'CONFLICT',
          state: 'CONFLICT',
          actionTaken: 'CONFLICT_DETECTED',
          error: 'Conflicting theme edits detected between local device and cloud.',
          conflicts: reconciliation.conflicts,
        }
      }
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
      try {
        await writeRecoverySnapshot(recoveryKey, recoverySnapshot, targetStorage)
      } catch (err) {
        // Nothing has been uploaded or persisted yet; never surface the raw browser quota text.
        return { success: false, status: 'ERROR', state: 'CONFLICT', actionTaken: 'NONE',
          error: recoverySnapshotFailureMessage(err, 'sync') }
      }
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
      const expectedRaw = libraryRevision(targetStorage)
      const latestFull = readLatestWithTheme()
      if (persistedAtStart && !latestFull) throw new Error('Local library removed during sync. Retry before replacing it.')
      if (!persistedAtStart && latestFull) throw new Error('Local library appeared during sync. Retry to preserve current edits.')
      const appliedLibrary = latestFull && startSnapshot
        ? reconcileSongbook(latestFull, mergedLib, startSnapshot).merged : mergedLib
      // Persist before acknowledging sync metadata. The base remains the uploaded
      // revision even if newer in-flight browser edits are still pending locally.
      persistLibraryAndThemeAtomically(
        appliedLibrary,
        expectedRaw,
        appliedLibrary.themeSettings !== undefined
      )

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
