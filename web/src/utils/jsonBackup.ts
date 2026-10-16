import { assertImportIds, canonicalImportId } from './importIdentity'
import { generateUUID } from './uuid'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { GTAR_APP_VERSION } from '../types/gtar'
import { readBackupSettings, validateBackupSettings, type BackupSettings } from './backupSettings'
import { bindLegacySetlists, ensureSongIds, partitionSongs, resolveSetlistSong, validateSetlistReferences } from './setlistSongs'
import { detectSongKey } from './songParser'
import { canonicalSongKey } from './musicalKey'

export const GTAR_BACKUP_SCHEMA_VERSION = 1
export const RESTORE_SNAPSHOT_KEY = 'gtar_restore_safety_snapshot_v1'

export interface BackupMetadata {
  schemaVersion?: number
  version?: string
  exportedAt?: string
  songCount: number
  setlistCount: number
  activeSetlistCount: number
  deletedSetlistCount: number
  trashCount: number
}

export interface FullBackupPayload extends BackupSettings {
  app: 'GTAR'
  schemaVersion: number
  version: string
  exportedAt: string
  exportType: 'FULL_BACKUP'
  songCount: number
  setlistCount: number
  trashCount: number
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  allowedUsers?: string[]
}
export interface ParsedBackupResult extends BackupSettings {
  isValid: boolean
  isSingleSetlist: boolean
  singleSetlistName?: string
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  allowedUsers?: string[]
  metadata?: BackupMetadata
  error?: string
}

export function normalizeBackupSong(s: Partial<ActiveSongState> & { content?: string }): ActiveSongState {
  const rawContent = s.rawContent ?? s.content ?? ''
  return {
    id: s.id === undefined ? generateUUID() : (typeof s.id === 'string' ? s.id.trim() : s.id), title: s.title!, artist: s.artist ?? '',
    key: canonicalSongKey(s.key ?? detectSongKey(rawContent)),
    ...(s.originalKey !== undefined && s.originalKey !== null ? { originalKey: canonicalSongKey(s.originalKey) } : {}),
    capo: s.capo ?? '', bpm: s.bpm ?? '120',
    ...(s.time !== undefined && s.time !== null ? { time: String(s.time).trim() } : {}),
    ...(s.year !== undefined && s.year !== null ? { year: String(s.year).trim() } : {}),
    format: s.format ?? 'CHORD_PRO', transposeOffset: s.transposeOffset ?? 0,
    rawContent,
    ...(s.tags !== undefined ? { tags: s.tags } : {}),
    ...(s.isFavorite !== undefined ? { isFavorite: s.isFavorite } : {}),
    ...(s.isDeleted !== undefined ? { isDeleted: s.isDeleted } : {}),
    ...(s.createdAt !== undefined ? { createdAt: s.createdAt } : {}),
    ...(s.lastOpenedAt !== undefined ? { lastOpenedAt: s.lastOpenedAt } : {}),
    ...(s.sharedSourceSongId !== undefined ? { sharedSourceSongId: s.sharedSourceSongId } : {}),
    ...(s.sharedSourceRevision !== undefined ? { sharedSourceRevision: s.sharedSourceRevision } : {}),
    ...(s.sharedSourcePublisherId !== undefined ? { sharedSourcePublisherId: s.sharedSourcePublisherId } : {}),
    ...(s.sharedSourcePublisherName !== undefined ? { sharedSourcePublisherName: s.sharedSourcePublisherName } : {}),
    ...(s.publishedCatalogSongId !== undefined ? { publishedCatalogSongId: s.publishedCatalogSongId } : {}),
  }
}

/** Download and clipboard share the same metadata and settings payload. */
export function createBackupPayload(songs: ActiveSongState[], setlists: WebSetlist[], version = GTAR_APP_VERSION, allowedUsers?: string[]): FullBackupPayload {
  const normalized = ensureSongIds(songs).map(normalizeBackupSong)
  const exportedSetlists = bindLegacySetlists(setlists, normalized)
  const errors = validateSetlistReferences(exportedSetlists, normalized)
  if (errors.length) throw new Error(`Backup blocked: ${errors.join('; ')}. Restore the missing songs or repair the setlist entries before exporting. Original data is unchanged.`)
  const partition = partitionSongs(normalized)
  return {
    app: 'GTAR',
    schemaVersion: GTAR_BACKUP_SCHEMA_VERSION,
    version,
    exportedAt: new Date().toISOString(),
    exportType: 'FULL_BACKUP',
    songCount: partition.active.length,
    setlistCount: exportedSetlists.length,
    trashCount: partition.deleted.length,
    ...readBackupSettings(),
    songs: normalized,
    setlists: exportedSetlists,
    ...(allowedUsers && Array.isArray(allowedUsers) ? { allowedUsers } : {})
  }
}

