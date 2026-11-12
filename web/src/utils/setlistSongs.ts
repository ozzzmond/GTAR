import { assertSongLifecycle } from './importIdentity'
import { generateUUID } from './uuid'
import type { ActiveSongState, WebSetlist, LegacySetlistSongRef } from '../types/gtar'

export type SongReference = WebSetlist['songs'][number]
export const songIdentity = (song: { title: string; artist?: string }) =>
  JSON.stringify([song.title.trim().toLowerCase(), (song.artist ?? '').trim().toLowerCase()])

export function resolveSetlistSong(ref: LegacySetlistSongRef, songs: ActiveSongState[]): ActiveSongState | undefined {
  if (ref.id !== undefined) return songs.find(song => song.id !== undefined && String(song.id) === String(ref.id))
  const matches = songs.filter(song => song.title.trim().toLowerCase() === ref.title.trim().toLowerCase() &&
    (!ref.artist?.trim() || song.artist.trim().toLowerCase() === ref.artist.trim().toLowerCase()))
  return matches.length === 1 ? matches[0] : undefined
}

/** First song per String(id), matching resolveSetlistSong's `find` order for ID references. */
export function songIdIndex(songs: ActiveSongState[]): Map<string, ActiveSongState> {
  const index = new Map<string, ActiveSongState>()
  for (const song of songs) if (song.id !== undefined && !index.has(String(song.id))) index.set(String(song.id), song)
  return index
}

/** Same result as resolveSetlistSong, with O(1) ID lookups; legacy title refs fall back to the scan. */
export function resolveSetlistSongIndexed(ref: LegacySetlistSongRef, songs: ActiveSongState[], index: Map<string, ActiveSongState>): ActiveSongState | undefined {
  return ref.id !== undefined ? index.get(String(ref.id)) : resolveSetlistSong(ref, songs)
}

/** Run at library load/import; saved IDs remain authoritative after edits. */
export function bindLegacySetlists(setlists: Array<Omit<WebSetlist, 'songs'> & { songs: LegacySetlistSongRef[] }>, songs: ActiveSongState[]): WebSetlist[] {
  const byId = songIdIndex(songs)
  const byTitle = new Map<string, ActiveSongState | null>(), byTitleArtist = new Map<string, ActiveSongState | null>()
  for (const song of songs) {
    const title = song.title.trim().toLowerCase()
    byTitle.set(title, byTitle.has(title) ? null : song)
    const identity = songIdentity(song)
    byTitleArtist.set(identity, byTitleArtist.has(identity) ? null : song)
  }
  return setlists.map(setlist => {
    const used = new Set<string>()
    return { ...setlist, songs: setlist.songs.map((ref, position) => {
      // Stable deterministic IDs also make legacy backup fingerprints repeatable.
      let entryId = ref.entryId || `entry:${setlist.id}:${position}`
      while (used.has(entryId)) entryId += ':duplicate'
      used.add(entryId)
      // A named artist must match (same rule as resolveSetlistSong); a miss stays a broken shortcut, never a title guess.
      const song = ref.id !== undefined ? byId.get(String(ref.id)) :
        ref.artist?.trim() ? byTitleArtist.get(songIdentity(ref)) : byTitle.get(ref.title.trim().toLowerCase())
      return { ...ref, id: song?.id ?? ref.id ?? `missing:${entryId}`, entryId, position }
    }) }
  })
}

export function validateSetlistReferences(setlists: WebSetlist[], songs: ActiveSongState[]): string[] {
  const errors: string[] = []
  setlists.forEach((setlist, i) => setlist.songs.forEach((ref, j) => {
    if (!resolveSetlistSong(ref, songs)) errors.push(`setlists[${i}].songs[${j}]: song ${ref.id ?? ref.title} is missing or ambiguous`)
  }))
  return errors
}

export function ensureSongIds(songs: ActiveSongState[]): ActiveSongState[] {
  return songs.map(song => song.id === undefined ? { ...song, id: generateUUID() } : song)
}

export function partitionSongs(songs: ActiveSongState[]) {
  return { active: songs.filter(song => !song.isDeleted), deleted: songs.filter(song => song.isDeleted) }
}

