/**
 * #167 Option B, phase B0 (DEV only): shadow copy of song chart bodies in IndexedDB.
 *
 * Chart bodies (`rawContent`, ~95% of library bytes) are written content-addressed and
 * write-once into IndexedDB after each successful local library save. Nothing reads from this
 * store yet: `gtar_library_v1` in localStorage remains the only source of truth, and nothing
 * here deletes, rewrites or migrates user data. Shadow writes and load-time verification only
 * report into Debug Logs so the next phase can be judged on field evidence.
 */
import { isLibraryStorageKey, isQuotaError, recoveryData, inspectRecovery, RESTORE_SNAPSHOT_KEY } from './syncJournal'

export const BODY_DB_NAME = 'gtar_library_bodies_db'
export const BODY_DB_VERSION = 1
export const BODY_STORE = 'bodies'

export interface BodyRecord { hash: string; body: string; chars: number; storedAt: number }
export interface ShadowReport { songs: number; unique: number; written: number; present: number; skipped?: string }
export interface VerifyReport { songs: number; unique: number; missing: number; corrupt: number }

interface LibraryLike { songs?: Array<{ rawContent?: unknown }> }
interface Logger { info(tag: string, message: string, details?: string): void; warn(tag: string, message: string, details?: string): void }
export interface BodyStoreOptions { indexedDBFactory?: IDBFactory | null; now?: () => number }

const TAG = 'LibraryBodyShadow'

/** `sha256:<hex>` of the UTF-8 body; identical charts share one record. */
export async function bodyHash(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return 'sha256:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

function factoryOf(options?: BodyStoreOptions): IDBFactory | null {
  if (options?.indexedDBFactory !== undefined) return options.indexedDBFactory
  return typeof indexedDB !== 'undefined' ? indexedDB : null
}

export function openBodyDatabase(options?: BodyStoreOptions): Promise<IDBDatabase> {
  const factory = factoryOf(options)
  if (!factory) return Promise.reject(new Error('IndexedDB is not available'))
  return new Promise((resolve, reject) => {
    const request = factory.open(BODY_DB_NAME, BODY_DB_VERSION)
    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(BODY_STORE)) db.createObjectStore(BODY_STORE, { keyPath: 'hash' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open library body database'))
    request.onblocked = () => reject(new Error('Library body database upgrade blocked'))
  })
}

function bodiesOf(library: LibraryLike): string[] {
  return Array.isArray(library?.songs) ? library.songs.map(song => typeof song?.rawContent === 'string' ? song.rawContent : '') : []
}

async function uniqueHashes(bodies: string[]): Promise<Map<string, string>> {
  const byHash = new Map<string, string>()
  for (const body of bodies) {
    const hash = await bodyHash(body)
    if (!byHash.has(hash)) byHash.set(hash, body)
  }
  return byHash
}

/** Reads all records for `hashes` in one read-only transaction. */
function readRecords(db: IDBDatabase, hashes: string[]): Promise<Map<string, BodyRecord | undefined>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BODY_STORE, 'readonly')
    const store = tx.objectStore(BODY_STORE)
    const found = new Map<string, BodyRecord | undefined>()
    let pending = hashes.length
    if (pending === 0) { resolve(found); return }
    for (const hash of hashes) {
      const request = store.get(hash)
      request.onsuccess = () => {
        found.set(hash, request.result as BodyRecord | undefined)
        if (--pending === 0) resolve(found)
      }
      request.onerror = () => reject(request.error || new Error('Library body read failed'))
    }
  })
}

/** Writes only missing bodies; never overwrites or deletes an existing record. */
export async function shadowWriteBodies(library: LibraryLike, options?: BodyStoreOptions): Promise<ShadowReport> {
  const bodies = bodiesOf(library)
  const byHash = await uniqueHashes(bodies)
  const db = await openBodyDatabase(options)
  try {
    const existing = await readRecords(db, [...byHash.keys()])
    const missing = [...byHash].filter(([hash]) => !existing.get(hash))
    if (missing.length) {
      const now = options?.now ?? Date.now
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BODY_STORE, 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error || new Error('Library body write failed'))
        tx.onabort = () => reject(tx.error || new Error('Library body write aborted'))
        const store = tx.objectStore(BODY_STORE)
        for (const [hash, body] of missing) store.put({ hash, body, chars: body.length, storedAt: now() } satisfies BodyRecord)
      })
    }
    return { songs: bodies.length, unique: byHash.size, written: missing.length, present: byHash.size - missing.length }
  } finally { db.close() }
}

