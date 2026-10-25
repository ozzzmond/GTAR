/**
 * RFC #188 S4/S5: per-record songbook sync, shared by the client and the Pages Function.
 *
 * A library is split into records: one per song, one per setlist and one for theme settings.
 * Each record is identified by `kind` + `id` and carries a checksum of its full data, so the
 * client and the server agree on "same content" without comparing fields one by one.
 * Pure module: no storage, no network, no DOM.
 */
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'
import type { CloudThemeSettings } from './backupSettings'

export type RecordKind = 'song' | 'setlist' | 'theme'
export const RECORD_KINDS: readonly RecordKind[] = ['song', 'setlist', 'theme']
export const THEME_RECORD_ID = 'settings'

export const RECORDS_FLAG_VALUE = 'records-v1'
export const MAX_RECORD_ID_LENGTH = 128
/** Largest single record the server stores (a chart plus metadata). */
export const MAX_RECORD_BYTES = 512 * 1024
/**
 * Most changes accepted in one push request. Kept small so one request stays well inside D1's
 * 50 statements per invocation on the Workers Free plan (a push uses changes + ~10 statements).
 */
export const MAX_PUSH_CHANGES = 25
/**
 * #208 F5: client-side byte budget for one push body. The server reads at most 2 MiB
 * (MAX_RECORDS_PUSH_BYTES); this leaves room for the JSON envelope.
 */
export const MAX_PUSH_BODY_BYTES = 1536 * 1024
/** Most records returned in one pull page. */
export const MAX_PULL_RECORDS = 200

export interface SongbookRecord {
  kind: RecordKind
  id: string
  data: unknown
}

/** One change a client pushes: the record as it should be, based on the server revision it last saw. */
export interface RecordChange {
  kind: RecordKind
  id: string
  /** Server revision this change is based on; 0 for a record the server has never stored. */
  baseRev: number
  removed?: boolean
  data?: unknown
}

/** A record as the server stores and returns it. */
export interface ServerRecord {
  kind: RecordKind
  id: string
  rev: number
  seq: number
  removed: boolean
  checksum: string
  data: unknown | null
}

export interface PushAccepted { kind: RecordKind; id: string; rev: number; seq: number; checksum: string }
export interface PushConflict { kind: RecordKind; id: string; current: ServerRecord | null
  /** #240: a song deletion refused because a live setlist in the cloud still lists the song. */
  reason?: 'referenced' }
export interface PushResponse { accepted: PushAccepted[]; conflicts: PushConflict[]; head: number; mirror: 'updated' | 'unchanged' | 'superseded' | 'skipped-size' | 'skipped-conflict' | 'failed' }
export interface PullResponse { records: ServerRecord[]; cursor: number; head: number; more: boolean }

export const recordKey = (kind: RecordKind, id: string): string => `${kind}:${id}`

/** JSON with sorted keys and undefined members dropped, so equal data always hashes the same. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : stableJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

/** `rk_` + two 32-bit hashes of the stable JSON (same scheme as the library checksum). */
export function recordChecksum(removed: boolean, data: unknown): string {
  const text = removed ? 'removed' : stableJson(data)
  let h1 = 0x811c9dc5
  let h2 = 5381
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193)
    h2 = ((h2 << 5) + h2 + code) | 0
  }
  return `rk_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/** Splits a library into records. Songs and setlists must already have stable IDs. */
export function libraryToRecords(library: SyncLibrary): SongbookRecord[] {
  const records: SongbookRecord[] = []
  for (const song of library.songs) {
    if (song.id === undefined || song.id === null || String(song.id) === '') throw new Error('Song without a stable ID cannot be synced')
    records.push({ kind: 'song', id: String(song.id), data: song })
  }
  for (const setlist of library.setlists) {
    if (setlist.id === undefined || setlist.id === null || String(setlist.id) === '') throw new Error('Setlist without a stable ID cannot be synced')
    records.push({ kind: 'setlist', id: String(setlist.id), data: setlist })
  }
  if (library.themeSettings !== undefined) records.push({ kind: 'theme', id: THEME_RECORD_ID, data: library.themeSettings })
  return records
}

/** Rebuilds a library from records, songs and setlists in the order given. */
export function recordsToLibrary(records: Iterable<{ kind: RecordKind; data: unknown; removed?: boolean }>): SyncLibrary {
  const songs: ActiveSongState[] = []
  const setlists: WebSetlist[] = []
  let themeSettings: CloudThemeSettings | undefined
  for (const record of records) {
    if (record.removed || record.data === null || record.data === undefined) continue
    if (record.kind === 'song') songs.push(record.data as ActiveSongState)
    else if (record.kind === 'setlist') setlists.push(record.data as WebSetlist)
    else themeSettings = record.data as CloudThemeSettings
  }
  return themeSettings !== undefined ? { songs, setlists, themeSettings } : { songs, setlists }
}

/** Shape check for one pushed record's data; theme settings are validated by the caller. */
export function recordDataError(kind: RecordKind, id: string, data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return `${kind} ${id}: data must be an object`
  const value = data as Record<string, unknown>
  if (kind === 'song') {
    if (String(value.id ?? '') !== id) return `song ${id}: data.id does not match`
    if (typeof value.title !== 'string' || !value.title.trim()) return `song ${id}: missing title`
    if (typeof value.rawContent !== 'string') return `song ${id}: missing rawContent`
  } else if (kind === 'setlist') {
    if (String(value.id ?? '') !== id) return `setlist ${id}: data.id does not match`
    if (typeof value.name !== 'string' || !value.name.trim()) return `setlist ${id}: missing name`
    if (!Array.isArray(value.songs)) return `setlist ${id}: missing songs`
    for (const ref of value.songs as unknown[]) {
      if (!ref || typeof ref !== 'object' || typeof (ref as { title?: unknown }).title !== 'string') return `setlist ${id}: invalid song reference`
    }
  } else if (id !== THEME_RECORD_ID) {
    return `theme record id must be "${THEME_RECORD_ID}"`
  }
  return null
}
