import type { SyncLibrary } from './syncMerge'
import { prunePersistedLogs } from './logger'

const ownerKey = 'gtar_sync_library_owner'

export const LIBRARY_KEY = 'gtar_library_v1'
export const SYNC_RETIRED_KEY = 'gtar_sync_retired_v1'

export const CANONICAL_STORAGE_PREFIXES = [
  LIBRARY_KEY,
  SYNC_RETIRED_KEY,
  ownerKey,
  'gtar_sync_v1:',
  'gtar_songs_store',
  'gtar_trash_songs_store',
  'gtar_setlists_store',
  'gtar_active_setlist_id',
  'gtar_theme_store',
  'gtar_theme_mode',
  'gtar_custom_theme_colors',
  'gtar_font_style_store',
  'gtar_font_style',
  'gtar_twocolumn_store',
  'gtar_is_two_column',
  'gtar_stage_font_size',
  'gtar_stage_scroll_speed',
]

export function isCanonicalKey(k: string): boolean {
  return CANONICAL_STORAGE_PREFIXES.some(prefix => k === prefix || k.startsWith(prefix))
}

export function isQuotaError(err: unknown): boolean {
  if (!err) return false
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014 ||
      /quota/i.test(err.message)
    )
  }
  if (err instanceof Error) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      /quota/i.test(err.message)
    )
  }
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    return (
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014 ||
      (typeof e.message === 'string' && (/quota/i.test(e.message) || e.message.includes('NS_ERROR_DOM_QUOTA_REACHED')))
    )
  }
  return false
}

export function pruneAllRecoverySnapshots(storage: Storage, maxAllowed = 0) {
  const prefix = 'gtar_sync_recovery:'
  const existingKeys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(prefix) && !isCanonicalKey(k)) existingKeys.push(k)
  }
  existingKeys.sort()
  while (existingKeys.length > maxAllowed) {
    const oldest = existingKeys.shift()
    if (oldest && !isCanonicalKey(oldest)) {
      try {
        const library = readPersistedLibrary(storage)
        const snapshot = JSON.parse(storage.getItem(oldest) ?? 'null')
        if (!library || !snapshot?.local || !Object.hasOwn(snapshot, 'remote') || snapshot.journal?.pending) continue
        let checked = reconcile(library, snapshot.local)
        if (snapshot.remote) checked = reconcile(checked, snapshot.remote)
        if (snapshot.journal?.baseline) checked = reconcile(checked, snapshot.journal.baseline)
        if (same(library, checked)) storage.removeItem(oldest)
      } catch { /* Ambiguous snapshots remain available for export. */ }
    }
  }
}

const legacyKeys = ['gtar_songs_store', 'gtar_trash_songs_store', 'gtar_setlists_store']
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(k => Object.hasOwn(y, k) && same(x[k], y[k]))
}
const validId = (id: unknown) => (typeof id === 'string' && id.trim() !== '') || (typeof id === 'number' && Number.isFinite(id))

export function validateLibrary(value: unknown): asserts value is SyncLibrary {
  const fail = () => { throw new Error('Device library is damaged or ambiguous. Export recovery data before restoring.') }
  if (!value || typeof value !== 'object') return fail()
  const lib = value as SyncLibrary
  if (!Array.isArray(lib.songs) || !Array.isArray(lib.setlists)) return fail()
  const ids = new Set<string>(), lists = new Set<string>()
  for (const song of lib.songs) {
    if (!song || !validId(song.id) || typeof song.title !== 'string' || typeof song.rawContent !== 'string' || ids.has(String(song.id))) return fail()
    if (song.isDeleted !== undefined && typeof song.isDeleted !== 'boolean') return fail()
    ids.add(String(song.id))
  }
  for (const list of lib.setlists) {
    if (!list || !validId(list.id) || typeof list.name !== 'string' || !Array.isArray(list.songs) || lists.has(String(list.id))) return fail()
    lists.add(String(list.id))
    for (const ref of list.songs) {
      if (!ref || !validId(ref.id) || !ids.has(String(ref.id)) || typeof ref.title !== 'string') return fail()
    }
  }
  if (lib.allowedUsers !== undefined && (!Array.isArray(lib.allowedUsers) || !lib.allowedUsers.every(x => typeof x === 'string'))) return fail()
}

