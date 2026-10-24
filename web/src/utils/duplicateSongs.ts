/**
 * #149 S2: deterministic duplicate check for the personal Songs Library. Local only: no network,
 * no AI service. Nothing here mutates the library; the review dialog asks App to move copies to
 * Trash (recoverable) and, for exact copies used in setlists, to re-point those references first.
 *
 * - exact:    same chart body (line whitespace ignored)
 * - likely:   same title + artist and same lyrics, chords/directives differ (e.g. transposed)
 * - distinct: same title + artist, different lyrics. Shown for information only, no delete.
 */
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { songIdentity } from './setlistSongs'

export type DuplicateKind = 'exact' | 'likely' | 'distinct'
export type CopyVerdict =
  | 'keep' // the copy that stays
  | 'safe' // exact copy, no setlist uses it: Move to Trash
  | 'repoint' // exact copy used in setlists: re-point them to the kept copy, then Move to Trash
  | 'review' // likely copy, no setlist uses it: chords differ, Move to Trash after a look
  | 'blocked' // likely copy used in setlists: remove it from those setlists first
  | 'info' // distinct version: not a duplicate

export interface DuplicateCopy { id: string; index: number; title: string; artist: string; key: string; setlists: string[]; verdict: CopyVerdict }
export interface DuplicateGroup { kind: DuplicateKind; dismissKey: string; title: string; artist: string; copies: DuplicateCopy[] }

export const DISMISSED_DUPLICATES_KEY = 'gtar_duplicate_dismissed_v1'

export function normalizeChartBody(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** Lyrics only: no [chords], no {directive} lines, case and spacing ignored. */
export function lyricsSignature(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !/^\s*\{[^}]*\}\s*$/.test(line))
    .map(line => line.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean).join('\n')
}

/** cyrb53: small, stable, non-cryptographic. Only used to key "Not a duplicate" decisions. */
function hash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function by(list: Entry[], keyOf: (e: Entry) => string): Entry[][] {
  const map = new Map<string, Entry[]>()
  for (const e of list) map.set(keyOf(e), [...(map.get(keyOf(e)) ?? []), e])
  return [...map.values()]
}

interface Entry { song: ActiveSongState; id: string; index: number; body: string; lyrics: string; setlists: string[] }

/** A decision stays valid only while the same songs have the same content. */
function dismissKey(kind: DuplicateKind, entries: Entry[]): string {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id))
  return `${kind}:${hash(sorted.map(e => `${e.id}\u0000${e.body}`).join('\u0001'))}`
}

/** Most-used copy stays; ties keep the earliest in library order. */
function pickKeep(entries: Entry[]): Entry {
  return [...entries].sort((a, b) => b.setlists.length - a.setlists.length || a.index - b.index)[0]
}

function verdictFor(kind: DuplicateKind, entry: Entry, keep: Entry): CopyVerdict {
  if (kind === 'distinct') return 'info'
  if (entry === keep) return 'keep'
  if (kind === 'exact') return entry.setlists.length ? 'repoint' : 'safe'
  return entry.setlists.length ? 'blocked' : 'review'
}

function group(kind: DuplicateKind, entries: Entry[], keepId?: string): DuplicateGroup {
  const keep = (keepId && entries.find(e => e.id === keepId)) || pickKeep(entries)
  const ordered = [...entries].sort((a, b) => a.index - b.index)
  return {
    kind, dismissKey: dismissKey(kind, entries), title: keep.song.title, artist: keep.song.artist,
    copies: ordered.map(e => ({ id: e.id, index: e.index, title: e.song.title, artist: e.song.artist, key: e.song.key,
      setlists: e.setlists, verdict: verdictFor(kind, e, keep) })),
  }
}

/** Active (not trashed) songs only. `keepChoices` maps dismissKey → chosen keep id. */
export function findDuplicateGroups(songs: ActiveSongState[], setlists: WebSetlist[],
  options: { dismissed?: Iterable<string>; keepChoices?: Record<string, string> } = {}): DuplicateGroup[] {
  const dismissed = new Set(options.dismissed ?? [])
  const usage = new Map<string, string[]>()
  for (const list of setlists) {
    if (list.isDeleted) continue
    for (const ref of list.songs) {
      if (ref.id === undefined) continue
      const names = usage.get(String(ref.id)) ?? []
      if (!names.includes(list.name)) names.push(list.name)
      usage.set(String(ref.id), names)
    }
  }
  const entries: Entry[] = songs.flatMap((song, index) => song.id === undefined || song.isDeleted || !song.rawContent?.trim() ? [] : [{
    song, id: String(song.id), index, body: normalizeChartBody(song.rawContent), lyrics: lyricsSignature(song.rawContent),
    setlists: usage.get(String(song.id)) ?? [],
  }])
  const result: DuplicateGroup[] = []
  const keepFor = (kind: DuplicateKind, members: Entry[]) => options.keepChoices?.[dismissKey(kind, members)]
  for (const members of by(entries, e => e.body)) {
    if (members.length > 1) result.push(group('exact', members, keepFor('exact', members)))
  }
  for (const sameName of by(entries, e => songIdentity(e.song))) {
    if (sameName.length < 2) continue
    const byLyrics = by(sameName, e => e.lyrics)
    for (const members of byLyrics) {
      if (new Set(members.map(e => e.body)).size > 1) result.push(group('likely', members, keepFor('likely', members)))
    }
    if (byLyrics.length > 1) result.push(group('distinct', sameName))
  }
  const order: Record<DuplicateKind, number> = { exact: 0, likely: 1, distinct: 2 }
  return result.filter(g => !dismissed.has(g.dismissKey))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title))
}

/** Planned change for one group: which copies go to Trash, and which setlist refs move to the kept copy. */
export function planDuplicateCleanup(group: DuplicateGroup): { trash: string[]; repoint: Record<string, string> } {
  const keep = group.copies.find(c => c.verdict === 'keep')
  if (!keep) return { trash: [], repoint: {} }
  const trash = group.copies.filter(c => c.verdict === 'safe' || c.verdict === 'repoint' || c.verdict === 'review').map(c => c.id)
  const repoint = Object.fromEntries(group.copies.filter(c => c.verdict === 'repoint').map(c => [c.id, keep.id]))
  return { trash, repoint }
}

export function readDismissedDuplicates(storage: Pick<Storage, 'getItem'> = localStorage): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(DISMISSED_DUPLICATES_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch { return [] }
}
export function dismissDuplicateGroup(key: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const next = [...new Set([...readDismissedDuplicates(storage), key])]
  try { storage.setItem(DISMISSED_DUPLICATES_KEY, JSON.stringify(next)) } catch { /* decision stays for this session only */ }
}
