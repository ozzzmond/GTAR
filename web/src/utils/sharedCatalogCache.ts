/**
 * IndexedDB Cache Adapter for Shared Catalog (DEV.2 Phase 3)
 * Provides robust offline storage partitioned by authenticated account identity.
 * Handles database schema creation, version upgrades, quota errors, and account clearance.
 */

import type {
  CachedCatalogSongRecord,
  CachedCatalogMetadata,
  SharedCatalogSongItem,
} from '../types/sharedCatalog'
import { isQuotaError } from './syncJournal'

export const CATALOG_DB_NAME = 'gtar_shared_catalog_db'
export const CATALOG_DB_VERSION = 1

export const STORE_SONGS = 'catalog_songs'
export const STORE_METADATA = 'catalog_meta'

export interface IDBCacheOptions {
  indexedDBFactory?: IDBFactory
}

function getIDBFactory(options?: IDBCacheOptions): IDBFactory | null {
  if (options?.indexedDBFactory) return options.indexedDBFactory
  if (typeof indexedDB !== 'undefined') return indexedDB
  return null
}

/**
 * Open or upgrade the Shared Catalog IndexedDB instance.
 */
export async function openCatalogDatabase(options?: IDBCacheOptions): Promise<IDBDatabase> {
  const factory = getIDBFactory(options)
  if (!factory) {
    throw new Error('IndexedDB is not available in the current environment')
  }

  return new Promise((resolve, reject) => {
    const request = factory.open(CATALOG_DB_NAME, CATALOG_DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Store 1: songs store partitioned by compositeKey (`${accountId}:${id}`)
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        const songStore = db.createObjectStore(STORE_SONGS, { keyPath: 'compositeKey' })
        songStore.createIndex('by_account', 'accountId', { unique: false })
        songStore.createIndex('by_account_id', ['accountId', 'id'], { unique: true })
        songStore.createIndex('by_account_fetched', ['accountId', 'fetchedAt'], { unique: false })
      }

      // Store 2: metadata store partitioned by accountId
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA, { keyPath: 'accountId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open catalog database'))
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by open connection'))
  })
}

/**
 * Generate composite primary key for account isolation.
 */
export function buildCompositeKey(accountId: string, songId: string): string {
  return `${accountId.trim().toLowerCase()}::${songId.trim()}`
}

/**
 * Cache an array of authoritative songs for an authenticated account.
 */
export async function saveSongsToCache(
  accountId: string,
  songs: SharedCatalogSongItem[],
  options?: IDBCacheOptions
): Promise<void> {
  if (!accountId || !accountId.trim()) {
    throw new Error('Cannot cache catalog songs without an authenticated account identity')
  }
  const cleanAccountId = accountId.trim().toLowerCase()
  if (songs.length === 0) return

  let db: IDBDatabase | null = null
  try {
    db = await openCatalogDatabase(options)
  } catch (err) {
    // If IndexedDB unavailable or blocked, degrade gracefully
    console.warn('[CatalogCache] Failed to open database for writing:', err)
    return
  }

  const fetchedAt = Date.now()

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE_SONGS, STORE_METADATA], 'readwrite')
      const songStore = tx.objectStore(STORE_SONGS)
      const metaStore = tx.objectStore(STORE_METADATA)

      for (const song of songs) {
        const record: CachedCatalogSongRecord = {
          ...song,
          compositeKey: buildCompositeKey(cleanAccountId, song.id),
          accountId: cleanAccountId,
          fetchedAt,
        }
        songStore.put(record)
      }

      // Update account sync timestamp
      const meta: CachedCatalogMetadata = {
        accountId: cleanAccountId,
        lastFetchedAt: fetchedAt,
      }
      metaStore.put(meta)

      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        const error = tx.error
        db.close()
        if (isQuotaError(error)) {
          console.warn('[CatalogCache] IndexedDB quota exceeded while saving songs:', error)
          resolve() // Degrade gracefully on quota failure
        } else {
          reject(error || new Error('Failed to save songs to IndexedDB cache'))
        }
      }
      tx.onabort = () => {
        db.close()
        resolve()
      }
    } catch (err) {
      db.close()
      if (isQuotaError(err)) {
        console.warn('[CatalogCache] IndexedDB quota exceeded:', err)
        resolve()
      } else {
        reject(err)
      }
    }
  })
}