// Only choose a changed record when the other side still equals the known base.
// Conflicting edits, unknown formats and uncertain uploads retain all sources.
function reconcile(local: SyncLibrary, incoming: SyncLibrary, base?: SyncLibrary): SyncLibrary {
  validateLibrary(incoming)
  if (base) validateLibrary(base)
  function records<T extends { id?: string | number }>(left: T[], right: T[], prior?: T[]): T[] {
    const l = new Map(left.map(x => [String(x.id), x])), r = new Map(right.map(x => [String(x.id), x]))
    const b = new Map((prior ?? []).map(x => [String(x.id), x]))
    const result: T[] = []
    for (const id of new Set([...l.keys(), ...r.keys()])) {
      const x = l.get(id), y = r.get(id), old = b.get(id)
      let chosen: T | undefined
      if (same(x, y)) chosen = x
      else if (prior && same(x, old)) chosen = y
      else if (prior && same(y, old)) chosen = x
      else if (!prior && (!x || !y)) chosen = x ?? y
      else throw new Error('Conflicting recovery records')
      if (chosen) result.push(chosen)
    }
    if (prior && same(left.map(x => String(x.id)), prior.map(x => String(x.id)))) {
      const byId = new Map(result.map(x => [String(x.id), x]))
      const ordered = right.map(x => byId.get(String(x.id))).filter((x): x is T => x !== undefined)
      const included = new Set(ordered.map(x => String(x.id)))
      return [...ordered, ...result.filter(x => !included.has(String(x.id)))]
    }
    return result
  }
  const result = { ...local, songs: records(local.songs, incoming.songs, base?.songs), setlists: records(local.setlists, incoming.setlists, base?.setlists) }
  if (incoming.allowedUsers !== undefined && !same(local.allowedUsers, incoming.allowedUsers)) throw new Error('Conflicting legacy access settings')
  validateLibrary(result)
  return result
}

function resolvePending(base: SyncLibrary | null, value: unknown): SyncLibrary {
  if (!value || typeof value !== 'object') throw new Error('Missing pending library')
  if ('songs' in value) { validateLibrary(value); return value }
  const d = value as { changedSongs: SyncLibrary['songs']; deletedSongIds: unknown[]; songIdsOrder?: unknown[]; setlists: SyncLibrary['setlists']; allowedUsers?: string[] }
  if (!Array.isArray(d.changedSongs) || !Array.isArray(d.deletedSongIds) || !d.deletedSongIds.every(validId)) throw new Error('Invalid pending delta')
  validateLibrary({ songs: d.changedSongs, setlists: [] })
  const songs = new Map((base?.songs ?? []).map(x => [String(x.id), x]))
  for (const id of d.deletedSongIds) songs.delete(String(id))
  for (const song of d.changedSongs) songs.set(String(song.id), song)
  let ordered = [...songs.values()]
  if (d.songIdsOrder !== undefined) {
    if (!Array.isArray(d.songIdsOrder) || d.songIdsOrder.length !== songs.size || new Set(d.songIdsOrder.map(String)).size !== songs.size || !d.songIdsOrder.every(id => validId(id) && songs.has(String(id)))) throw new Error('Invalid delta ordering')
    ordered = d.songIdsOrder.map(id => songs.get(String(id))!)
  }
  const result = { songs: ordered, setlists: d.setlists, ...(d.allowedUsers === undefined ? {} : { allowedUsers: d.allowedUsers }) }
  validateLibrary(result)
  return result
}

export function recoveryData(storage: Storage = localStorage): Record<string, string> {
  const data: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && (k === LIBRARY_KEY || k === ownerKey || legacyKeys.includes(k) || k.startsWith('gtar_sync_v1:') || k.startsWith('gtar_sync_recovery:'))) data[k] = storage.getItem(k) ?? ''
  }
  return data
}

