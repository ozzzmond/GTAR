/**
 * Shared Catalog Personal Import Service (DEV.2 Phase 3)
 * Safely converts an authoritative Shared Catalog song into an independent personal Songbook clone.
 *
 * Guarantees:
 * - Generates a fresh, independent local song UUID.
 * - Retains full content, key, chords, and metadata cleanly.
 * - Tracks source catalog identity additively via `sharedSourceSongId` and `sharedSourceRevision`.
 * - Drops server publisher ownership and editor identity from personal song representation.
 * - Does not perform remote writes or alter the shared catalog song.
 * - Integrates cleanly with personal Songbook storage and cloud sync.
 */

import type { ActiveSongState, SongFormat } from '../types/gtar'
import type { SharedCatalogSongItem } from '../types/sharedCatalog'
import { generateUUID } from './uuid'
import { canonicalSongKey } from './musicalKey'
import { detectSongKey } from './songParser'
import { normalizeBackupSong } from './jsonBackup'

export interface ImportSharedSongOptions {
  /** Optional custom local title override; defaults to shared song title */
  titleOverride?: string
}

/**
 * Transforms a shared catalog song record into an independent personal ActiveSongState entity.
 */
export function cloneSharedCatalogSongToPersonal(
  sharedSong: SharedCatalogSongItem,
  options: ImportSharedSongOptions = {}
): ActiveSongState {
  if (!sharedSong || !sharedSong.title || !sharedSong.raw_content) {
    throw new Error('Invalid shared catalog song data for personal library import')
  }

  // 1. Generate independent local UUID
  const localId = generateUUID()

  // 2. Resolve canonical musical key
  const resolvedKey = canonicalSongKey(
    sharedSong.key || sharedSong.original_key || detectSongKey(sharedSong.raw_content)
  )

  // 3. Resolve format
  const format: SongFormat =
    sharedSong.format === 'CHORD_PRO' || sharedSong.format === 'TWO_LINE' || sharedSong.format === 'PLAIN'
      ? (sharedSong.format as SongFormat)
      : 'CHORD_PRO'

  // 4. Construct clone
  const now = Date.now()
  const candidate: Partial<ActiveSongState> = {
    id: localId,
    title: (options.titleOverride || sharedSong.title).trim(),
    artist: (sharedSong.artist || '').trim(),
    key: resolvedKey,
    originalKey: sharedSong.original_key ? canonicalSongKey(sharedSong.original_key) : undefined,
    capo: (sharedSong.capo || '').trim(),
    bpm: (sharedSong.bpm || '120').trim(),
    time: sharedSong.time_signature ? sharedSong.time_signature.trim() : undefined,
    year: sharedSong.year ? sharedSong.year.trim() : undefined,
    rawContent: sharedSong.raw_content.replace(/\r\n/g, '\n'),
    format,
    transposeOffset: 0,
    isFavorite: false,
    isDeleted: false,
    createdAt: now,
    lastOpenedAt: now,
    // Additive non-destructive lineage tracking
    sharedSourceSongId: sharedSong.id,
    sharedSourceRevision: sharedSong.current_revision,
    ...(sharedSong.publisher_user_id ? { sharedSourcePublisherId: sharedSong.publisher_user_id } : {}),
    ...((sharedSong.publisher_display_name || sharedSong.publisher_name) ? { sharedSourcePublisherName: (sharedSong.publisher_display_name || sharedSong.publisher_name)! } : {}),
  }

  return normalizeBackupSong(candidate)
}