export function exportAllDataJson(songs: ActiveSongState[], setlists: WebSetlist[]): string {
  const filename = `gtar-stage-backup-${new Date().toISOString().slice(0, 10)}.json`
  triggerDownload(JSON.stringify(createBackupPayload(songs, setlists), null, 2), filename)
  return filename
}

export function createSingleSetlistPayload(setlist: WebSetlist, songs: ActiveSongState[]) {
  const resolved = setlist.songs.map(ref => {
    const song = resolveSetlistSong(ref, songs)
    if (!song) throw new Error(`Missing song: ${ref.title}. Restore it or remove its setlist entry before exporting.`)
    return normalizeBackupSong(song)
  })
  return { app: 'GTAR', version: GTAR_APP_VERSION, exportedAt: new Date().toISOString(),
    exportType: 'SINGLE_SETLIST', setlist: { ...setlist, songs: resolved } }
}

export function exportSingleSetlistJson(setlist: WebSetlist, songs: ActiveSongState[]): string {
  const name = setlist.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  const filename = `gtar-setlist-${name || 'export'}.json`
  triggerDownload(JSON.stringify(createSingleSetlistPayload(setlist, songs), null, 2), filename)
  return filename
}

/** Validate every entry before normalization or any caller can mutate library state. */
export function validateBackupEntries(songs: unknown[], setlists: unknown[], embedded = false): string[] {
  const errors: string[] = []
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const check = (value: unknown, path: string, song: boolean) => {
    if (!object(value)) { errors.push(`${path}: must be an object`); return }
    const required = song ? 'title' : 'name'
    if (typeof value[required] !== 'string' || !value[required].trim()) errors.push(`${path}.${required}: must be a non-empty string`)
    for (const field of ['artist', 'key', 'originalKey', 'capo', 'bpm', 'time', 'year', 'format', 'tags', 'rawContent', 'content']) {
      if (field in value && typeof value[field] !== 'string') errors.push(`${path}.${field}: must be a string`)
    }
    if (song && !('rawContent' in value) && !('content' in value)) errors.push(`${path}.rawContent: provide rawContent or content as a string`)
    if ('id' in value && !(typeof value.id === 'string' && value.id.trim()) && !(typeof value.id === 'number' && Number.isSafeInteger(value.id))) errors.push(`${path}.id: must be a non-empty string or integer`)
    for (const field of ['createdAt', 'lastOpenedAt']) {
      if (field in value && (typeof value[field] !== 'number' || !Number.isFinite(value[field]))) errors.push(`${path}.${field}: must be a finite number`)
    }
    if ('transposeOffset' in value && (typeof value.transposeOffset !== 'number' || !Number.isSafeInteger(value.transposeOffset) || value.transposeOffset < -11 || value.transposeOffset > 11)) errors.push(`${path}.transposeOffset: must be a safe integer from -11 to 11`)
    for (const field of ['isFavorite', 'isDeleted']) {
      if (field in value && typeof value[field] !== 'boolean') errors.push(`${path}.${field}: must be a boolean`)
    }
    if ('format' in value && (typeof value.format !== 'string' || !['CHORD_PRO', 'TWO_LINE', 'PLAIN'].includes(value.format))) errors.push(`${path}.format: unsupported song format`)
  }
  songs.forEach((song, i) => check(song, `songs[${i}]`, true))
  setlists.forEach((sl, i) => {
    const path = `setlists[${i}]`
    check(sl, path, false)
    if (!object(sl)) return
    if (!Array.isArray(sl.songs)) { errors.push(`${path}.songs: must be an array`); return }
    sl.songs.forEach((ref: unknown, j: number) => {
      const refPath = `${path}.songs[${j}]`
      if (embedded) { check(ref, refPath, true); return }
      if (!object(ref)) { errors.push(`${refPath}: must be an object`); return }
      if (typeof ref.title !== 'string' || !ref.title.trim()) errors.push(`${refPath}.title: must be a non-empty string`)
      if ('artist' in ref && typeof ref.artist !== 'string') errors.push(`${refPath}.artist: must be a string`)
      if ('id' in ref && !(typeof ref.id === 'string' && ref.id.trim()) && !(typeof ref.id === 'number' && Number.isSafeInteger(ref.id))) errors.push(`${refPath}.id: must be a non-empty string or integer`)
    })
  })
  return errors
}

export interface BackupParseOptions { mode?: 'replace' | 'merge'; existingSongs?: ActiveSongState[] }

