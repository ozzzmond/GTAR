/**
 * #204 S1: debug log storage in IndexedDB instead of 30 entries in localStorage.
 * Retention: newest 20 entries, FIFO, without age expiry or a byte cap. Logs stay on this device; they are
 * never uploaded or stored in D1. No logger import here, so the logger can depend on it.
 */
import type { LogEntry } from './logger'

export const DEBUG_LOG_DB_NAME = 'gtar_debug_logs_db'
export const DEBUG_LOG_STORE = 'logs'
export const LOG_MAX_ENTRIES = 20

export interface DebugLogBackend {
  loadAll(): Promise<LogEntry[]>
  /** One transaction: store `put`, delete the ids in `remove`. */
  write(put: LogEntry[], remove: string[]): Promise<void>
}

/** Newest 20 across all levels, returned oldest first. No age or byte expiry. */
export function applyLogRetention(entries: LogEntry[]): { keep: LogEntry[]; drop: string[] } {
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const split = Math.max(0, sorted.length - LOG_MAX_ENTRIES)
  return { keep: sorted.slice(split), drop: sorted.slice(0, split).map(e => e.id) }
}

export function debugLogBackend(factory: IDBFactory | null = typeof indexedDB !== 'undefined' ? indexedDB : null): DebugLogBackend {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    if (!factory) { reject(new Error('IndexedDB is not available')); return }
    const request = factory.open(DEBUG_LOG_DB_NAME, 1)
    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(DEBUG_LOG_STORE)) db.createObjectStore(DEBUG_LOG_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open debug log database'))
    request.onblocked = () => reject(new Error('Debug log database upgrade blocked'))
  })
  return {
    async loadAll() {
      const db = await open()
      try {
        return await new Promise<LogEntry[]>((resolve, reject) => {
          const request = db.transaction(DEBUG_LOG_STORE, 'readonly').objectStore(DEBUG_LOG_STORE).getAll()
          request.onsuccess = () => resolve((request.result as LogEntry[]).filter(e => typeof e?.id === 'string' && typeof e.timestamp === 'string'))
          request.onerror = () => reject(request.error || new Error('Debug log read failed'))
        })
      } finally { db.close() }
    },
    async write(put, remove) {
      if (!put.length && !remove.length) return
      const db = await open()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(DEBUG_LOG_STORE, 'readwrite')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error || new Error('Debug log write failed'))
          tx.onabort = () => reject(tx.error || new Error('Debug log write aborted'))
          const store = tx.objectStore(DEBUG_LOG_STORE)
          for (const id of remove) store.delete(id)
          for (const entry of put) store.put(entry)
        })
      } finally { db.close() }
    },
  }
}