/** Confirms every current chart body is present and byte-identical in the shadow store. */
export async function verifyShadowBodies(library: LibraryLike, options?: BodyStoreOptions): Promise<VerifyReport> {
  const bodies = bodiesOf(library)
  const byHash = await uniqueHashes(bodies)
  const db = await openBodyDatabase(options)
  try {
    const records = await readRecords(db, [...byHash.keys()])
    let missing = 0, corrupt = 0
    for (const [hash, body] of byHash) {
      const record = records.get(hash)
      if (!record) missing++
      else if (record.body !== body) corrupt++
    }
    return { songs: bodies.length, unique: byHash.size, missing, corrupt }
  } finally { db.close() }
}

export interface ShadowInstallOptions extends BodyStoreOptions {
  enabled: boolean
  readLibrary: () => LibraryLike | null
  logger: Logger
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  debounceMs?: number
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}

/**
 * DEV-only wiring: verify once at startup, then shadow-write after library saves in this tab
 * (`gtar-library-persisted`) or other tabs (`storage`). Single-flight and debounced; all
 * failures are logged and swallowed so the normal save path is never affected.
 */
export function installLibraryBodyShadow(options: ShadowInstallOptions): () => void {
  if (!options.enabled || !factoryOf(options)) return () => {}
  const target = options.target ?? window
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const debounceMs = options.debounceMs ?? 2000
  let timer: unknown = null
  let running: Promise<void> | null = null
  let again = false
  let disposed = false

  const run = async (verifyFirst: boolean): Promise<void> => {
    const library = (() => { try { return options.readLibrary() } catch { return null } })()
    if (!library) return
    try {
      if (verifyFirst) {
        const v = await verifyShadowBodies(library, options)
        const message = `Startup check: ${v.unique - v.missing - v.corrupt}/${v.unique} chart bodies present (${v.songs} songs); missing ${v.missing}, corrupt ${v.corrupt}`
        if (v.corrupt) options.logger.warn(TAG, message)
        else options.logger.info(TAG, message)
      }
      const r = await shadowWriteBodies(library, options)
      if (r.written) options.logger.info(TAG, `Shadow-wrote ${r.written} new chart bodies (${r.unique} unique, ${r.songs} songs)`)
    } catch (error) {
      options.logger.warn(TAG, isQuotaError(error) ? 'IndexedDB quota reached; shadow copy paused (library unaffected)' :
        'Shadow copy failed (library unaffected)', error instanceof Error ? error.message : String(error))
    }
  }
  const trigger = (verifyFirst = false) => {
    if (disposed) return
    if (running) { again = true; return }
    running = run(verifyFirst).finally(() => {
      running = null
      if (again && !disposed) { again = false; trigger() }
    })
  }
  const onPersisted = () => {
    if (timer !== null) cancel(timer)
    timer = schedule(() => { timer = null; trigger() }, debounceMs)
  }
  const onStorage = (event: Event) => { if (isLibraryStorageKey((event as StorageEvent).key)) onPersisted() }
  target.addEventListener('gtar-library-persisted', onPersisted)
  target.addEventListener('storage', onStorage)
  const startup = schedule(() => trigger(true), debounceMs)
  return () => {
    disposed = true
    cancel(startup)
    if (timer !== null) cancel(timer)
    target.removeEventListener('gtar-library-persisted', onPersisted)
    target.removeEventListener('storage', onStorage)
  }
}

export interface ShadowCleanupPlan {
  storageRaw: string
  records: BodyRecord[]
  totalBytes: number
  orphanBytes: number
  totalCount: number
}

