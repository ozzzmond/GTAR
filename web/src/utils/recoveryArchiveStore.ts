/**
 * #167 B1c: recovery archives (`gtar_sync_recovery:*`) in IndexedDB instead of localStorage.
 *
 * A merge safety snapshot holds full local and cloud copies (about 1 MB for a ~150-song library),
 * so a few syncs filled the 3 MiB localStorage retention cap. Archives now live in IndexedDB with
 * an in-memory mirror so every existing synchronous reader (recovery review, export, notices)
 * keeps working. Writes resolve only after an IndexedDB readback matches. Existing localStorage
 * archives are copied, verified and only then removed from localStorage. Nothing here decides
 * which archives may be discarded: cleanup still requires the explicit, confirmed review.
 * This module has no syncJournal import so syncJournal can depend on it.
 */
export const ARCHIVE_DB_NAME = 'gtar_recovery_archives_db'
export const ARCHIVE_STORE = 'archives'
export const ARCHIVE_PREFIX = 'gtar_sync_recovery:'
/** IndexedDB limits. Origin quota is gigabytes; these keep growth reviewable, not tight. */
export const IDB_RECOVERY_MAX_COUNT = 64
export const IDB_RECOVERY_MAX_BYTES = 200 * 1024 * 1024

export interface ArchiveRecord { key: string; raw: string; storedAt: number }
export interface RecoveryArchiveBackend {
  loadAll(): Promise<Map<string, string>>
  /** Resolves after the record is durable and reads back identical. */
  put(key: string, raw: string): Promise<void>
  /** Removes only when the stored bytes still equal `expectedRaw`; resolves whether it removed. */
  remove(key: string, expectedRaw: string): Promise<boolean>
}

const mirror = new Map<string, string>()
let backend: RecoveryArchiveBackend | null = null
let ready = false
let channel: BroadcastChannel | null = null

/** True once archives are loaded from IndexedDB; until then (or without IndexedDB) localStorage is used. */
export function recoveryArchivesInIndexedDb(): boolean { return ready && backend !== null }
export function recoveryArchiveEntries(): Array<[string, string]> { return [...mirror] }
export function recoveryArchiveGet(key: string): string | null { return mirror.get(key) ?? null }

function announce(message: { type: 'put' | 'remove'; key: string; raw?: string }) {
  try { channel?.postMessage(message) } catch { /* other tabs refresh on reload */ }
}

export async function putRecoveryArchive(key: string, raw: string): Promise<void> {
  if (!backend || !ready) throw new Error('Recovery archive storage unavailable')
  await backend.put(key, raw)
  mirror.set(key, raw)
  announce({ type: 'put', key, raw })
}

export async function removeRecoveryArchive(key: string, expectedRaw: string): Promise<boolean> {
  if (!backend || !ready) throw new Error('Recovery archive storage unavailable')
  const removed = await backend.remove(key, expectedRaw)
  if (removed) { mirror.delete(key); announce({ type: 'remove', key }) }
  return removed
}

export interface ArchivePreparation { indexedDb: boolean; migrated: number; failed: number }
/**
 * Startup: load archives from IndexedDB, then move any localStorage archives over (copy, verify,
 * remove from localStorage only if its value is unchanged). Any failure leaves localStorage as is.
 */