/**
 * Retrieve all cached songs for an authenticated account.
 */
export async function getCachedSongs(
  accountId: string,
  options?: IDBCacheOptions
): Promise<CachedCatalogSongRecord[]> {
  if (!accountId || !accountId.trim()) return []
  const cleanAccountId = accountId.trim().toLowerCase()

  let db: IDBDatabase | null = null
  try {
    db = await openCatalogDatabase(options)
  } catch (err) {
    console.warn('[CatalogCache] Failed to open database for reading:', err)
    return []
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SONGS, 'readonly')
      const store = tx.objectStore(STORE_SONGS)
      const index = store.index('by_account')
      const request = index.getAll(IDBKeyRange.only(cleanAccountId))

      request.onsuccess = () => {
        db.close()
        resolve(request.result || [])
      }
      request.onerror = () => {
        db.close()
        resolve([])
      }
    } catch {
      db.close()
      resolve([])
    }
  })
}

/**
 * Retrieve a single cached song by ID for an authenticated account.
 */
export async function getCachedSongById(
  accountId: string,
  songId: string,
  options?: IDBCacheOptions
): Promise<CachedCatalogSongRecord | null> {
  if (!accountId || !songId) return null
  const cleanAccountId = accountId.trim().toLowerCase()
  const compositeKey = buildCompositeKey(cleanAccountId, songId)

  let db: IDBDatabase | null = null
  try {
    db = await openCatalogDatabase(options)
  } catch {
    return null
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SONGS, 'readonly')
      const store = tx.objectStore(STORE_SONGS)
      const request = store.get(compositeKey)

      request.onsuccess = () => {
        db.close()
        resolve(request.result || null)
      }
      request.onerror = () => {
        db.close()
        resolve(null)
      }
    } catch {
      db.close()
      resolve(null)
    }
  })
}

/**
 * Retrieve account cache metadata (e.g. lastFetchedAt).
 */
export async function getCachedMetadata(
  accountId: string,
  options?: IDBCacheOptions
): Promise<CachedCatalogMetadata | null> {
  if (!accountId || !accountId.trim()) return null
  const cleanAccountId = accountId.trim().toLowerCase()

  let db: IDBDatabase | null = null
  try {
    db = await openCatalogDatabase(options)
  } catch {
    return null
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_METADATA, 'readonly')
      const store = tx.objectStore(STORE_METADATA)
      const request = store.get(cleanAccountId)

      request.onsuccess = () => {
        db.close()
        resolve(request.result || null)
      }
      request.onerror = () => {
        db.close()
        resolve(null)
      }
    } catch {
      db.close()
      resolve(null)
    }
  })
}

/**
 * Delete a specific cached song for an authenticated account (e.g., when server indicates it is deleted).
 */
export async function removeCachedSong(
  accountId: string,
  songId: string,
  options?: IDBCacheOptions
): Promise<void> {
  if (!accountId || !songId) return
  const cleanAccountId = accountId.trim().toLowerCase()
  const compositeKey = buildCompositeKey(cleanAccountId, songId)

  let db: IDBDatabase | null = null
  try {
    db = await openCatalogDatabase(options)
  } catch {
    return
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SONGS, 'readwrite')
      const store = tx.objectStore(STORE_SONGS)
      store.delete(compositeKey)

      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        resolve()
      }
    } catch {
      db.close()
      resolve()
    }
  })
}

/**
 * Delete all cached catalog records for a specific authenticated account (e.g. on logout or account switch).
 */
export async function clearAccountCatalogCache(
  accountId: string,
  options?: IDBCacheOptions
): Promise<void> {
  if (!accountId || !accountId.trim()) return
  const cleanAccountId = accountId.trim().toLowerCase()

  let db: IDBDatabase | null = null
  try {
    db = await openCatalogDatabase(options)
  } catch {
    return
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_SONGS, STORE_METADATA], 'readwrite')
      const songStore = tx.objectStore(STORE_SONGS)
      const metaStore = tx.objectStore(STORE_METADATA)

      const index = songStore.index('by_account')
      const request = index.getAllKeys(IDBKeyRange.only(cleanAccountId))

      request.onsuccess = () => {
        const keys = request.result || []
        for (const key of keys) {
          songStore.delete(key)
        }
        metaStore.delete(cleanAccountId)
      }

      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        resolve()
      }
    } catch {
      db.close()
      resolve()
    }
  })
}
