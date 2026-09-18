import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { resolveSetlistSong } from './setlistSongs'

export const STAGE_SESSION_KEY = 'gtar_stage_session_v1'

export interface StageSessionData {
  isActive: boolean
  queueMode: 'library' | 'setlist'
  activeSongIndex?: number
  songId?: string | number
  songTitle?: string
  activeSetlistId?: string | number | null
  activeSetlistSongIndex?: number
  timestamp?: number
}

export interface ValidatedStageSession {
  isValid: boolean
  view: 'stage' | 'songbook'
  queueMode: 'library' | 'setlist'
  activeSongIndex: number
  activeSetlistId: string | number | null
  activeSetlistSongIndex: number
  resolvedSong: ActiveSongState | null
  reason?: string
}

function getStorage(customStorage?: Storage | null): Storage | null {
  if (customStorage !== undefined) return customStorage
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

export function saveStageSession(data: StageSessionData, customStorage?: Storage | null): void {
  const storage = getStorage(customStorage)
  if (!storage) return
  try {
    storage.setItem(
      STAGE_SESSION_KEY,
      JSON.stringify({
        ...data,
        timestamp: data.timestamp ?? Date.now(),
      })
    )
  } catch (_) {
    // Quota or access error - ignore gracefully
  }
}

export function clearStageSession(customStorage?: Storage | null): void {
  const storage = getStorage(customStorage)
  if (!storage) return
  try {
    storage.removeItem(STAGE_SESSION_KEY)
  } catch (_) {}
}

export function readStageSession(customStorage?: Storage | null): StageSessionData | null {
  const storage = getStorage(customStorage)
  if (!storage) return null
  try {
    const raw = storage.getItem(STAGE_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as StageSessionData
  } catch {
    return null
  }
}

export function validateAndResolveStageSession(
  session: StageSessionData | null,
  songs: ActiveSongState[],
  setlists: WebSetlist[]
): ValidatedStageSession {
  const fallback: ValidatedStageSession = {
    isValid: false,
    view: 'songbook',
    queueMode: 'library',
    activeSongIndex: 0,
    activeSetlistId: null,
    activeSetlistSongIndex: 0,
    resolvedSong: null,
  }

  if (!session || !session.isActive) {
    return { ...fallback, reason: 'NO_ACTIVE_SESSION' }
  }

  if (!Array.isArray(songs) || songs.length === 0) {
    return { ...fallback, reason: 'EMPTY_LIBRARY' }
  }

  if (session.queueMode === 'setlist') {
    if (session.activeSetlistId === null || session.activeSetlistId === undefined) {
      return { ...fallback, reason: 'MISSING_SETLIST_ID' }
    }

    const setlist = setlists.find((sl) => String(sl.id) === String(session.activeSetlistId))
    if (!setlist) {
      return { ...fallback, reason: 'SETLIST_NOT_FOUND' }
    }

    if (!Array.isArray(setlist.songs) || setlist.songs.length === 0) {
      return { ...fallback, reason: 'SETLIST_EMPTY' }
    }

    let targetIndex = session.activeSetlistSongIndex ?? 0
    let targetSongRef = setlist.songs[targetIndex]

    // If out of bounds or identity mismatch, try resolving by songId or title
    if (
      !targetSongRef ||
      (session.songId !== undefined && String(targetSongRef.id) !== String(session.songId))
    ) {
      const foundIdx = setlist.songs.findIndex(
        (ref) =>
          (session.songId !== undefined && String(ref.id) === String(session.songId)) ||
          (session.songTitle &&
            ref.title.trim().toLowerCase() === session.songTitle.trim().toLowerCase())
      )
      if (foundIdx !== -1) {
        targetIndex = foundIdx
        targetSongRef = setlist.songs[targetIndex]
      }
    }

    if (!targetSongRef) {
      return { ...fallback, reason: 'SETLIST_SONG_NOT_FOUND' }
    }

    // Validate required references: song must resolve in active songs library
    const resolved = resolveSetlistSong(targetSongRef, songs)
    if (!resolved || resolved.isDeleted) {
      return { ...fallback, reason: 'SETLIST_SONG_UNRESOLVED' }
    }

    return {
      isValid: true,
      view: 'stage',
      queueMode: 'setlist',
      activeSongIndex: 0,
      activeSetlistId: setlist.id,
      activeSetlistSongIndex: targetIndex,
      resolvedSong: resolved,
    }
  }

  // LIBRARY queueMode
  let targetIndex = session.activeSongIndex ?? 0
  let targetSong = songs[targetIndex]

  // If index out of bounds or songId doesn't match, attempt lookup by songId or title
  if (
    !targetSong ||
    (session.songId !== undefined && String(targetSong.id) !== String(session.songId))
  ) {
    const foundIdx = songs.findIndex(
      (s) =>
        (session.songId !== undefined && String(s.id) === String(session.songId)) ||
        (session.songTitle &&
          s.title.trim().toLowerCase() === session.songTitle.trim().toLowerCase())
    )
    if (foundIdx !== -1) {
      targetIndex = foundIdx
      targetSong = songs[targetIndex]
    }
  }

  if (!targetSong || targetSong.isDeleted) {
    return { ...fallback, reason: 'LIBRARY_SONG_NOT_FOUND' }
  }

  return {
    isValid: true,
    view: 'stage',
    queueMode: 'library',
    activeSongIndex: targetIndex,
    activeSetlistId: null,
    activeSetlistSongIndex: 0,
    resolvedSong: targetSong,
  }
}
