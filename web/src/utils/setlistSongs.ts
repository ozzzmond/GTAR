import { generateUUID } from './uuid'
import type { ActiveSongState, WebSetlist } from '../types/gtar'

export type SongReference = WebSetlist['songs'][number]
export const songIdentity = (song: { title: string; artist?: string }) =>
  JSON.stringify([song.title.trim().toLowerCase(), (song.artist ?? '').trim().toLowerCase()])

export function resolveSetlistSong(ref: SongReference, songs: ActiveSongState[]): ActiveSongState | undefined {
  if (ref.id !== undefined) return songs.find(song => song.id !== undefined && String(song.id) === String(ref.id))
  const matches = songs.filter(song => song.title.trim().toLowerCase() === ref.title.trim().toLowerCase() &&
    (!ref.artist?.trim() || song.artist.trim().toLowerCase() === ref.artist.trim().toLowerCase()))
  return matches.length === 1 ? matches[0] : undefined
}

/** Run at library load/import; saved IDs remain authoritative after edits. */
export function bindLegacySetlists(setlists: WebSetlist[], songs: ActiveSongState[]): WebSetlist[] {
  return setlists.map(setlist => ({ ...setlist, songs: setlist.songs.map(ref => {
    const song = resolveSetlistSong(ref, songs)
    return song ? { ...ref, id: song.id, title: song.title, artist: song.artist } : ref
  }) }))
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

/** Reserve exact IDs first; legacy identity matches may only use unclaimed slots. */
export function mergeBackupLibrary(existing: ActiveSongState[], incoming: ActiveSongState[], setlists: WebSetlist[]) {
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
  const reserved = new Set<number>()
  imported.forEach((song, index) => {
    const target = existingById.get(String(song.id))
    if (target !== undefined) {
      targets.set(index, target)
      reserved.add(target)
    }
  })

  // Phase 2: compare immutable snapshots. Only unique, unbound identities dedupe.
  const unboundByIdentity = new Map<string, number[]>()
  imported.forEach((song, index) => {
    if (targets.has(index)) return
    const key = songIdentity(song)
    unboundByIdentity.set(key, [...(unboundByIdentity.get(key) ?? []), index])
  })
  const availableByIdentity = new Map<string, number[]>()
  original.forEach((song, index) => {
    if (reserved.has(index)) return
    const key = songIdentity(song)
    availableByIdentity.set(key, [...(availableByIdentity.get(key) ?? []), index])
  })
  for (const [identity, indices] of unboundByIdentity) {
    const available = availableByIdentity.get(identity) ?? []
    if (indices.length === 1 && available.length === 1) {
      targets.set(indices[0], available[0])
      reserved.add(available[0])
    }
  }
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
  const errors = validateSetlistReferences(rebound, songs)
  if (errors.length) throw new Error(errors.join('\n'))
  return { songs, setlists: bindLegacySetlists(rebound, songs) }
}

/** Membership is ID-based; display names never identify a song. */
export function isSongInSetlist(setlist: WebSetlist, songId: string | number): boolean {
  return setlist.songs.some(ref => ref.id !== undefined && String(ref.id) === String(songId))
}

export function setSongMembership(setlist: WebSetlist, song: ActiveSongState, included: boolean): WebSetlist {
  if (song.id === undefined) throw new Error('Setlist membership requires a stable song ID.')
  const matches = (ref: SongReference) => ref.id !== undefined && String(ref.id) === String(song.id)
  if (!included) return { ...setlist, songs: setlist.songs.filter(ref => !matches(ref)) }
  if (isSongInSetlist(setlist, song.id)) return setlist
  return { ...setlist, songs: [...setlist.songs, { id: song.id, title: song.title, artist: song.artist }] }
}

export interface SongLifecycleState {
  active: ActiveSongState[]
  deleted: ActiveSongState[]
  setlists: WebSetlist[]
}
export type SongLifecycleOperation =
  | { kind: 'trash'; ids: Array<string | number>; blank: ActiveSongState }
  | { kind: 'restore' | 'permanent'; ids: Array<string | number> }
  | { kind: 'empty' }

/** Pure complete-state transition. Only physically removed tombstone IDs prune membership. */
export function transitionSongLibrary(state: SongLifecycleState, operation: SongLifecycleOperation): SongLifecycleState {
  const ids = new Set(operation.kind === 'empty' ? state.deleted.map(song => String(song.id)) : operation.ids.map(String))
  const selected = (song: ActiveSongState) => song.id !== undefined && ids.has(String(song.id))
  if (operation.kind === 'trash') {
    const moved = state.active.filter(selected)
    if (!moved.length) return state
    const remaining = state.active.filter(song => !selected(song))
    return { ...state, active: remaining.length ? remaining : [operation.blank],
      deleted: [...moved.map(song => ({ ...song, isDeleted: true })), ...state.deleted] }
  }
  const moved = state.deleted.filter(selected)
  if (operation.kind === 'restore') return { ...state,
    active: [...moved.map(song => ({ ...song, isDeleted: false })), ...state.active],
    deleted: state.deleted.filter(song => !selected(song)) }
  const removed = new Set(moved.map(song => String(song.id)))
  return { ...state, deleted: state.deleted.filter(song => !selected(song)),
    setlists: state.setlists.map(list => ({ ...list,
      songs: list.songs.filter(ref => ref.id === undefined || !removed.has(String(ref.id))) })) }
}
