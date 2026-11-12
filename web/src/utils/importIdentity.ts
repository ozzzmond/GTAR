import type { ActiveSongState, WebSetlist } from '../types/gtar'

/** Canonical identity is explicit; names and timestamps never identify records. */
export function canonicalImportId(id: unknown): string {
  if (typeof id === 'number' && Number.isSafeInteger(id)) return String(id)
  if (typeof id === 'string' && id.trim()) return id.trim()
  throw new Error('Stable ID required. ID-less imports require explicit import-as-new; current records are unchanged.')
}

export function assertImportIds(records: Array<{ id?: string | number }>, label: string): void {
  const ids = new Set<string>()
  for (const record of records) {
    const id = canonicalImportId(record.id)
    if (ids.has(id)) throw new Error(`${label}: canonical ID collision (${id}); resolve identities explicitly.`)
    ids.add(id)
  }
}

export interface SkippedSetlist { id: string | number; name: string }
export interface SetlistMergeReport { setlists: WebSetlist[]; skipped: SkippedSetlist[] }
/** What a library merge reports back to its caller. */
export interface LibraryMergeResult { skippedSetlists: SkippedSetlist[] }

/**
 * #453 D6: a setlist that differs from the device's same-ID setlist is skipped (device version kept)
 * and named in `skipped`; everything else merges. Identity and lifecycle disagreements still abort.
 */
export function mergeImportedSetlistsWithReport(existing: WebSetlist[], incoming: WebSetlist[]): SetlistMergeReport {
  assertImportIds(existing, 'Existing setlists')
  assertImportIds(incoming, 'Imported setlists')
  const result = [...existing]
  const skipped: SkippedSetlist[] = []
  for (const list of incoming) {
    const index = result.findIndex(item => canonicalImportId(item.id) === canonicalImportId(list.id))
    if (index < 0) { result.push(list); continue }
    const previous = result[index]
    if (String(previous.id) !== String(list.id)) throw new Error(`Setlist canonical ID collision (${list.id}); resolve whitespace aliases explicitly.`)
    if (!!previous.isDeleted !== !!list.isDeleted) throw new Error(`Setlist lifecycle conflict (${list.id}); resolve explicitly. Original records and tombstones retained.`)
    // Without a shared base, neither a timestamp nor arrival order proves a revision safe.
    const revision = (value: WebSetlist) => JSON.stringify([value.name, value.folderId ?? null, value.songs.map((ref, position) => [ref.id === undefined ? null : canonicalImportId(ref.id), ref.entryId ?? `entry:${value.id}:${position}`, position, ref.title, ref.artist ?? ''])])
    if (revision(previous) !== revision(list)) skipped.push({ id: previous.id, name: previous.name })
  }
  return { setlists: result, skipped }
}

/** The merged setlists only; callers that tell the user what happened use mergeImportedSetlistsWithReport. */
export function mergeImportedSetlists(existing: WebSetlist[], incoming: WebSetlist[]): WebSetlist[] {
  return mergeImportedSetlistsWithReport(existing, incoming).setlists
}

export function assertSongLifecycle(existing: ActiveSongState[], incoming: ActiveSongState[]): void {
  assertImportIds(existing, 'Existing songs')
  assertImportIds(incoming, 'Imported songs')
  for (const song of incoming) {
    const previous = existing.find(item => canonicalImportId(item.id) === canonicalImportId(song.id))
    if (previous && String(previous.id) !== String(song.id)) throw new Error(`Song canonical ID collision (${song.id}); resolve whitespace aliases explicitly.`)
    if (previous && !!previous.isDeleted !== !!song.isDeleted) throw new Error(`Song lifecycle conflict (${song.id}); resolve explicitly. Original records and tombstones retained.`)
  }
}