export function retireDriveSyncState(storage: Storage = localStorage): boolean {
  try {
    let library = readPersistedLibrary(storage)
    if (!library) return false
    const superseded: SyncLibrary[] = []
    const sources = recoveryData(storage)
    const keys = Object.keys(sources).filter(k => k !== LIBRARY_KEY && k !== ownerKey)
    for (const k of keys.filter(k => k.startsWith('gtar_sync_v1:'))) {
      const journal = JSON.parse(sources[k])
      if (journal.version !== 1) return false
      if (journal.baseline != null) validateLibrary(journal.baseline)
      if (journal.pending) {
        if (journal.pending.acknowledged !== true) return false
        const before = resolvePending(journal.baseline, journal.pending.beforeDelta ?? journal.pending.before)
        const merged = resolvePending(journal.baseline, journal.pending.mergedDelta ?? journal.pending.merged)
        library = reconcile(library, merged, before)
        superseded.push(before)
        if (journal.baseline) superseded.push(journal.baseline)
      } else if (journal.baseline) {
        library = reconcile(library, journal.baseline)
      }
    }
    const absorb = (incoming: SyncLibrary) => {
      validateLibrary(incoming)
      if (!superseded.some(old => same(old, incoming))) library = reconcile(library!, incoming)
    }
    for (const k of keys.filter(k => k.startsWith('gtar_sync_recovery:'))) {
      const snapshot = JSON.parse(sources[k])
      if (!snapshot.local || !Object.hasOwn(snapshot, 'remote')) return false
      absorb(snapshot.local)
      if (snapshot.remote !== null) absorb(snapshot.remote)
      if (snapshot.journal?.baseline) absorb(snapshot.journal.baseline)
      if (snapshot.journal?.pending) return false
    }
    if (legacyKeys.some(k => k in sources)) {
      const songs = JSON.parse(sources[legacyKeys[0]] ?? '[]')
      const trash = JSON.parse(sources[legacyKeys[1]] ?? '[]')
      const setlists = JSON.parse(sources[legacyKeys[2]] ?? '[]')
      if (!Array.isArray(songs) || !Array.isArray(trash)) return false
      absorb({ songs: [...songs, ...trash.map(song => ({ ...song, isDeleted: true }))], setlists })
    }
    // Commit and read back before deleting anything, including the retirement marker.
    persistLibrary(library, storage)
    if (!same(readPersistedLibrary(storage), library)) return false
    storage.setItem(SYNC_RETIRED_KEY, 'true')
    for (const k of [...keys, ownerKey]) if (storage.getItem(k) !== null) storage.removeItem(k)
    return true
  } catch { return false }
}

export function performStorageHousekeeping(storage: Storage = localStorage) {
  const retired = retireDriveSyncState(storage)
  try { prunePersistedLogs(storage, 30) } catch { /* Storage unavailable */ }
  return retired
}

export function persistLibrary(library: SyncLibrary, storage: Storage = localStorage) {
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(library))
  } catch (err) {
    if (!isQuotaError(err)) throw err
    // Logs are disposable. Journals, snapshots and legacy stores are not.
    prunePersistedLogs(storage, 10)
    try { storage.setItem(LIBRARY_KEY, JSON.stringify(library)) }
    catch (retryErr) { throw new Error('Local browser storage quota exceeded. Free up device storage or export a backup.', { cause: retryErr }) }
  }
}

export function readPersistedLibrary(storage: Storage = localStorage): SyncLibrary | null {
  const raw = storage.getItem(LIBRARY_KEY)
  if (!raw) return null
  const library: unknown = JSON.parse(raw)
  validateLibrary(library)
  return library
}

export interface StorageFootprint {
  totalBytes: number
  totalMB: number
  keyCount: number
  keys: Record<string, number>
}

export function estimateStorageFootprint(storage: Storage = localStorage): StorageFootprint {
  let totalBytes = 0
  const keys: Record<string, number> = {}
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (!k) continue
      const val = storage.getItem(k) ?? ''
      const bytes = (k.length + val.length) * 2
      totalBytes += bytes
      keys[k] = bytes
    }
  } catch {
    // ignore
  }
  return {
    totalBytes,
    totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    keyCount: Object.keys(keys).length,
    keys,
  }
}

export async function requestDurableStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
    return false
  }
  try {
    if (typeof navigator.storage.persisted === 'function') {
      const alreadyPersisted = await navigator.storage.persisted()
      if (alreadyPersisted) return true
    }
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export function setupCrossTabLibraryConflictGuard(
  onConflict: (externalRaw: string | null) => void,
  targetWindow: Window | EventTarget = typeof window !== 'undefined' ? window : ({} as unknown as EventTarget)
): () => void {
  if (!targetWindow || typeof (targetWindow as EventTarget).addEventListener !== 'function') {
    return () => {}
  }
  const handler = (event: Event) => {
    const storageEvent = event as StorageEvent
    if (storageEvent.key !== LIBRARY_KEY) return
    onConflict(storageEvent.newValue ?? null)
  }
  ;(targetWindow as EventTarget).addEventListener('storage', handler as EventListener)
  return () => {
    if (typeof (targetWindow as EventTarget).removeEventListener === 'function') {
      ;(targetWindow as EventTarget).removeEventListener('storage', handler as EventListener)
    }
  }
}