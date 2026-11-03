/**
 * #300 B3: the device library in one IndexedDB database (ported from GTAR1 src/utils/storage.ts,
 * adapted to GTAR types). Replaces gtar_library_v1 (localStorage), B1 (index + bodies) and B2
 * (per-account partitions).
 *
 * Database `gtar_library_db`, forward-only versions. Stores: `songs` and `setlists` (one record per
 * stable ID, `{ id: String(id), data }`), `folders` (S4 records), `snapshots` (safety
 * snapshots, last 5 / 50 MB) and `meta` (head: revision token, record order, top-level fields;
 * migration receipt).
 *
 * The synchronous storage seam in syncJournal stays: this tab holds the library in memory, a save
 * moves the revision token at once and queues one IndexedDB transaction that writes only the
 * changed records. The transaction first compares the stored head with the head this tab built on
 * (no last-write-wins): another tab's newer save aborts it and is reported as a stale write.
 * Committed saves are announced on a BroadcastChannel; other tabs load them on demand.
 *
 * No syncJournal import here, so syncJournal can depend on this module.
 */
import type { SetlistFolder } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'

export const LIBRARY_DB_NAME = 'gtar_library_db'
export const LIBRARY_DB_VERSION = 1
export const LIBRARY_SCHEMA_VERSION = 1
export const LIBRARY_STORES = { SONGS: 'songs', SETLISTS: 'setlists', FOLDERS: 'folders', SNAPSHOTS: 'snapshots', META: 'meta' } as const
export const LIBRARY_CHANNEL = 'gtar-library'
export const LIBRARY_EXTERNAL_EVENT = 'gtar-library-external-change'
export const LIBRARY_WRITE_FAILED_EVENT = 'gtar-library-write-failed'
export const SNAPSHOT_MAX_COUNT = 5
export const SNAPSHOT_MAX_BYTES = 50 * 1024 * 1024
const TOKEN_PREFIX = 'b3|'
const { SONGS, SETLISTS, FOLDERS, SNAPSHOTS, META } = LIBRARY_STORES

type Song = SyncLibrary['songs'][number]
type Setlist = SyncLibrary['setlists'][number]
type Extra = Record<string, unknown>
interface RecordRow<T> { id: string; data: T }
interface HeadRecord { key: 'head'; schemaVersion: number; rev: number; token: string; songOrder: string[]; setlistOrder: string[]; folderOrder?: string[]; extra: Extra; updatedAt: number }
export interface MigrationReceipt { key: 'migration'; schemaVersion: number; source: string; songs: number; setlists: number; at: number; ms: number }
export interface SafetySnapshot { id: string; at: number; reason: string; bytes: number; songs: number; setlists: number; raw: string }
export type SafetySnapshotInfo = Omit<SafetySnapshot, 'raw'>

