import { normalizeTags } from './songTags'
import { canonicalCatalogLineage } from './catalogSetlistLineage'
import type { ActiveSongState } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'
import { normalizeCloudThemeSettings, validThemeModeAssignments, validateBackupSettingsV2, validateCloudThemeSettings, type BackupSettingsV2 } from './backupSettings'
import { stableStringify } from './contentHash'

export type CloudBackupData = SyncLibrary & { settingsSchemaVersion?: number; settings?: BackupSettingsV2; checksumScheme?: string }

export interface CloudSongbookRecord {
  userId?: string
  version: number
  checksum: string
  updatedAt: string
  data: CloudBackupData
}

export const SONGBOOK_CHECKSUM_SCHEME = 'gtar-normalized-tags-v1'
export const SETTINGS_CHECKSUM_SCHEME = 'gtar-backup-settings-v2'
export const SMART_SETTINGS_CHECKSUM_SCHEME = 'gtar-backup-settings-v3'

/** Old checksum meanings stay unchanged. Settings require the versioned, fully covered envelope. */
export function validateCloudBackupSettings(data: CloudBackupData): string[] {
  const smart = data.checksumScheme === SMART_SETTINGS_CHECKSUM_SCHEME
  const versioned = data.settings !== undefined || data.settingsSchemaVersion !== undefined || data.checksumScheme === SETTINGS_CHECKSUM_SCHEME || smart
  if (!versioned) return []
  const errors = validateBackupSettingsV2(data.settings)
  const appearance = data.settings?.appearance
  const hasAppearance = appearance !== null && typeof appearance === 'object'
  if (data.settingsSchemaVersion !== (smart ? 3 : 2)) errors.push('Unsupported cloud settings schema version')
  if (!smart && data.checksumScheme !== SETTINGS_CHECKSUM_SCHEME) errors.push('Cloud settings require the settings checksum scheme')
  if (smart) {
    if (!validThemeModeAssignments(data.settings?.appearance?.themeModeAssignments)) errors.push('Cloud settings require distinct valid Light/Dark assignments')
    if (hasAppearance && 'themeMode' in appearance) errors.push('Active themeMode is not a saved v3 setting')
  } else if (hasAppearance && 'themeModeAssignments' in appearance) errors.push('Theme assignments require settings-v3')
  if (data.themeSettings !== undefined) errors.push('Cloud backup cannot contain both settings formats')
  return errors
}

/** No migration or mutation: check the original payload using only documented algorithms. */
export function verifySongbookChecksum(record: CloudSongbookRecord): boolean {
  const scheme = record.data.checksumScheme
  if (scheme !== undefined && scheme !== SONGBOOK_CHECKSUM_SCHEME && scheme !== SETTINGS_CHECKSUM_SCHEME && scheme !== SMART_SETTINGS_CHECKSUM_SCHEME) return false
  if (validateCloudBackupSettings(record.data).length) return false
  if (record.data.themeSettings !== undefined && validateCloudThemeSettings(record.data.themeSettings).length) return false
  if (computeSongbookChecksum(record.data) === record.checksum) return true
  return scheme === undefined && checksumWithTags(record.data, true) === record.checksum
}

/**
 * Deterministic checksum of a canonical songbook library.
 * Orders songs and setlists deterministically and digests canonical properties.
 * Optional tagColors travel in the payload; keep legacy checksum semantics so older readers can ignore them.
 * Preserves exact legacy checksum semantics when themeSettings is absent.
 */
export function computeSongbookChecksum(library: CloudBackupData): string {
  // New envelope: all saved fields are covered; active themeMode is forbidden by validation.
  // Domain separation prevents a v2 digest from being relabelled as v3.
  if (library.checksumScheme === SMART_SETTINGS_CHECKSUM_SCHEME) {
    return digest(stableStringify({ checksumScheme: library.checksumScheme, songs: library.songs, setlists: library.setlists,
      folders: library.folders, tagColors: library.tagColors, settingsSchemaVersion: library.settingsSchemaVersion, settings: library.settings }))
  }
  if (library.settings !== undefined || library.checksumScheme === SETTINGS_CHECKSUM_SCHEME) {
    return digest(stableStringify({ songs: library.songs, setlists: library.setlists, folders: library.folders,
      tagColors: library.tagColors, settingsSchemaVersion: library.settingsSchemaVersion, settings: library.settings }))
  }
  return checksumWithTags(library, false)
}

// 4fe95049326468a7e275417e1f62cff4ef807708 (before 56cbae2): strings kept
// verbatim, arrays copied and sorted. All other canonical fields are unchanged.
// Retain historical localeCompare ordering; do not guess the writer's locale.
function checksumWithTags(library: SyncLibrary, legacyTags: boolean): string {
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
      tags: legacyTags ? (Array.isArray(s.tags) ? [...s.tags].sort() : (s.tags || '')) : songTags(s),
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
  return digest(canonicalString)
}

function digest(canonicalString: string): string {
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

function songTags(song: ActiveSongState): string[] {
  return normalizeTags(song.tags).map(tag => tag.toLowerCase()).sort()
}


export const SONGBOOK_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024
/** Share of the limit from which the Backup & Restore dialog warns. */
export const SONGBOOK_UPLOAD_WARN_RATIO = 0.75

export type SongbookHeadroomLevel = 'ok' | 'warning' | 'over'
export interface SongbookHeadroom { bytes: number; limitBytes: number; ratio: number; level: SongbookHeadroomLevel }

/** Exact request body for a songbook upload; used for both the request and its size estimate. */
export function songbookUploadBody(action: 'upload' | 'resolve', data: CloudBackupData, clientChecksum: string,
  expectedVersion: number, expectedChecksum: string | null): string {
  return JSON.stringify({ action, data: { ...data, checksumScheme: data.checksumScheme ?? (data.settings !== undefined ? SETTINGS_CHECKSUM_SCHEME : SONGBOOK_CHECKSUM_SCHEME) }, clientChecksum, expectedVersion, expectedChecksum })
}
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength

/**
 * Upper-bound size of uploading `library`, as the server counts it (UTF-8 bytes of the request
 * body). Uses the longest possible revision fields, so the real upload is never larger.
 */
export function estimateSongbookUploadBytes(library: SyncLibrary): number {
  return utf8Bytes(songbookUploadBody('resolve', library, `ck_${'0'.repeat(16)}`, Number.MAX_SAFE_INTEGER, `ck_${'0'.repeat(16)}`))
}

export function songbookUploadHeadroom(bytes: number): SongbookHeadroom {
  const ratio = bytes / SONGBOOK_UPLOAD_LIMIT_BYTES
  return { bytes, limitBytes: SONGBOOK_UPLOAD_LIMIT_BYTES, ratio,
    level: bytes > SONGBOOK_UPLOAD_LIMIT_BYTES ? 'over' : ratio >= SONGBOOK_UPLOAD_WARN_RATIO ? 'warning' : 'ok' }
}