// Protect bodies referenced anywhere in the current library or retained recovery history.
// Unknown/malformed JSON fails closed rather than guessing which bodies are disposable.
function shadowStorageRaw(storage: Storage): string {
  const sources = recoveryData(storage)
  const restore = storage.getItem(RESTORE_SNAPSHOT_KEY)
  if (restore !== null) sources[RESTORE_SNAPSHOT_KEY] = restore
  return JSON.stringify(sources)
}
async function protectedHashes(raw: string): Promise<Set<string>> {
  const hashes = new Set<string>()
  const walk = async (value: unknown): Promise<void> => {
    if (typeof value === 'string') {
      if (/^\s*[[{]/.test(value)) { try { await walk(JSON.parse(value)) } catch { throw new Error('Unreadable historical body references; export before manual recovery.') } }
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'rawContent' && typeof child === 'string') hashes.add(await bodyHash(child))
      else if (['raw', 'libraryRaw', 'legacyRaw', 'legacyV1Raw'].includes(key) && typeof child === 'string') await walk(JSON.parse(child))
      else await walk(child)
    }
  }
  for (const [key, value] of Object.entries(JSON.parse(raw))) {
    if (key === 'gtar_sync_library_owner') continue
    await walk(JSON.parse(value as string))
  }
  return hashes
}
export async function inspectShadowCleanup(storage: Storage = localStorage, options?: BodyStoreOptions): Promise<ShadowCleanupPlan> {
  if (inspectRecovery(storage).invalid) throw new Error('Invalid recovery data; shadow cleanup unavailable. Export recovery data.')
  const storageRaw = shadowStorageRaw(storage)
  const protectedSet = await protectedHashes(storageRaw)
  const db = await openBodyDatabase(options)
  try {
    const all = await new Promise<BodyRecord[]>((resolve, reject) => {
      const request = db.transaction(BODY_STORE, 'readonly').objectStore(BODY_STORE).getAll()
      request.onsuccess = () => resolve(request.result as BodyRecord[])
      request.onerror = () => reject(request.error)
    })
    const records = all.filter(record => !protectedSet.has(record.hash))
    if (shadowStorageRaw(storage) !== storageRaw) throw new Error('Recovery changed. Review shadow storage again.')
    const bytes = (records: BodyRecord[]) => records.reduce((sum, record) => sum + JSON.stringify(record).length * 2, 0)
    return { storageRaw, records, totalCount: all.length, totalBytes: bytes(all), orphanBytes: bytes(records) }
  } finally { db.close() }
}
export async function confirmShadowCleanup(plan: ShadowCleanupPlan, confirmed: boolean, blocked: () => boolean,
  storage: Storage = localStorage, options?: BodyStoreOptions): Promise<void> {
  if (!confirmed) throw new Error('Explicit shadow cleanup confirmation required.')
  if (!navigator.locks?.request) throw new Error('Safe shadow cleanup requires Web Locks support.')
  await navigator.locks.request('gtar-catalog-setlist-import', { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock || blocked()) throw new Error('Resolve editor edits or cross-tab conflicts before cleanup.')
    const fresh = await inspectShadowCleanup(storage, options)
    if (JSON.stringify(fresh) !== JSON.stringify(plan)) throw new Error('Shadow storage changed. Review again.')
    const db = await openBodyDatabase(options)
    try {
      if (blocked() || shadowStorageRaw(storage) !== plan.storageRaw) throw new Error('Library changed. Review again.')
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BODY_STORE, 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error || new Error('Shadow cleanup failed'))
        tx.onabort = () => reject(tx.error || new Error('Shadow cleanup aborted'))
        const store = tx.objectStore(BODY_STORE)
        for (const record of plan.records) {
          const request = store.get(record.hash)
          request.onsuccess = () => {
            if (!blocked() && shadowStorageRaw(storage) === plan.storageRaw && JSON.stringify(request.result) === JSON.stringify(record)) store.delete(record.hash)
          }
        }
      })
    } finally { db.close() }
  })
}