export function parseBackupJson(rawText: string, options: BackupParseOptions = {}): ParsedBackupResult {
  const invalid = (errors: string[], single = false): ParsedBackupResult => ({ isValid: false, isSingleSetlist: single,
    songs: [], setlists: [], error: `Backup rejected:\n${errors.map(error => `- ${error}`).join('\n')}` })
  try {
    const data = JSON.parse(rawText)
    if (!data || typeof data !== 'object') return invalid(['Expected a backup object or song array'])
    if (data.exportType === 'RECOVERY_ARCHIVE') return invalid(['Recovery archive: preserves raw data for manual recovery; not a supported restore-ready backup'])
    const single = data.exportType === 'SINGLE_SETLIST' || 'setlist' in data
    const settings: BackupSettings = {}
    for (const field of ['themeMode', 'customThemeColors', 'factoryThemeOverrides', 'stageSettings'] as const) {
      if (field in data) Object.assign(settings, { [field]: data[field] })
    }
    const errors = validateBackupSettings(settings as Record<string, unknown>)
    if ('schemaVersion' in data && data.schemaVersion !== undefined && data.schemaVersion !== null) {
      if (typeof data.schemaVersion !== 'number' || !Number.isSafeInteger(data.schemaVersion) || data.schemaVersion < 1) {
        errors.push('schemaVersion: must be a positive integer')
      } else if (data.schemaVersion > GTAR_BACKUP_SCHEMA_VERSION) {
        errors.push(`schemaVersion: unsupported future schema version ${data.schemaVersion}`)
      }
    }
    for (const countField of ['songCount', 'setlistCount', 'trashCount'] as const) {
      if (countField in data && data[countField] !== undefined && data[countField] !== null) {
        if (typeof data[countField] !== 'number' || !Number.isSafeInteger(data[countField]) || data[countField] < 0) {
          errors.push(`${countField}: must be a non-negative integer`)
        }
      }
    }
    let sourceSongs: Partial<ActiveSongState>[] = []
    let sourceSetlists: WebSetlist[] = []
    if (single) {
      errors.push(...validateBackupEntries([], [data.setlist], true))
      sourceSongs = data.setlist?.songs ?? []
    } else {
      if (!Array.isArray(data) && !('songs' in data) && !('title' in data)) errors.push('songs: expected a backup songs array or a song object')
      if ('songs' in data && !Array.isArray(data.songs)) errors.push('songs: must be an array')
      if ('setlists' in data && !Array.isArray(data.setlists)) errors.push('setlists: must be an array')
      sourceSongs = Array.isArray(data) ? data : Array.isArray(data.songs) ? data.songs : 'title' in data ? [data] : []
      sourceSetlists = Array.isArray(data.setlists) ? data.setlists : []
      errors.push(...validateBackupEntries(sourceSongs, sourceSetlists))
    }
    const setlistIds = new Set<string>()
    sourceSetlists.forEach((sl, i) => {
      if (sl && typeof sl === 'object' && 'id' in sl && sl.id !== undefined && sl.id !== null) {
        const idStr = canonicalImportId(sl.id)
        if (setlistIds.has(idStr)) {
          errors.push(`setlists[${i}].id: duplicate setlist ID`)
        }
        setlistIds.add(idStr)
      }
    })
    if (errors.length) return invalid(errors, single)
    if (single) {
      // Embedded exports may repeat an ordered song reference. Share the song
      // only when both the original ID representation and complete chart agree.
      const unique = new Map<string, Partial<ActiveSongState>>()
      for (const song of sourceSongs) {
        const id = canonicalImportId(song.id)
        const previous = unique.get(id)
        if (previous && (previous.id !== song.id || JSON.stringify(normalizeBackupSong(previous)) !== JSON.stringify(normalizeBackupSong(song)))) {
          return invalid([`Embedded song canonical ID collision (${id}); conflicting chart revisions require explicit resolution.`], true)
        }
        unique.set(id, song)
      }
      sourceSongs = [...unique.values()]
    }
    assertImportIds(sourceSongs, 'Imported songs')
    assertImportIds(single ? [data.setlist] : sourceSetlists, 'Imported setlists')
    const songs = sourceSongs.map(normalizeBackupSong)
    const ids = new Set<string>()
    songs.forEach((song, i) => {
      if (ids.has(String(song.id))) errors.push(`songs[${i}].id: duplicate song ID`)
      ids.add(String(song.id))
    })
    const setlists: WebSetlist[] = single ? [{ ...data.setlist, id: canonicalImportId(data.setlist.id),
      ...(data.setlist.isDeleted !== undefined ? { isDeleted: Boolean(data.setlist.isDeleted) } : {}),
      songs: (data.setlist.songs as ActiveSongState[]).map(ref => {
        const song = songs.find(item => canonicalImportId(item.id) === canonicalImportId(ref.id))!
        return { id: song.id, title: song.title, artist: song.artist }
      }) }] : sourceSetlists.map(setlist => ({
        ...setlist,
        id: canonicalImportId(setlist.id),
        ...(setlist.isDeleted !== undefined ? { isDeleted: Boolean(setlist.isDeleted) } : {}),
        songs: setlist.songs.map(ref => ({ ...ref, ...(ref.id !== undefined ? { id: canonicalImportId(ref.id) } : {}) })) }))
    const combined = options.mode === 'merge'
      ? [...songs, ...(options.existingSongs ?? []).filter(song => !ids.has(String(song.id)))] : songs
    // Resolve title-only legacy references within the incoming backup first, so
    // merging that backup into a matching library does not create ambiguity.
    const boundIncoming = bindLegacySetlists(setlists, songs)
    errors.push(...validateSetlistReferences(boundIncoming, combined))
    if (errors.length) return invalid(errors, single)
    const allowedUsers = Array.isArray(data.allowedUsers)
      ? data.allowedUsers.filter((u: unknown) => typeof u === 'string' && (u as string).trim().length > 0)
      : undefined
    const partition = partitionSongs(songs)
    const metadata: BackupMetadata = {
      schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : undefined,
      version: typeof data.version === 'string' ? data.version : (typeof data.metadata?.appVersion === 'string' ? data.metadata.appVersion : undefined),
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : undefined,
      songCount: partition.active.length,
      setlistCount: setlists.length,
      activeSetlistCount: setlists.filter(setlist => !setlist.isDeleted).length,
      deletedSetlistCount: setlists.filter(setlist => setlist.isDeleted).length,
      trashCount: partition.deleted.length,
    }
    return { isValid: true, isSingleSetlist: single, ...(single ? { singleSetlistName: data.setlist.name } : {}),
      ...settings, songs, setlists: bindLegacySetlists(boundIncoming, combined),
      metadata,
      ...(allowedUsers ? { allowedUsers } : {}) }
  } catch (err) { return invalid([err instanceof Error ? err.message : 'Invalid JSON']) }
}

