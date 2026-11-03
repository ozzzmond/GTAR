import { normalizeTags } from './songTags'
import { canonicalCatalogLineage } from './catalogSetlistLineage'
import type { ActiveSongState } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'
import { normalizeCloudThemeSettings } from './backupSettings'

export interface CloudSongbookRecord {
  userId?: string
  version: number
  checksum: string
  updatedAt: string
  data: SyncLibrary
}

/**
 * Deterministic checksum of a canonical songbook library.
 * Orders songs and setlists deterministically and digests canonical properties.
 * Optional tagColors travel in the payload; keep legacy checksum semantics so older readers can ignore them.
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

function songTags(song: ActiveSongState): string[] {
  return normalizeTags(song.tags).map(tag => tag.toLowerCase()).sort()
}


export const SONGBOOK_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024
/** Share of the limit from which the Backup & Restore dialog warns. */
export const SONGBOOK_UPLOAD_WARN_RATIO = 0.75

export type SongbookHeadroomLevel = 'ok' | 'warning' | 'over'
export interface SongbookHeadroom { bytes: number; limitBytes: number; ratio: number; level: SongbookHeadroomLevel }

/** Exact request body for a songbook upload; used for both the request and its size estimate. */
export function songbookUploadBody(action: 'upload' | 'resolve', data: SyncLibrary, clientChecksum: string,
  expectedVersion: number, expectedChecksum: string | null): string {
  return JSON.stringify({ action, data, clientChecksum, expectedVersion, expectedChecksum })
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
