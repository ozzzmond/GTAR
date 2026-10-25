/**
 * #228 (owner decision 2026-10-25): GTAR ships no sample songs. The former first-run samples were
 * commercial songs, so their charts are no longer in the app. A new device starts with an empty
 * library and shows a short welcome chart (original text, never saved) until the user adds songs.
 *
 * Devices that still hold the old samples: only fingerprints are kept here, enough to recognise a
 * sample the user never changed. Those are removed from the device (and so from the cloud), and
 * per-record sync never uploads them.
 */
import type { ActiveSongState, WebSetlist } from '../types/gtar'

/** Kept for existing imports: no songs and no setlists ship with the app. */
export const DEFAULT_SETLIST: ActiveSongState[] = []
export const DEFAULT_SAMPLE_SETLISTS: WebSetlist[] = []

/** Shown when the library is empty. Not part of the library; never saved or synced. */
export const EMPTY_LIBRARY_SONG: ActiveSongState = {
  id: 'gtar-empty-library-welcome',
  title: 'Welcome to GTAR',
  artist: '',
  key: 'G',
  capo: 'No Capo',
  bpm: '',
  format: 'CHORD_PRO',
  transposeOffset: 0,
  rawContent: `{title: Welcome to GTAR}
{key: G}

{comment: Get started}
[G]Your songbook is [C]empty for now.
[G]Add a song with [D]New song, or import a chart.
[Em]Sign in to bring your [C]library from the [D]cloud.`,
}

const norm = (text: unknown) => String(text ?? '').replace(/\r\n?/g, '\n').trim()
/** FNV-1a over title, artist and chart; enough to recognise an unchanged legacy sample. */
export function sampleSongFingerprint(song: { title?: unknown; artist?: unknown; rawContent?: unknown }): string {
  const text = [norm(song.title), norm(song.artist), norm(song.rawContent)].join('\u0000')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0 }
  return hash.toString(16).padStart(8, '0')
}

/** Former samples (ids d1080001-… / d1080002-…): song id → fingerprint; setlist id → name and song ids. */
export const LEGACY_SAMPLE_SONGS = new Map<string, string>([
  ['d1080001-0001-4000-8000-000000000001', 'c49b14d3'],
  ['d1080001-0001-4000-8000-000000000002', '291db863'],
  ['d1080001-0001-4000-8000-000000000003', 'e72ae650'],
  ['d1080001-0001-4000-8000-000000000004', '984d5a67'],
])
export const LEGACY_SAMPLE_SETLISTS = new Map<string, { name: string; songs: string[] }>([
  ['d1080002-0001-4000-8000-000000000001', { name: 'Acoustic Gig Set', songs: [...LEGACY_SAMPLE_SONGS.keys()] }],
])

function isUnchangedSampleSong(value: { id?: unknown; title?: unknown; artist?: unknown; rawContent?: unknown }): boolean {
  const fingerprint = LEGACY_SAMPLE_SONGS.get(String(value.id))
  return !!fingerprint && sampleSongFingerprint(value) === fingerprint
}
function isUnchangedSampleSetlist(value: { id?: unknown; name?: unknown; songs?: unknown }): boolean {
  const sample = LEGACY_SAMPLE_SETLISTS.get(String(value.id))
  const songs = Array.isArray(value.songs) ? value.songs as Array<{ id?: unknown }> : null
  return !!sample && !!songs && norm(value.name) === sample.name &&
    songs.length === sample.songs.length && songs.every((ref, i) => String(ref?.id) === sample.songs[i])
}

/**
 * #227: a former sample the user has not changed. Per-record sync never uploads these.
 * Compared on what makes it the user's own (chart, title, artist; setlist name and songs).
 */
export function isPristineSampleRecord(kind: string, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const value = data as { isDeleted?: unknown }
  if (value.isDeleted) return false
  if (kind === 'song') return isUnchangedSampleSong(data as object)
  if (kind === 'setlist') return isUnchangedSampleSetlist(data as object)
  return false
}

/**
 * #240: setlist ids this device has synced through per-record sync (its saved state, key
 * `gtar_records_sync_v1`, written by recordsSync.ts). Read directly to avoid an import cycle.
 */
export function cloudSyncedSetlistIds(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): Set<string> {
  const ids = new Set<string>()
  try {
    const state = JSON.parse(storage?.getItem('gtar_records_sync_v1') ?? 'null') as { known?: Record<string, unknown> } | null
    for (const key of Object.keys(state?.known ?? {})) if (key.startsWith('setlist:')) ids.add(key.slice('setlist:'.length))
  } catch { /* no saved state: nothing synced */ }
  return ids
}

/**
 * #228: removes former samples the user never changed. An unchanged sample setlist goes; an unchanged
 * sample song goes unless a setlist that stays still lists it. Edited samples are the user's and stay.
 * #240: a sample setlist that is already in the cloud stays (the cloud copy may be newer than this
 * device's), and so do the songs it lists; the user can delete it. Same object when nothing is removed.
 */
export function removeUnchangedSamples<L extends { songs: ActiveSongState[]; setlists: WebSetlist[] }>(library: L,
  syncedSetlistIds: Set<string> = new Set()): L {
  const setlists = library.setlists.filter(list => !isUnchangedSampleSetlist(list) || syncedSetlistIds.has(String(list.id)))
  const referenced = new Set(setlists.flatMap(list => (list.songs || []).map(ref => String(ref?.id))))
  const songs = library.songs.filter(song => !isUnchangedSampleSong(song) || referenced.has(String(song.id)))
  if (songs.length === library.songs.length && setlists.length === library.setlists.length) return library
  return { ...library, songs, setlists }
}
