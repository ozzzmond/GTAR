/**
 * Shared Setlist Data Contract and Serialization Utilities
 * DEV.5b: Safe, privacy-conscious QR setlist sharing.
 * Excludes all private metadata, tokens, accounts, and internal database IDs.
 */

import type { WebSetlist, ActiveSongState } from '../types/gtar'
import { resolveSetlistSong } from './setlistSongs'

export interface SharedSetlistSong {
  title: string
  artist?: string
  key?: string
  capo?: string
  bpm?: string
  time?: string
  rawContent: string
}

export interface SharedSetlistPayload {
  version: 1
  type: 'GTAR_SHARED_SETLIST'
  name: string
  createdAt: string
  songs: SharedSetlistSong[]
}

export const MAX_SHARE_NAME_LENGTH = 100
export const MAX_SHARE_SONGS_COUNT = 100
export const MAX_SHARE_SONG_TITLE_LENGTH = 150
export const MAX_SHARE_RAW_CONTENT_LENGTH = 50000

/**
 * Strips all internal identifiers, account data, and sync metadata,
 * producing an isolated, immutable setlist snapshot.
 */
export function sanitizeSetlistForShare(
  setlist: WebSetlist | { name: string; songs: Array<Partial<SharedSetlistSong>> },
  librarySongs: ActiveSongState[] = []
): SharedSetlistPayload {
  const sanitizedName = (setlist.name || 'Shared Setlist').trim().slice(0, MAX_SHARE_NAME_LENGTH)
  const resolvedSongs: SharedSetlistSong[] = []

  const rawSongs: Array<Record<string, unknown>> = Array.isArray((setlist as { songs?: unknown }).songs)
    ? ((setlist as { songs: Array<Record<string, unknown>> }).songs)
    : []
  for (const item of rawSongs) {
    let title: string
    let artist: string
    let key: string
    let capo: string
    let bpm: string
    let time: string
    let rawContent: string

    if ('rawContent' in item && typeof item.rawContent === 'string') {
      // Direct song object
      title = (typeof item.title === 'string' && item.title ? item.title : 'Untitled Song').trim()
      artist = (typeof item.artist === 'string' ? item.artist : '').trim()
      key = (typeof item.key === 'string' ? item.key : '').trim()
      capo = (typeof item.capo === 'string' ? item.capo : '').trim()
      bpm = (typeof item.bpm === 'string' ? item.bpm : '').trim()
      time = (typeof item.time === 'string' ? item.time : '').trim()
      rawContent = item.rawContent
    } else {
      // SetlistSongRef
      const ref = item as { title: string; artist?: string; id?: string | number }
      const resolved = resolveSetlistSong(ref, librarySongs)
      title = (resolved?.title || ref.title || 'Untitled Song').trim()
      artist = (resolved?.artist || ref.artist || '').trim()
      key = (resolved?.key || '').trim()
      capo = (resolved?.capo || '').trim()
      bpm = (resolved?.bpm || '').trim()
      time = (resolved?.time || '').trim()
      rawContent = resolved?.rawContent || `{title: ${title}}\n\n[Verse]\n`
    }

    const songEntry: SharedSetlistSong = {
      title,
      rawContent,
    }

    if (artist) songEntry.artist = artist.slice(0, 100)
    if (key) songEntry.key = key.slice(0, 10)
    if (capo) songEntry.capo = capo.slice(0, 30)
    if (bpm) songEntry.bpm = bpm.slice(0, 10)
    if (time) songEntry.time = time.slice(0, 10)

    resolvedSongs.push(songEntry)
    if (resolvedSongs.length >= MAX_SHARE_SONGS_COUNT) break
  }

  return {
    version: 1,
    type: 'GTAR_SHARED_SETLIST',
    name: sanitizedName || 'Shared Setlist',
    createdAt: new Date().toISOString(),
    songs: resolvedSongs,
  }
}

/**
 * Validates inbound shared setlist payload fail-closed.
 */
