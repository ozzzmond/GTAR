import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SharedSetlistPayload, SharedSetlistSong } from './sharedSetlist'
import { parseChordProDirectives, formatTempoLabel } from './chordProMetadata'
import { resolveSongKeys, transposeContext } from './songKeySemantics'
import { resolveSetlistSongIndexed, songIdIndex } from './setlistSongs'
import { detectSongKey } from './songParser'

/** Preserve snapshot arrangement state; absent metadata stays unknown. */
export function sharedSongToActiveSong(song: SharedSetlistSong): Omit<ActiveSongState, 'id'> {
  const { metadata } = parseChordProDirectives(song.rawContent)
  return {
    title: song.title, artist: song.artist || '', rawContent: song.rawContent,
    key: song.key || detectSongKey(song.rawContent),
    ...(song.originalKey ? { originalKey: song.originalKey } : {}),
    ...(song.confirmedChartKey ? { confirmedChartKey: song.confirmedChartKey } : {}),
    capo: song.capo || 'No Capo', bpm: song.bpm || String(metadata.tempo || ''),
    time: song.time || metadata.time, year: song.year || (metadata.year ? String(metadata.year) : undefined),
    format: song.format || 'CHORD_PRO', transposeOffset: song.transposeOffset ?? 0,
  }
}

export function sharedSongMetadata(song: SharedSetlistSong): string[] {
  const { metadata } = parseChordProDirectives(song.rawContent)
  const keys = transposeContext(song, song.transposeOffset ?? 0)
  const values: string[] = []
  if (keys.originalKey) values.push(`Orig Key: ${keys.originalKey}`)
  if (keys.chartKey && !keys.chartEstimated && !keys.chartConflict) {
    values.push(`Chart Key: ${keys.chartKey}`)
    if (keys.performanceKey !== keys.chartKey) values.push(`Current Key: ${keys.performanceKey}`)
  }
  const tempo = formatTempoLabel(song.bpm || metadata.tempo)
  if (tempo) values.push(tempo)
  if (song.time || metadata.time) values.push(`Time: ${song.time || metadata.time}`)
  if (song.year || metadata.year) values.push(`Year: ${song.year || metadata.year}`)
  return values
}

function arrangement(song: Partial<ActiveSongState> & { rawContent: string; title: string }): string | null {
  if (!song.rawContent.trim()) return null
  const keys = resolveSongKeys(song)
  if (keys.chartConflict || keys.originalConflict) return null
  const { metadata } = parseChordProDirectives(song.rawContent)
  const capo = (song.capo || '').trim().toLowerCase()
  return JSON.stringify([
    song.rawContent.replace(/\r\n/g, '\n'), song.title.trim(), (song.artist || '').trim(),
    keys.originalKey, keys.chartKey, (song.key || '').trim(), song.transposeOffset ?? 0, song.format || 'CHORD_PRO',
    ['', 'no capo', '0'].includes(capo) ? '' : capo,
    formatTempoLabel(song.bpm || metadata.tempo) || '', song.time || metadata.time || '',
    song.year || metadata.year || '',
  ])
}

/** No shared private IDs exist: require full ordered content/arrangement equality.
 * Unresolved/ambiguous legacy shortcuts, empty charts and tombstones cannot match.
 */
export function findSharedSetlistDuplicate(shared: SharedSetlistPayload, setlists: WebSetlist[], songs: ActiveSongState[]): WebSetlist | null {
  if (!shared.songs.length) return null
  const incoming = shared.songs.map(arrangement)
  if (incoming.some(value => value === null)) return null
  const index = songIdIndex(songs)
  return setlists.find(list => !list.isDeleted && list.songs.length === incoming.length &&
    list.songs.every((ref, position) => {
      const song = resolveSetlistSongIndexed(ref, songs, index)
      return song && !song.isDeleted && arrangement(song) === incoming[position]
    })) || null
}