export async function prepareRecoveryArchives(next: RecoveryArchiveBackend, storage: Storage,
  log?: (level: 'info' | 'warn', message: string) => void): Promise<ArchivePreparation> {
  backend = next
  mirror.clear()
  for (const [key, raw] of await next.loadAll()) mirror.set(key, raw)
  ready = true
  if (typeof BroadcastChannel !== 'undefined' && !channel) {
    channel = new BroadcastChannel('gtar-recovery-archives')
    channel.onmessage = event => {
      const message = event.data as { type?: string; key?: string; raw?: string }
      if (typeof message?.key !== 'string' || !message.key.startsWith(ARCHIVE_PREFIX)) return
      if (message.type === 'put' && typeof message.raw === 'string') mirror.set(message.key, message.raw)
      else if (message.type === 'remove') mirror.delete(message.key)
      try { if (typeof window !== 'undefined') window.dispatchEvent(new window.Event('gtar-recovery-changed')) } catch { /* ignore */ }
    }
  }
  let migrated = 0, failed = 0
  const legacy: Array<[string, string]> = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(ARCHIVE_PREFIX)) legacy.push([key, storage.getItem(key) ?? ''])
  }
  for (const [key, raw] of legacy) {
    try {
      const existing = mirror.get(key)
      if (existing !== undefined && existing !== raw) { failed++; continue } // never overwrite a different archive
      if (existing === undefined) { await next.put(key, raw); mirror.set(key, raw) }
      if (storage.getItem(key) === raw) storage.removeItem(key)
      migrated++
    } catch { failed++ }
  }
  if (migrated || failed) log?.(failed ? 'warn' : 'info', `Recovery archives moved to IndexedDB: ${migrated}${failed ? `, kept in localStorage: ${failed}` : ''}`)
  return { indexedDb: true, migrated, failed }
}

/** Test/diagnostic reset. */
export function resetRecoveryArchives(): void {
  mirror.clear(); backend = null; ready = false
  try { channel?.close() } catch { /* ignore */ }
  channel = null
}

/** IndexedDB backend. `factory` is injectable for tests. */
export function recoveryArchiveBackend(factory: IDBFactory | null = typeof indexedDB !== 'undefined' ? indexedDB : null, now: () => number = Date.now): RecoveryArchiveBackend {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    if (!factory) { reject(new Error('IndexedDB is not available')); return }
    const request = factory.open(ARCHIVE_DB_NAME, 1)
    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(ARCHIVE_STORE)) db.createObjectStore(ARCHIVE_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open recovery archive database'))
    request.onblocked = () => reject(new Error('Recovery archive database upgrade blocked'))
  })
  const get = (db: IDBDatabase, key: string) => new Promise<ArchiveRecord | undefined>((resolve, reject) => {
    const request = db.transaction(ARCHIVE_STORE, 'readonly').objectStore(ARCHIVE_STORE).get(key)
    request.onsuccess = () => resolve(request.result as ArchiveRecord | undefined)
    request.onerror = () => reject(request.error || new Error('Recovery archive read failed'))
  })
  const write = (db: IDBDatabase, fn: (store: IDBObjectStore) => void) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ARCHIVE_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('Recovery archive write failed'))
    tx.onabort = () => reject(tx.error || new Error('Recovery archive write aborted'))
    fn(tx.objectStore(ARCHIVE_STORE))
  })
  return {
    async loadAll() {
      const db = await open()
      try {
        const all = await new Promise<ArchiveRecord[]>((resolve, reject) => {
          const request = db.transaction(ARCHIVE_STORE, 'readonly').objectStore(ARCHIVE_STORE).getAll()
          request.onsuccess = () => resolve(request.result as ArchiveRecord[])
          request.onerror = () => reject(request.error || new Error('Recovery archive read failed'))
        })
        return new Map(all.filter(r => typeof r?.key === 'string' && typeof r.raw === 'string').map(r => [r.key, r.raw]))
      } finally { db.close() }
    },
    async put(key, raw) {
      const db = await open()
      try {
        const existing = await get(db, key)
        if (existing && existing.raw !== raw) throw new Error('Recovery archive key already holds different data')
        if (!existing) await write(db, store => store.put({ key, raw, storedAt: now() } satisfies ArchiveRecord))
        if ((await get(db, key))?.raw !== raw) throw new Error('Recovery archive write could not be verified')
      } finally { db.close() }
    },
    async remove(key, expectedRaw) {
      const db = await open()
      try {
        const existing = await get(db, key)
        if (!existing || existing.raw !== expectedRaw) return false
        await write(db, store => store.delete(key))
        return (await get(db, key)) === undefined
      } finally { db.close() }
    },
  }
}
