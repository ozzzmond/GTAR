import { bindLegacySetlists, ensureSongIds, resolveSetlistSong } from './setlistSongs'
import type { ActiveSongState, WebSetlist } from '../types/gtar'

export interface SyncLibrary {
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  allowedUsers?: string[]
}

// Stable IDs are authoritative. Legacy names resolve only references without IDs;
// they never merge two independently identified records.
function aliases<T extends { id?: string | number }>(groups: T[][]) {
  return new Map(groups.flat().map(item => [String(item.id), item.id!]))
}

function unionRefs(a: WebSetlist['songs'], b: WebSetlist['songs']) {
  const seen = new Set<string>()
  return [...a, ...b].filter(ref => {
    const key = ref.id === undefined ? JSON.stringify([ref.title, ref.artist]) : String(ref.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function align(libraries: SyncLibrary[]): SyncLibrary[] {
  const prepared = libraries.map(library => ({ songs: ensureSongIds(library.songs), setlists: library.setlists }))
  const songIds = aliases(prepared.map(library => library.songs))
  const setlistIds = aliases(prepared.map(library => library.setlists))
  return prepared.map(library => {
    const songs = new Map<string, ActiveSongState>()
    for (const song of library.songs) {
      const id = songIds.get(String(song.id))!
      if (!songs.has(String(id))) songs.set(String(id), { ...song, id })
    }
    const setlists = new Map<string, WebSetlist>()
    for (const setlist of bindLegacySetlists(library.setlists, library.songs)) {
      const id = setlistIds.get(String(setlist.id))!
      const refs = setlist.songs.map(ref => ({
        ...ref,
        id: songIds.get(String(ref.id)) ?? ref.id ?? resolveSetlistSong(ref, [...songs.values()])?.id
      }))
      const previous = setlists.get(String(id))
      setlists.set(String(id), { ...(previous ?? setlist), id, songs: unionRefs(previous?.songs ?? [], refs) })
    }
    return { songs: [...songs.values()], setlists: bindLegacySetlists([...setlists.values()], [...songs.values()]) }
  })
}

/** Normalize references without collapsing distinct stable IDs within a library. */
export function deduplicateLibrary(library: SyncLibrary): SyncLibrary {
  return align([library])[0]
}
