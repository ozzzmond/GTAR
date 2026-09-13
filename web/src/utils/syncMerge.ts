import { bindLegacySetlists, ensureSongIds, resolveSetlistSong, validateSetlistReferences } from './setlistSongs'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
export interface SyncLibrary { songs: ActiveSongState[]; setlists: WebSetlist[]; allowedUsers?: string[] }
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
// Stable IDs are authoritative. Legacy names resolve only references without IDs;
// they never merge two independently identified records.
function aliases<T extends { id?: string | number }>(groups: T[][]) {
  return new Map(groups.flat().map(item => [String(item.id), item.id!]))
}
function unionRefs(a: WebSetlist['songs'], b: WebSetlist['songs']) {
  const seen = new Set<string>()
  return [...a, ...b].filter(ref => { const key = ref.id === undefined ? JSON.stringify([ref.title, ref.artist]) : String(ref.id); if (seen.has(key)) return false; seen.add(key); return true })
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
      const refs = setlist.songs.map(ref => ({ ...ref, id: songIds.get(String(ref.id)) ?? ref.id ?? resolveSetlistSong(ref, [...songs.values()])?.id }))
      const previous = setlists.get(String(id))
      setlists.set(String(id), { ...(previous ?? setlist), id, songs: unionRefs(previous?.songs ?? [], refs) })
    }
    return { songs: [...songs.values()], setlists: bindLegacySetlists([...setlists.values()], [...songs.values()]) }
  })
}
/** Normalize references without collapsing distinct stable IDs within a library. */
export function deduplicateLibrary(library: SyncLibrary): SyncLibrary { return align([library])[0] }

function reconcile<T extends { id?: string | number }>(local: T[], remote: T[], base: T[]) {
  const result: T[] = []
  const l = new Map(local.map(item => [String(item.id), item]))
  const r = new Map(remote.map(item => [String(item.id), item]))
  const b = new Map(base.map(item => [String(item.id), item]))
  for (const id of new Set([...l.keys(), ...r.keys(), ...b.keys()])) {
    const left = l.get(id), right = r.get(id), before = b.get(id)
    let chosen: T | undefined
    if (equal(left, right)) chosen = left
    else if (equal(left, before)) chosen = right
    else if (equal(right, before)) chosen = left
    else {
      // Webapp is Primary Copy / Source of Truth: local web state wins
      chosen = left ?? right
    }
    if (chosen) result.push(chosen)
  }
  return result
}
export function mergeSyncLibrary(local: SyncLibrary, remote: SyncLibrary | null, base: SyncLibrary | null): SyncLibrary {
  if (!remote) return deduplicateLibrary(local)
  const [l, r, b] = align([local, remote, base ?? { songs: [], setlists: [] }])
  const songs = reconcile(l.songs, r.songs, b.songs)
  const setlists = bindLegacySetlists(reconcile(l.setlists, r.setlists, b.setlists), songs)
  const errors = validateSetlistReferences(setlists, songs)
  if (errors.length) throw new Error(errors.join('\n'))
  return deduplicateLibrary({ songs, setlists })
}
export function initializeSyncLibrary(local: SyncLibrary, cloud: SyncLibrary): SyncLibrary {
  return mergeSyncLibrary(local, cloud, null)
}