export function validateSharedSetlistPayload(
  data: unknown
): { isValid: true; setlist: SharedSetlistPayload } | { isValid: false; error: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { isValid: false, error: 'Malformed shared setlist data: expected object' }
  }

  const rec = data as Record<string, unknown>

  if (rec.type !== 'GTAR_SHARED_SETLIST') {
    return { isValid: false, error: 'Invalid share format type: expected GTAR_SHARED_SETLIST' }
  }

  if (typeof rec.name !== 'string' || !rec.name.trim()) {
    return { isValid: false, error: 'Missing or invalid setlist name' }
  }

  const name = rec.name.trim().slice(0, MAX_SHARE_NAME_LENGTH)

  if (!Array.isArray(rec.songs)) {
    return { isValid: false, error: 'Invalid songs format: expected an array' }
  }

  if (rec.songs.length === 0) {
    return { isValid: false, error: 'Shared setlist contains no songs' }
  }

  if (rec.songs.length > MAX_SHARE_SONGS_COUNT) {
    return { isValid: false, error: `Shared setlist exceeds maximum ${MAX_SHARE_SONGS_COUNT} songs limit` }
  }

  const validatedSongs: SharedSetlistSong[] = []

  for (let i = 0; i < rec.songs.length; i++) {
    const s = rec.songs[i]
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return { isValid: false, error: `Invalid song entry at index ${i}` }
    }

    const sRec = s as Record<string, unknown>
    if (typeof sRec.title !== 'string' || !sRec.title.trim()) {
      return { isValid: false, error: `Song at index ${i} missing title` }
    }

    if (typeof sRec.rawContent !== 'string') {
      return { isValid: false, error: `Song at index ${i} missing chord chart content` }
    }

    const title = sRec.title.trim().slice(0, MAX_SHARE_SONG_TITLE_LENGTH)
    const rawContent = sRec.rawContent.slice(0, MAX_SHARE_RAW_CONTENT_LENGTH)

    const validatedSong: SharedSetlistSong = {
      title,
      rawContent,
    }

    if (typeof sRec.artist === 'string' && sRec.artist.trim()) {
      validatedSong.artist = sRec.artist.trim().slice(0, 100)
    }
    if (typeof sRec.key === 'string' && sRec.key.trim()) {
      validatedSong.key = sRec.key.trim().slice(0, 10)
    }
    if (typeof sRec.capo === 'string' && sRec.capo.trim()) {
      validatedSong.capo = sRec.capo.trim().slice(0, 30)
    }
    if (typeof sRec.bpm === 'string' && sRec.bpm.trim()) {
      validatedSong.bpm = sRec.bpm.trim().slice(0, 10)
    }
    if (typeof sRec.time === 'string' && sRec.time.trim()) {
      validatedSong.time = sRec.time.trim().slice(0, 10)
    }

    validatedSongs.push(validatedSong)
  }

  return {
    isValid: true,
    setlist: {
      version: 1,
      type: 'GTAR_SHARED_SETLIST',
      name,
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
      songs: validatedSongs,
    },
  }
}

/**
 * Extracts and validates a 16-hex share token from a pasted GTAR share URL or plain token string.
 * Strictly checks that if a URL is provided, its origin matches current origin or relative path,
 * and extracts the `share` parameter. Never allows fetching arbitrary URLs.
 */
export function extractShareToken(input: string): { isValid: true; token: string } | { isValid: false; error: string } {
  const trimmed = input.trim()
  if (!trimmed) {
    return { isValid: false, error: 'Share link cannot be empty.' }
  }

  // If it's a raw 16-hex token:
  if (/^[a-f0-9]{16}$/i.test(trimmed)) {
    return { isValid: true, token: trimmed.toLowerCase() }
  }

  // If it's a URL or URL pathname:
  try {
    let url: URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      url = new URL(trimmed)
      if (typeof window !== 'undefined' && window.location) {
        // Enforce same-origin check for security
        if (url.origin !== window.location.origin) {
          return { isValid: false, error: 'Invalid link: only GTAR share links from this application origin are accepted.' }
        }
      }
    } else if (trimmed.startsWith('/') || trimmed.startsWith('?')) {
      const base = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost'
      url = new URL(trimmed, base)
    } else {
      return { isValid: false, error: 'Invalid share link format. Must be a GTAR share URL or 16-character token.' }
    }

    const token = url.searchParams.get('share')
    if (!token || !/^[a-f0-9]{16}$/i.test(token)) {
      return { isValid: false, error: 'The pasted URL does not contain a valid 16-character GTAR share token.' }
    }

    return { isValid: true, token: token.toLowerCase() }
  } catch {
    return { isValid: false, error: 'Malformed URL provided.' }
  }
}
