import { canonicalSongKey } from './musicalKey'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'
import { catalogFetch, getAuthenticatedSessionToken } from './sharedCatalogClient'
import { validateSnapshot } from './sharedSetlistSnapshot'
import type { SetlistSnapshot } from './sharedSetlistPublishing'
import { LIBRARY_KEY, persistLibrary, readPersistedLibrary, saveCrossTabConflictSnapshot, same } from './syncJournal'
import { generateUUID } from './uuid'

export interface CatalogPreview { id: string; revision: number; snapshot: SetlistSnapshot; account: string; token: string; scope: string }
export type ImportBlocker = 'editor-draft' | 'cross-tab-conflict' | 'actionable-recovery' | 'invalid-recovery'
export const importBlockerMessages: Record<ImportBlocker, string> = {
  'editor-draft': 'Save or discard editor changes before importing.',
  'cross-tab-conflict': 'Resolve the active cross-tab conflict before importing.',
  'actionable-recovery': 'Review local recovery and choose which versions to keep before importing.',
  'invalid-recovery': 'Local recovery data is invalid or unreadable. Export recovery data for manual recovery.',
}
export interface ImportHost {
  getLocal: () => SyncLibrary
  blocked: () => boolean
  blockers?: () => ImportBlocker[]
  applied: (library: SyncLibrary) => void
  open: (id: string | number) => void
}
function assertSession(preview: CatalogPreview) {
  const current = getAuthenticatedSessionToken()
  if (current.accountId !== preview.account || current.token !== preview.token || window.location.origin !== preview.scope) throw new Error('Account changed. Reopen preview.')
}
export async function previewCatalogSetlist(id: string, revision: number): Promise<CatalogPreview> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(id) || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid publication identity')
  const { accountId: account, token } = getAuthenticatedSessionToken()
  const scope = window.location.origin
  const result = await catalogFetch<{ id: string; revision: number; snapshot: unknown }>(`/api/catalog/setlists/${encodeURIComponent(id)}?revision=${revision}`, { token })
  if (!result || Object.keys(result).some(k => !['id', 'revision', 'snapshot'].includes(k)) || result.id !== id || result.revision !== revision) throw new Error('Malformed publication or wrong revision')
  validateSnapshot(result.snapshot)
  const preview = { id, revision, snapshot: result.snapshot as SetlistSnapshot, account, token, scope }
  assertSession(preview)
  return preview
}
export function existingCatalogImports(library: SyncLibrary, preview: CatalogPreview) {
  return library.setlists.filter(list => list.catalogSource?.environmentScope === preview.scope && list.catalogSource.setlistId === preview.id)
}
export function cloneCatalogSetlist(preview: CatalogPreview) {
  validateSnapshot(preview.snapshot)
  const songs = preview.snapshot.entries.map(entry => ({
    ...entry, id: generateUUID(), artist: entry.artist ?? '', key: entry.key ?? '', capo: entry.capo ?? '', bpm: entry.bpm ?? '',
    transposeOffset: entry.transposeOffset ?? 0,
  } as ActiveSongState))
  const setlist: WebSetlist = { id: generateUUID(), name: preview.snapshot.name, createdAt: Date.now(),
    catalogSource: { environmentScope: preview.scope, setlistId: preview.id, revision: preview.revision },
    songs: songs.map(song => ({ id: song.id, title: song.title, artist: song.artist })) }
  return { songs, setlist }
}
function assertImportUnblocked(host: ImportHost) {
  const reasons = host.blockers?.() ?? []
  if (reasons.length) throw new Error(reasons.map(reason => importBlockerMessages[reason]).join(' '))
  if (host.blocked()) throw new Error('Resolve editor, recovery or cross-tab conflicts before importing.')
}
let importing = false
export async function importCatalogSetlist(preview: CatalogPreview, host: ImportHost,
  action: { kind: 'new' | 'duplicate' | 'revision' | 'restore'; existingId?: string | number }) {
  if (importing) throw new Error('Import already in progress')
  importing = true
  try {
    if (!navigator.locks?.request) throw new Error('Safe import requires Web Locks support. Update your browser.')
    assertSession(preview)
    assertImportUnblocked(host)
    const baseline = localStorage.getItem(LIBRARY_KEY)
    const draft = host.getLocal()
    // Network revalidation is mandatory even for a previously reviewed revision.
    const fresh = await previewCatalogSetlist(preview.id, preview.revision)
    if (!same(fresh.snapshot, preview.snapshot)) throw new Error('Publication changed. Reopen preview.')
    return await navigator.locks.request('gtar-catalog-setlist-import', { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) throw new Error('Another tab is importing. Reload your library before retrying.')
      assertSession(preview)
      assertImportUnblocked(host)
      const stored = readPersistedLibrary()
      if (localStorage.getItem(LIBRARY_KEY) !== baseline || !stored ||
          !same(draft, host.getLocal()) || !same(JSON.parse(JSON.stringify(draft)), stored)) throw new Error('Library changed or has unsaved edits. Reload and review again.')
      const copies = existingCatalogImports(stored, preview)
      const exact = copies.filter(list => list.catalogSource!.revision === preview.revision)
      if ((action.kind === 'new' && copies.length) || (action.kind === 'revision' && (!copies.length || exact.length)) ||
          (action.kind === 'duplicate' && !exact.length)) throw new Error('Existing imports changed. Review the copy confirmation again.')
      let next: SyncLibrary, destination: WebSetlist
      if (action.kind === 'restore') {
        const target = exact.find(list => String(list.id) === String(action.existingId) && list.isDeleted)
        if (!target || target.songs.some(ref => !stored.songs.some(song => String(song.id) === String(ref.id) && !song.isDeleted))) throw new Error('Restore the missing or trashed songs through Trash first.')
        destination = { ...target, isDeleted: false }
        next = { ...stored, setlists: stored.setlists.map(list => list === target ? destination : list) }
      } else {
        const cloned = cloneCatalogSetlist(preview)
        destination = cloned.setlist
        next = { ...stored, songs: [...stored.songs, ...cloned.songs], setlists: [...stored.setlists, destination] }
      }
      // Preserve recovery before the single-key library transaction. No awaits in this section.
      saveCrossTabConflictSnapshot(stored)
      assertSession(preview)
      persistLibrary(next, localStorage, { expectedRaw: baseline })
      const saved = readPersistedLibrary()
      const expectedSongs = next.songs.map(song => ({ ...song, ...(song.key === undefined ? {} : { key: canonicalSongKey(song.key) }) }))
      if (!saved || !same(saved.songs, JSON.parse(JSON.stringify(expectedSongs))) || !same(saved.setlists.find(list => list.id === destination.id), destination) ||
          destination.songs.some(ref => !saved.songs.some(song => song.id === ref.id && !song.isDeleted))) throw new Error('Saved import could not be verified. Preserve recovery and reload.')
      host.applied(saved)
      return destination.id
    })
  } finally { importing = false }
}
export function openCatalogImport(id: string | number, preview: CatalogPreview, host: ImportHost) {
  assertSession(preview)
  const stored = readPersistedLibrary()
  const local = host.getLocal()
  const saved = stored?.setlists.find(list => String(list.id) === String(id) && !list.isDeleted)
  if (!saved || saved.songs.some(ref => {
    const song = stored?.songs.find(song => String(song.id) === String(ref.id) && !song.isDeleted)
    return !song || !local.songs.some(candidate => same(candidate, song))
  }) || saved.catalogSource?.environmentScope !== preview.scope || saved.catalogSource.setlistId !== preview.id ||
      saved.catalogSource.revision !== preview.revision || !host.getLocal().setlists.some(list => same(list, saved))) throw new Error('This copy is unavailable. Reload your library.')
  host.open(saved.id)
}