export interface RestoreSafetySnapshot {
  createdAt: string
  library: {
    songs: ActiveSongState[]
    setlists: WebSetlist[]
  }
}

export function createRestoreSafetySnapshot(
  library: { songs: ActiveSongState[]; setlists: WebSetlist[] },
  storage: Storage = localStorage
): void {
  const snapshot: RestoreSafetySnapshot = {
    createdAt: new Date().toISOString(),
    library: {
      songs: library.songs.map(s => ({ ...s })),
      setlists: library.setlists.map(sl => ({ ...sl, songs: sl.songs.map(ref => ({ ...ref })) })),
    },
  }
  const serialized = JSON.stringify(snapshot)
  // setItem replaces atomically: a failed write leaves the previous value intact.
  // Recovery archives may be unique copies; never evict them to make room.
  try {
    const previous = storage.getItem(RESTORE_SNAPSHOT_KEY)
    if (previous !== null && previous !== serialized) {
      // Retain the previous recovery bytes before replacing the current snapshot.
      const archiveKey = `gtar_sync_recovery:restore-snapshot:${generateUUID()}`
      storage.setItem(archiveKey, previous)
      if (storage.getItem(archiveKey) !== previous) throw new Error('Previous safety snapshot archive could not be verified')
    }
    storage.setItem(RESTORE_SNAPSHOT_KEY, serialized)
    if (storage.getItem(RESTORE_SNAPSHOT_KEY) !== serialized) throw new Error('Safety snapshot write could not be verified')
  } catch (err) {
    throw new Error('Pre-restore safety snapshot creation failed', { cause: err })
  }
}

export function getRestoreSafetySnapshot(storage: Storage = localStorage): RestoreSafetySnapshot | null {
  try {
    const raw = storage.getItem(RESTORE_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.library) return null
    return parsed as RestoreSafetySnapshot
  } catch {
    return null
  }
}

export function clearRestoreSafetySnapshot(storage: Storage = localStorage): void {
  try {
    storage.removeItem(RESTORE_SNAPSHOT_KEY)
  } catch {
    // Non-throwing cleanup
  }
}

export function restoreFromSafetySnapshot(storage: Storage = localStorage): { songs: ActiveSongState[]; setlists: WebSetlist[] } | null {
  const snapshot = getRestoreSafetySnapshot(storage)
  if (!snapshot) return null
  return snapshot.library
}

function triggerDownload(content: string, fileName: string) {
  if (typeof window === 'undefined') return
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Raw recovery archives deliberately preserve missing references; they are not restore-ready backups. */
export function exportRecoveryData(data: unknown) {
  triggerDownload(JSON.stringify({ exportType: 'RECOVERY_ARCHIVE', data }, null, 2), `gtar-recovery-${Date.now()}.json`)
}