/** Stable IDs alone select merge targets; lifecycle disagreements abort. */
export function mergeBackupLibrary(existing: ActiveSongState[], incoming: ActiveSongState[], setlists: WebSetlist[]) {
  assertSongLifecycle(existing, incoming)
  const original = ensureSongIds(existing)
  const imported = ensureSongIds(incoming)
  const existingById = new Map<string, number>()
  original.forEach((song, index) => {
    const id = String(song.id)
    if (existingById.has(id)) throw new Error(`Existing library contains duplicate song ID: ${id}`)
    existingById.set(id, index)
  })
  const incomingIds = new Set<string>()
  for (const song of imported) {
    const id = String(song.id)
    if (incomingIds.has(id)) throw new Error(`Backup contains duplicate song ID: ${id}`)
    incomingIds.add(id)
  }

  // Phase 1: reserve every exact-ID target before looking at titles or artists.
  const targets = new Map<number, number>()
  imported.forEach((song, index) => {
    const target = existingById.get(String(song.id))
    if (target !== undefined) {
      targets.set(index, target)
    }
  })

  let nextSlot = original.length
  imported.forEach((_, index) => {
    if (!targets.has(index)) targets.set(index, nextSlot++)
  })

  // The complete one-to-one mapping is fixed before any updates or ref rewrites.
  const songs = [...original]
  const remapped = new Map<string, string | number>()
  imported.forEach((song, index) => {
    const target = targets.get(index)!
    const id = original[target]?.id ?? song.id!
    remapped.set(String(song.id), id)
    songs[target] = { ...original[target], ...song, id }
  })
  const rebound = setlists.map(setlist => ({ ...setlist, songs: setlist.songs.map(ref =>
    ref.id !== undefined && remapped.has(String(ref.id)) ? { ...ref, id: remapped.get(String(ref.id)) } : ref) }))
  return { songs, setlists: bindLegacySetlists(rebound, songs) }
}

/** Membership is ID-based; display names never identify a song. */
export function isSongInSetlist(setlist: WebSetlist, songId: string | number): boolean {
  return setlist.songs.some(ref => ref.id !== undefined && String(ref.id) === String(songId))
}

export function setSongMembership(setlist: WebSetlist, song: ActiveSongState, included: boolean): WebSetlist {
  if (song.id === undefined) throw new Error('Setlist membership requires a stable song ID.')
  const matches = (ref: LegacySetlistSongRef) => ref.id !== undefined && String(ref.id) === String(song.id)
  if (!included) return { ...setlist, songs: setlist.songs.filter(ref => !matches(ref)).map((ref, position) => ({ ...ref, position })) }
  if (isSongInSetlist(setlist, song.id)) return setlist
  return { ...setlist, songs: [...setlist.songs, { id: song.id, entryId: generateUUID(), position: setlist.songs.length, title: song.title, artist: song.artist }] }
}

export interface SongLifecycleState {
  active: ActiveSongState[]
  deleted: ActiveSongState[]
  setlists: WebSetlist[]
}
export type SongLifecycleOperation =
  /** `repoint` (#149): setlist refs to a trashed id move to the kept song id first (deduplicated, order kept). */
  | { kind: 'trash'; ids: Array<string | number>; blank: ActiveSongState; repoint?: Record<string, string | number> }
  | { kind: 'restore' | 'permanent'; ids: Array<string | number> }
  | { kind: 'empty' }

/** Pure complete-state transition. Song removal retains broken shortcuts for context. */
export function transitionSongLibrary(state: SongLifecycleState, operation: SongLifecycleOperation): SongLifecycleState {
  const ids = new Set(operation.kind === 'empty' ? state.deleted.map(song => String(song.id)) : operation.ids.map(String))
  const selected = (song: ActiveSongState) => song.id !== undefined && ids.has(String(song.id))
  if (operation.kind === 'trash') {
    const moved = state.active.filter(selected)
    if (!moved.length) return state
    const remaining = state.active.filter(song => !selected(song))
    const setlists = operation.repoint ? repointSetlists(state.setlists, operation.repoint, remaining) : state.setlists
    return { ...state, setlists, active: remaining.length ? remaining : [operation.blank],
      deleted: [...moved.map(song => ({ ...song, isDeleted: true })), ...state.deleted] }
  }
  const moved = state.deleted.filter(selected)
  if (operation.kind === 'restore') return { ...state,
    active: [...moved.map(song => ({ ...song, isDeleted: false })), ...state.active],
    deleted: state.deleted.filter(song => !selected(song)) }
  return { ...state, deleted: state.deleted.filter(song => !selected(song)) }
}

/** #149: point setlist refs from `from` ids to kept songs. Refuses targets that are not active songs. */
export function repointSetlists(setlists: WebSetlist[], repoint: Record<string, string | number>, active: ActiveSongState[]): WebSetlist[] {
  const index = songIdIndex(active)
  const moves = new Map(Object.entries(repoint).map(([from, to]) => [from, String(to)]))
  for (const [from, to] of moves) {
    if (!index.has(to) || to === from) throw new Error(`Cannot re-point setlists from ${from} to ${to}: target is not an active song.`)
  }
  return setlists.map(list => {
    if (!list.songs.some(ref => ref.id !== undefined && moves.has(String(ref.id)))) return list
    // A re-pointed ref is dropped when the kept song is already in this setlist; other refs stay as they are.
    const present = new Set(list.songs.filter(ref => ref.id !== undefined && !moves.has(String(ref.id))).map(ref => String(ref.id)))
    const songs: SongReference[] = []
    for (const ref of list.songs) {
      if (ref.id === undefined || !moves.has(String(ref.id))) { songs.push(ref); continue }
      const target = index.get(moves.get(String(ref.id))!)!
      if (present.has(String(target.id))) continue
      present.add(String(target.id))
      songs.push({ ...ref, id: target.id!, title: target.title, artist: target.artist })
    }
    return { ...list, songs }
  })
}