/** A revision token this tab has not loaded yet (callers load it, then adopt). */
export class MissingLibraryBodyError extends Error {
  readonly token: string
  constructor(token: string) { super('Library revision not loaded in this tab yet'); this.name = 'MissingLibraryBodyError'; this.token = token }
}
export const isMissingLibraryBodyError = (error: unknown): error is MissingLibraryBodyError => error instanceof MissingLibraryBodyError
/** A save based on an older revision than the stored one (syncJournal turns it into StaleWriteConflictError). */
export class LibraryStaleWriteError extends Error {
  readonly currentRaw: string | null
  constructor(currentRaw: string | null) { super('Songbook library was updated in another tab or instance. Persistence rejected to prevent data loss.'); this.name = 'LibraryStaleWriteError'; this.currentRaw = currentRaw }
}
export class LibraryReadOnlyError extends Error {
  constructor() { super('Saving is paused: the songbook could not be moved to the new device storage. Export a backup, then reload to retry.'); this.name = 'LibraryReadOnlyError' }
}
export const isLibraryToken = (raw: string | null | undefined): raw is string => typeof raw === 'string' && raw.startsWith(TOKEN_PREFIX)
const tokenRev = (token: string | null) => token ? Number(token.split('|')[1]) || 0 : 0
const makeToken = (rev: number) => `${TOKEN_PREFIX}${rev}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

// IndexedDB helpers. Nothing but IndexedDB requests is awaited inside a transaction.
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })
}
function done(tx: IDBTransaction, abortReason?: () => unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    const fail = () => reject(abortReason?.() ?? tx.error ?? new Error('IndexedDB transaction aborted'))
    tx.onerror = fail
    tx.onabort = fail
  })
}
export function openLibraryDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest
    try { open = factory.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION) } catch (error) { reject(error); return }
    open.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result
      // Version 1. Later versions add stores or migrate records here; existing records and IDs are kept.
      for (const name of [SONGS, SETLISTS, FOLDERS, SNAPSHOTS]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
    }
    open.onsuccess = () => {
      const db = open.result
      db.onversionchange = () => { try { db.close() } catch { /* ignore */ } }
      resolve(db)
    }
    open.onerror = () => reject(open.error ?? new Error('Failed to open the library database'))
    open.onblocked = () => reject(new Error('Library database upgrade blocked by another tab'))
  })
}

// In-memory state of this tab.
interface Mirror { token: string | null; songs: Map<string, string>; setlists: Map<string, string>; folders: Map<string, string>; songOrder: string[]; setlistOrder: string[]; folderOrder?: string[]; extra: string }
interface State {
  db: IDBDatabase | null
  readOnly: boolean
  /** What IndexedDB holds as far as this tab knows (last commit or load). */
  committed: Mirror
  /** This tab's latest library and its token (moved synchronously by a save). */
  current: { token: string | null; library: SyncLibrary | null }
  /** Latest known token: own save or another tab's announced commit. */
  head: string | null
  /** Head the next transaction must find; `null` with `anyBase` skips the check (forced restore). */
  base: { token: string | null; any: boolean; full: boolean } | null
  dirty: boolean
  flushing: Promise<void> | null
  lastError: unknown
  loaded: Map<string, { library: SyncLibrary; mirror: Mirror }>
}
let state: State | null = null
let channel: BroadcastChannel | null = null
const jsonCache = new WeakMap<object, string>()
const json = (value: object) => { let s = jsonCache.get(value); if (s === undefined) { s = JSON.stringify(value); jsonCache.set(value, s) } return s }
const emptyMirror = (): Mirror => ({ token: null, songs: new Map(), setlists: new Map(), folders: new Map(), songOrder: [], setlistOrder: [], extra: '{}' })

function extraOf(library: SyncLibrary): Extra {
  const { songs: _s, setlists: _l, folders: _f, ...rest } = library as SyncLibrary & Extra
  void _s; void _l; void _f
  return JSON.parse(JSON.stringify(rest)) as Extra
}
function mirrorOf(token: string | null, library: SyncLibrary): Mirror {
  return {
    token,
    songs: new Map(library.songs.map(song => [String(song.id), json(song)])),
    setlists: new Map(library.setlists.map(list => [String(list.id), json(list)])),
    folders: new Map((library.folders ?? []).map(folder => [folder.id, json(folder)])),
    ...(library.folders ? { folderOrder: library.folders.map(folder => folder.id) } : {}),
    songOrder: library.songs.map(song => String(song.id)),
    setlistOrder: library.setlists.map(list => String(list.id)),
    extra: JSON.stringify(extraOf(library)),
  }
}
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y, k) && deepEqual(x[k], y[k]))
}
function notify(name: string, detail?: unknown): void {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new window.CustomEvent(name, { detail })) } catch { /* ignore */ }
}

/** True when this tab reads and writes the library through IndexedDB (or the read-only fallback). */
export function libraryStoreActive(): boolean { return state !== null }
export function libraryStoreReadOnly(): boolean { return !!state?.readOnly }
export function libraryStoreRevision(): string | null { return state ? state.head : null }
/** True while a save of this tab is not yet committed to IndexedDB (including a failed commit). */
export function libraryStorePending(): boolean { return !!state && (state.dirty || state.flushing !== null || state.lastError !== null) }

/** Library at `token`. Throws MissingLibraryBodyError for a token this tab has not loaded. */
export function libraryStoreDecode(token: string): SyncLibrary {
  if (!state) throw new Error('Library storage not open')
  if (token === state.current.token && state.current.library) return state.current.library
  const loaded = state.loaded.get(token)
  if (loaded) return loaded.library
  throw new MissingLibraryBodyError(token)
}
/** Current library of this tab (a copy), or null when nothing was ever saved. */
export function libraryStoreRead(): SyncLibrary | null {
  if (!state?.current.library) return null
  return JSON.parse(JSON.stringify(state.current.library)) as SyncLibrary
}

/**
 * Synchronous save of an already validated, canonical library. `expectedRaw`: the revision the
 * caller built on (stale-write guard); `force`: an explicitly confirmed replacement.
 */
export function libraryStorePersist(library: SyncLibrary, options: { expectedRaw?: string | null; force?: boolean } = {}): 'saved' | 'unchanged' {
  const s = state
  if (!s) throw new Error('Library storage not open')
  if (s.readOnly) throw new LibraryReadOnlyError()
  // Older/partial callers omit folders; only an explicit array (including []) replaces them.
  const complete = library.folders === undefined && s.current.library?.folders !== undefined
    ? { ...library, folders: s.current.library.folders } : library
  const withColors = complete.tagColors === undefined && s.current.library?.tagColors !== undefined
    ? { ...complete, tagColors: s.current.library.tagColors } : complete
  const plain = JSON.parse(JSON.stringify(withColors)) as SyncLibrary
  const sameContent = s.current.library !== null && deepEqual(s.current.library, plain)
  if (!options.force && options.expectedRaw !== undefined && options.expectedRaw !== s.head && !sameContent) throw new LibraryStaleWriteError(s.head)
  if (sameContent && s.current.token === s.head) return 'unchanged'
  if (options.force) s.base = { token: null, any: true, full: true }
  else if (s.head !== s.current.token) {
    // Saving on top of another tab's announced revision this tab has not loaded: rewrite in full,
    // but only if that revision is still the stored one.
    s.base = { token: s.head, any: false, full: true }
  }
  const token = makeToken(Math.max(tokenRev(s.head), tokenRev(s.current.token)) + 1)
  s.current = { token, library: plain }
  s.head = token
  s.dirty = true
  void flushLibraryStore().catch(() => { /* reported via LIBRARY_WRITE_FAILED_EVENT */ })
  return 'saved'
}

/** Resolves when every save of this tab is committed; rejects with the failure of the last attempt. */
export function flushLibraryStore(): Promise<void> {
  const s = state
  if (!s || s.readOnly) return Promise.resolve()
  if (s.flushing) return s.flushing
  // A failed commit is retried (the diff against the committed state still holds those edits).
  if (s.lastError) s.dirty = true
  if (!s.dirty) return Promise.resolve()
  s.flushing = (async () => {
    try {
      while (s.dirty) {
        s.dirty = false
        const target = s.current
        const base = s.base ?? { token: s.committed.token, any: false, full: false }
        const next = mirrorOf(target.token, target.library!)
        try {
          await commit(s.db!, s.committed, next, target.library!, base)
        } catch (error) {
          s.lastError = error
          notify(LIBRARY_WRITE_FAILED_EVENT, error)
          throw error
        }
        s.committed = next
        s.base = null
        s.lastError = null
        try { channel?.postMessage({ token: target.token }) } catch { /* other tabs reload later */ }
      }
    } finally { s.flushing = null }
  })()
  return s.flushing
}

async function commit(db: IDBDatabase, from: Mirror, to: Mirror, library: SyncLibrary, base: { token: string | null; any: boolean; full: boolean }): Promise<void> {
  const tx = db.transaction([SONGS, SETLISTS, FOLDERS, META], 'readwrite')
  let conflict: LibraryStaleWriteError | null = null
  const finished = done(tx, () => conflict ?? undefined)
  const songs = tx.objectStore(SONGS), setlists = tx.objectStore(SETLISTS), folders = tx.objectStore(FOLDERS), meta = tx.objectStore(META)
  const headRequest = meta.get('head')
  headRequest.onsuccess = () => {
    const stored = (headRequest.result as HeadRecord | undefined)?.token ?? null
    if (!base.any && stored !== base.token) { conflict = new LibraryStaleWriteError(stored); tx.abort(); return }
    if (base.full) {
      songs.clear(); setlists.clear(); folders.clear()
      for (const song of library.songs) songs.put({ id: String(song.id), data: song } satisfies RecordRow<Song>)
      for (const list of library.setlists) setlists.put({ id: String(list.id), data: list } satisfies RecordRow<Setlist>)
      for (const folder of library.folders ?? []) folders.put({ id: folder.id, data: folder })
    } else {
      const bySong = new Map(library.songs.map(song => [String(song.id), song]))
      for (const [id, text] of to.songs) if (from.songs.get(id) !== text) songs.put({ id, data: bySong.get(id)! })
      for (const id of from.songs.keys()) if (!to.songs.has(id)) songs.delete(id)
      const byList = new Map(library.setlists.map(list => [String(list.id), list]))
      for (const [id, text] of to.setlists) if (from.setlists.get(id) !== text) setlists.put({ id, data: byList.get(id)! })
      for (const id of from.setlists.keys()) if (!to.setlists.has(id)) setlists.delete(id)
    }
    const byFolder = new Map((library.folders ?? []).map(folder => [folder.id, folder]))
    if (!base.full) {
      for (const [id, text] of to.folders) if (from.folders.get(id) !== text) folders.put({ id, data: byFolder.get(id)! })
      for (const id of from.folders.keys()) if (!to.folders.has(id)) folders.delete(id)
    }
    meta.put({
      key: 'head', schemaVersion: LIBRARY_SCHEMA_VERSION, rev: tokenRev(to.token), token: to.token!,
      songOrder: to.songOrder, setlistOrder: to.setlistOrder, ...(to.folderOrder ? { folderOrder: to.folderOrder } : {}), extra: JSON.parse(to.extra) as Extra, updatedAt: Date.now(),
    } satisfies HeadRecord)
  }
  await finished
}

async function readAll(db: IDBDatabase): Promise<{ head: HeadRecord | null; receipt: MigrationReceipt | null; library: SyncLibrary }> {
  const tx = db.transaction([SONGS, SETLISTS, FOLDERS, META], 'readonly')
  const finished = done(tx)
  const [songRows, setlistRows, folderRows, head, receipt] = await Promise.all([
    request(tx.objectStore(SONGS).getAll()) as Promise<RecordRow<Song>[]>,
    request(tx.objectStore(SETLISTS).getAll()) as Promise<RecordRow<Setlist>[]>,
    request(tx.objectStore(FOLDERS).getAll()) as Promise<RecordRow<SetlistFolder>[]>,
    request(tx.objectStore(META).get('head')) as Promise<HeadRecord | undefined>,
    request(tx.objectStore(META).get('migration')) as Promise<MigrationReceipt | undefined>,
  ])
  await finished
  const songs = new Map(songRows.map(row => [row.id, row.data]))
  const setlists = new Map(setlistRows.map(row => [row.id, row.data]))
  function order<T>(ids: string[] | undefined, records: Map<string, T>, label: string): T[] {
    const list = ids ?? []
    if (list.length !== records.size || new Set(list).size !== list.length || !list.every(id => records.has(id))) throw new Error(`Stored ${label} order does not match the stored records`)
    return list.map(id => records.get(id)!)
  }
  const library = { ...(head?.extra ?? {}), songs: order(head?.songOrder, songs, 'song'), setlists: order(head?.setlistOrder, setlists, 'setlist'),
    ...(head?.folderOrder || folderRows.length ? { folders: order(head?.folderOrder, new Map(folderRows.map(row => [row.id, row.data])), 'folder') } : {}) } as SyncLibrary
  return { head: head ?? null, receipt: receipt ?? null, library }
}

/** Loads another tab's committed revision so it can be decoded and adopted here. */
export async function libraryStoreLoad(token: string): Promise<void> {
  const s = state
  if (!s?.db) return
  const { head, library } = await readAll(s.db)
  const stored = head?.token ?? null
  if (stored !== token) {
    // Newer than announced: point the head at it; the guard runs again for that revision.
    if (stored && stored !== s.head) { s.head = stored; notify(LIBRARY_EXTERNAL_EVENT, stored) }
    return
  }
  const mirror = mirrorOf(token, library)
  s.loaded.clear()
  s.loaded.set(token, { library, mirror })
  if (!libraryStorePending()) { s.committed = mirror; s.current = { token, library } }
}

/** Explicit conflict recovery: discard the protected local draft and adopt the committed library. */
export async function reloadLibraryStore(validate: (library: unknown) => void): Promise<string | null> {
  const s = state
  if (!s?.db || s.readOnly) throw new Error('Library storage unavailable')
  const localToken = s.current.token
  // A queued save must finish (or fail) before its local state can be discarded.
  try { await s.flushing } catch { /* the draft was preserved by the caller */ }
  const { head, library } = await readAll(s.db)
  if (state !== s || s.current.token !== localToken) throw new Error('Local library changed while loading. Retry reload.')
  if (!head) throw new Error('Latest library unavailable')
  validate(library)
  const mirror = mirrorOf(head.token, library)
  s.committed = mirror
  s.current = { token: head.token, library }
  s.head = head.token
  s.base = null
  s.dirty = false
  s.lastError = null
  s.loaded.clear()
  return head.token
}

function setupChannel(): void {
  try { channel?.close() } catch { /* ignore */ }
  channel = null
  if (typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel(LIBRARY_CHANNEL)
  // Node (tests) only: do not keep the process alive for the channel.
  ;(channel as BroadcastChannel & { unref?: () => void }).unref?.()
  channel.onmessage = event => {
    const token = (event.data as { token?: unknown } | null)?.token
    if (!state || !isLibraryToken(token as string) || token === state.current.token) return
    if (tokenRev(token as string) < tokenRev(state.head) && state.head !== state.current.token) return
    state.head = token as string
    notify(LIBRARY_EXTERNAL_EVENT, token)
  }
}

function install(db: IDBDatabase | null, token: string | null, library: SyncLibrary | null, readOnly = false): void {
  state = {
    db, readOnly,
    committed: library ? mirrorOf(token, library) : emptyMirror(),
    current: { token, library },
    head: token, base: null, dirty: false, flushing: null, lastError: null, loaded: new Map(),
  }
  if (!readOnly) setupChannel()
}

// Safety snapshots (owner decision #300: last 5, 50 MB total, oldest dropped first).
/** Saves a verified safety snapshot of `library`; resolves with its id after it reads back identical. */
export async function takeSafetySnapshot(reason: string, library: SyncLibrary, db: IDBDatabase | null = state?.db ?? null): Promise<string> {
  if (!db) throw new Error('Safety snapshot storage unavailable')
  const raw = JSON.stringify(library)
  const record: SafetySnapshot = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), reason,
    bytes: raw.length * 2, songs: library.songs.length, setlists: library.setlists.length, raw,
  }
  if (record.bytes > SNAPSHOT_MAX_BYTES) throw new DOMException('Safety snapshot exceeds the 50 MB storage limit. Export a backup before retrying.', 'QuotaExceededError')
  const tx = db.transaction([SNAPSHOTS], 'readwrite')
  const finished = done(tx)
  const store = tx.objectStore(SNAPSHOTS)
  const all = store.getAll()
  all.onsuccess = () => {
    const kept = (all.result as SafetySnapshot[]).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    let count = kept.length + 1, bytes = kept.reduce((sum, item) => sum + item.bytes, record.bytes)
    for (const old of kept) {
      if (count <= SNAPSHOT_MAX_COUNT && bytes <= SNAPSHOT_MAX_BYTES) break
      store.delete(old.id); count--; bytes -= old.bytes
    }
    store.put(record)
  }
  await finished
  const back = await request(db.transaction([SNAPSHOTS], 'readonly').objectStore(SNAPSHOTS).get(record.id)) as SafetySnapshot | undefined
  if (back?.raw !== raw) throw new Error('Safety snapshot could not be verified')
  return record.id
}
export async function listSafetySnapshots(): Promise<SafetySnapshotInfo[]> {
  if (!state?.db) return []
  const all = await request(state.db.transaction([SNAPSHOTS], 'readonly').objectStore(SNAPSHOTS).getAll()) as SafetySnapshot[]
  return all.map(({ raw: _raw, ...info }) => { void _raw; return info }).sort((a, b) => b.at - a.at)
}
export async function readSafetySnapshot(id: string): Promise<SyncLibrary | null> {
  if (!state?.db) return null
  const record = await request(state.db.transaction([SNAPSHOTS], 'readonly').objectStore(SNAPSHOTS).get(id)) as SafetySnapshot | undefined
  return record ? JSON.parse(record.raw) as SyncLibrary : null
}
/** Recovery export: every safety snapshot on this device (the pre-restore copy stays recoverable). */
export async function exportSafetySnapshots(): Promise<Record<string, string>> {
  if (!state?.db) return {}
  const all = await request(state.db.transaction([SNAPSHOTS], 'readonly').objectStore(SNAPSHOTS).getAll()) as SafetySnapshot[]
  const data: Record<string, string> = {}
  for (const snapshot of all) data[`gtar_library_snapshot::${snapshot.id}`] = snapshot.raw
  return data
}

// One-time migration and startup.
export interface LibrarySource { key: string; library: SyncLibrary }
export type MigrationStep = 'open' | 'source' | 'snapshot' | 'write' | 'verify' | 'receipt'
export interface LibraryStoreDeps {
  factory: IDBFactory | null
  /** A surviving B3 marker forbids importing the frozen legacy source again. */
  requireReceipt?: boolean
  /** Reads the earlier library (read-only); null when there is none. */
  readSource: () => Promise<LibrarySource | null>
  validate: (library: unknown) => void
  /** Tests: fail at this step. */
  failAt?: MigrationStep
}
export interface LibraryStorePreparation {
  active: boolean; migrated: boolean; readOnly: boolean; /** #300 review: storage could not be opened and the earlier copy must not be written (fail closed). */ blocked: boolean; source: string | null; songs: number; setlists: number; ms: number; error: string | null
}

const recordText = (value: unknown) => JSON.stringify(value)
function verifyCopy(source: SyncLibrary, copy: SyncLibrary): void {
  const check = (label: string, a: Array<{ id?: unknown }>, b: Array<{ id?: unknown }>) => {
    if (a.length !== b.length) throw new Error(`${label} count ${b.length} stored, ${a.length} expected`)
    a.forEach((item, i) => {
      if (String(item.id) !== String(b[i].id)) throw new Error(`${label} ID or order differs at ${i + 1}`)
      if (recordText(item) !== recordText(b[i])) throw new Error(`${label} ${String(item.id)} content differs`)
    })
  }
  check('song', source.songs, copy.songs)
  check('setlist', source.setlists, copy.setlists)
  check('folder', source.folders ?? [], copy.folders ?? [])
  if (recordText(extraOf(source)) !== recordText(extraOf(copy))) throw new Error('library fields differ')
}

/**
 * Startup. Opens the database; on first run copies the earlier library into it (safety snapshot,
 * one atomic write, read back and compare counts, IDs and content, then the receipt switches
 * storage). The earlier library is only read. Any failure: storage is not switched and the caller
 * keeps using the earlier library (or, when only IndexedDB held it, a read-only copy).
 */
export async function prepareLibraryStore(deps: LibraryStoreDeps): Promise<LibraryStorePreparation> {
  const started = Date.now()
  const result = (extra: Partial<LibraryStorePreparation>): LibraryStorePreparation =>
    ({ active: false, migrated: false, readOnly: false, blocked: false, source: null, songs: 0, setlists: 0, ms: Date.now() - started, error: null, ...extra })
  const step = (name: MigrationStep) => { if (deps.failAt === name) throw new Error(`Migration interrupted at ${name}`) }
  let db: IDBDatabase | null = null
  let source: LibrarySource | null = null
  try {
    step('open')
    if (!deps.factory) throw new Error('IndexedDB is not available in this browser')
    db = await openLibraryDatabase(deps.factory)
    const existing = await readAll(db)
    if (existing.receipt) {
      const library = existing.head ? existing.library : null
      if (library) deps.validate(library)
      install(db, existing.head?.token ?? null, library)
      return result({ active: true, source: existing.receipt.source, songs: library?.songs.length ?? 0, setlists: library?.setlists.length ?? 0 })
    }
    if (deps.requireReceipt) throw new Error('Previously migrated library receipt is missing. Restore from a JSON backup in working storage.')
    step('source')
    source = await deps.readSource()
    const library = source ? JSON.parse(JSON.stringify(source.library)) as SyncLibrary : null
    if (library) deps.validate(library)
    step('snapshot')
    if (library && library.songs.length + library.setlists.length + (library.folders?.length ?? 0) > 0) await takeSafetySnapshot('before-migration', library, db)
    step('write')
    const token = library ? makeToken(1) : null
    let migratedHere = false
    {
      const tx = db.transaction([SONGS, SETLISTS, FOLDERS, META], 'readwrite')
      const finished = done(tx)
      const songs = tx.objectStore(SONGS), setlists = tx.objectStore(SETLISTS), folders = tx.objectStore(FOLDERS), meta = tx.objectStore(META)
      const receiptRequest = meta.get('migration')
      receiptRequest.onsuccess = () => {
        // #300 review: another tab may have completed the migration between our first read and this
        // write (with edits since). Recheck the receipt inside the transaction: keep its records and
        // adopt the committed library below instead of replacing them with the older source.
        if (receiptRequest.result) return
        migratedHere = true
        songs.clear(); setlists.clear(); folders.clear(); meta.delete('head')
        if (library && token) {
          for (const song of library.songs) songs.put({ id: String(song.id), data: song })
          for (const list of library.setlists) setlists.put({ id: String(list.id), data: list })
          for (const folder of library.folders ?? []) folders.put({ id: folder.id, data: folder })
          const mirror = mirrorOf(token, library)
          meta.put({ key: 'head', schemaVersion: LIBRARY_SCHEMA_VERSION, rev: 1, token, songOrder: mirror.songOrder, setlistOrder: mirror.setlistOrder, ...(mirror.folderOrder ? { folderOrder: mirror.folderOrder } : {}), extra: extraOf(library), updatedAt: Date.now() } satisfies HeadRecord)
        }
      }
      await finished
    }
    if (!migratedHere) {
      // The receipt was committed by another tab before this write: reuse its result, do not migrate.
      const adopted = await readAll(db)
      const adoptedLibrary = adopted.head ? adopted.library : null
      if (adoptedLibrary) deps.validate(adoptedLibrary)
      install(db, adopted.head?.token ?? null, adoptedLibrary)
      return result({ active: true, source: adopted.receipt?.source ?? source?.key ?? null, songs: adoptedLibrary?.songs.length ?? 0, setlists: adoptedLibrary?.setlists.length ?? 0 })
    }
    step('verify')
    const copy = await readAll(db)
    if (library) verifyCopy(library, copy.library)
    else if (copy.library.songs.length || copy.library.setlists.length || copy.library.folders?.length) throw new Error('Empty migration left records behind')
    step('receipt')
    const receipt: MigrationReceipt = { key: 'migration', schemaVersion: LIBRARY_SCHEMA_VERSION, source: source?.key ?? 'empty', songs: library?.songs.length ?? 0, setlists: library?.setlists.length ?? 0, at: Date.now(), ms: Date.now() - started }
    {
      const tx = db.transaction([META], 'readwrite')
      const finished = done(tx)
      tx.objectStore(META).put(receipt)
      await finished
    }
    install(db, token, library ? copy.library : null)
    return result({ active: true, migrated: true, source: receipt.source, songs: receipt.songs, setlists: receipt.setlists })
  } catch (error) {
    try { db?.close() } catch { /* ignore */ }
    const message = error instanceof Error ? error.message : String(error)
    return result({ error: message, source: source?.key ?? null })
  }
}

/**
 * Migration failed and the earlier library lives only in storage this build no longer writes
 * (B1/B2): show it read-only so nothing is lost or overwritten.
 */
export function openReadOnlyLibrary(source: LibrarySource): void {
  install(null, `${TOKEN_PREFIX}0|readonly`, JSON.parse(JSON.stringify(source.library)) as SyncLibrary, true)
}

/**
 * #300 review: no library could be opened and it must not be replaced by a stale copy. Hold a
 * read-only, empty state so the storage seam refuses every save until a reload succeeds.
 */
export function blockLibraryStore(): void {
  install(null, `${TOKEN_PREFIX}0|blocked`, null, true)
}

/** Tests: forget this tab's state (the database is left as it is). */
export function resetLibraryStoreForTests(): void {
  try { state?.db?.close() } catch { /* ignore */ }
  try { channel?.close() } catch { /* ignore */ }
  state = null; channel = null
}
