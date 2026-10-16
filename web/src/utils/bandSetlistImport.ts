import { assertSongLifecycle } from './importIdentity'
import type { ActiveSongState } from '../types/gtar'
import type { BandSyncPayload } from './bandSync'
import { parseBackupJson } from './jsonBackup'

/** Identity-less legacy transmissions cannot safely identify a receiver record. */
export function parseBandSetlist(payload: BandSyncPayload, existing: ActiveSongState[]) {
  const parsed = parseBackupJson(JSON.stringify({ exportType: 'SINGLE_SETLIST', setlist: {
    id: payload.setlistId, name: payload.setlistName || 'Band Setlist',
    isDeleted: payload.setlistDeleted ?? false, songs: payload.songs ?? [],
  } }))
  if (!parsed.isValid) throw new Error(parsed.error)
  if (parsed.setlists[0].isDeleted) throw new Error('Deleted setlist transmission requires explicit resolution.')
  assertSongLifecycle(existing, parsed.songs)
  for (const song of parsed.songs) {
    const previous = existing.find(item => String(item.id) === String(song.id))
    if (previous && (previous.rawContent !== song.rawContent || previous.title !== song.title || previous.artist !== song.artist)) {
      throw new Error(`Band Sync song revision conflict (${song.id}); original records retained.`)
    }
  }
  // Receiving a queue never replaces local chart metadata or performance state.
  parsed.songs = parsed.songs.map(song => existing.find(item => String(item.id) === String(song.id)) ?? song)
  return parsed
}
