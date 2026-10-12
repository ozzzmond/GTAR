/**
 * Shared Catalog Offline Service & Reconciliation (DEV.2 Phase 3)
 * Orchestrates online fetching, IndexedDB caching, account isolation,
 * offline browsing, tombstone reconciliation, and stale cache labeling.
 */

import type {
  SharedCatalogSongItem,
  CatalogQueryResult,
  CatalogDataState,
} from '../types/sharedCatalog'
import { CatalogApiError } from '../types/sharedCatalog'
import {
  listSharedCatalogSongs,
  getSharedCatalogSong,
  getAuthenticatedSessionToken,
} from './sharedCatalogClient'
import {
  saveSongsToCache,
  getCachedSongs,
  getCachedSongById,
  getCachedMetadata,
  removeCachedSong,
  clearAccountCatalogCache,
  type IDBCacheOptions,
} from './sharedCatalogCache'

export const CACHE_FRESHNESS_TTL_MS = 5 * 60 * 1000 // 5 minutes considered fresh; older is stale-labeled

export interface CatalogServiceOptions extends IDBCacheOptions {
  limit?: number
  offset?: number
  signal?: AbortSignal
  timeoutMs?: number
  forceOnline?: boolean
}

/**
 * Service to browse and reconcile Shared Catalog with account-isolated cache.
 */
export class SharedCatalogService {
  private currentAccountId: string | null = null

  /**
   * Set or switch active authenticated account identity.
   * If account identity changes, in-memory reference updates and previous account's
   * in-memory data is dropped.
   */
  public setAccount(accountId: string | null) {
    this.currentAccountId = accountId ? accountId.trim().toLowerCase() : null
  }

  public getAccount(): string | null {
    return this.currentAccountId
  }

  /**
   * Explicitly purge cache for an account (e.g. on logout or account revocation).
   */
  public async clearAccountCache(accountId: string, options?: IDBCacheOptions): Promise<void> {
    await clearAccountCatalogCache(accountId, options)
    if (this.currentAccountId === accountId.trim().toLowerCase()) {
      this.currentAccountId = null
    }
  }

  /**
   * Fetch catalog songs with automatic offline fallback and reconciliation.
   */
  public async getCatalogSongs(
    options: CatalogServiceOptions = {}
  ): Promise<CatalogQueryResult> {
    const { limit = 20, offset = 0, signal, timeoutMs, forceOnline = false, indexedDBFactory } = options

    let accountId: string
    try {
      const auth = getAuthenticatedSessionToken()
      accountId = auth.accountId
      this.currentAccountId = accountId
    } catch (err) {
      if (err instanceof CatalogApiError && err.status === 401) {
        return {
          songs: [],
          state: 'AUTH_REQUIRED',
          isStale: false,
          error: err.message,
        }
      }
      return {
        songs: [],
        state: 'AUTH_REQUIRED',
        isStale: false,
        error: 'Authentication required',
      }
    }

    // Try online fetch first if not forced offline
    let networkErrorMessage: string | undefined
    try {
      const res = await listSharedCatalogSongs({ limit, offset, signal, timeoutMs })

      // Successful authoritative server response
      const serverSongs = res.songs || []

      // Reconcile into IndexedDB cache without purging unseen paginated songs:
      try {
        // 1. Save freshly fetched songs to cache (upsert)
        await saveSongsToCache(accountId, serverSongs, { indexedDBFactory })

        // 2. Full first-page reconciliation: If fetching offset=0 with limit >= total,
        // server response is comprehensive; remove server-deleted songs from cache.
        if (offset === 0 && (res.pagination.total <= res.songs.length || !res.pagination.has_more)) {
          const cached = await getCachedSongs(accountId, { indexedDBFactory })
          const serverIds = new Set(serverSongs.map((s) => s.id))
          for (const c of cached) {
            if (!serverIds.has(c.id)) {
              await removeCachedSong(accountId, c.id, { indexedDBFactory })
            }
          }
        }
      } catch (cacheErr) {
        // Cache failure must not break online catalog access
        console.warn("[CatalogService] Cache save/reconciliation degraded gracefully:", cacheErr)
      }

      if (serverSongs.length === 0 && offset === 0 && res.pagination.total === 0) {
        return {
          songs: [],
          state: 'EMPTY',
          isStale: false,
          total: 0,
          hasMore: false,
        }
      }

      return {
        songs: serverSongs,
        state: 'ONLINE',
        isStale: false,
        total: res.pagination.total,
        hasMore: res.pagination.has_more,
      }
    } catch (err) {
      if (err instanceof CatalogApiError) {
        // If aborted or unauthorized, return immediately
        if (err.code === 'ABORTED') {
          throw err
        }
        if (err.status === 401) {
          return {
            songs: [],
            state: 'AUTH_REQUIRED',
            isStale: false,
            error: err.message,
          }
        }
        networkErrorMessage = err.message
      } else {
        networkErrorMessage = err instanceof Error ? err.message : 'Unknown network failure'
      }
    }

    // If online fetch failed, attempt to fall back to IndexedDB offline cache
    if (!forceOnline) {
      const cached = await getCachedSongs(accountId, { indexedDBFactory })
      const meta = await getCachedMetadata(accountId, { indexedDBFactory })

      if (cached.length > 0) {
        // Sort cached songs deterministically by title, artist, id
        const sorted = [...cached].sort((a, b) =>
          a.title.localeCompare(b.title) || (a.artist || '').localeCompare(b.artist || '') || a.id.localeCompare(b.id)
        )

        // Paginate local cache if requested
        const paginatedCached = sorted.slice(offset, offset + limit)
        const isStale = meta ? Date.now() - meta.lastFetchedAt > CACHE_FRESHNESS_TTL_MS : true

        return {
          songs: paginatedCached,
          state: 'OFFLINE_CACHED',
          isStale,
          total: cached.length,
          hasMore: offset + paginatedCached.length < cached.length,
          error: networkErrorMessage,
        }
      }
    }

    // No cache available and network failed
    return {
      songs: [],
      state: 'ERROR',
      isStale: false,
      error: networkErrorMessage || 'Failed to load Shared Catalog',
    }
  }

  /**
   * Retrieve a single shared song by ID, falling back to cache if offline.
   */
  public async getSongDetails(
    id: string,
    options: CatalogServiceOptions = {}
  ): Promise<{ song: SharedCatalogSongItem | null; state: CatalogDataState; isStale: boolean; error?: string }> {
    const { signal, timeoutMs, indexedDBFactory } = options

    let accountId: string
    try {
      const auth = getAuthenticatedSessionToken()
      accountId = auth.accountId
      this.currentAccountId = accountId
    } catch (err) {
      return {
        song: null,
        state: 'AUTH_REQUIRED',
        isStale: false,
        error: err instanceof Error ? err.message : 'Authentication required',
      }
    }

    try {
      const detail = await getSharedCatalogSong({ id, signal, timeoutMs })
      // Upsert into cache
      await saveSongsToCache(accountId, [detail.song], { indexedDBFactory })
      return {
        song: detail.song,
        state: 'ONLINE',
        isStale: false,
      }
    } catch (err) {
      if (err instanceof CatalogApiError && err.code === 'ABORTED') {
        throw err
      }

      // Check if song was deleted by server (404)
      if (err instanceof CatalogApiError && err.status === 404) {
        // Reconcile: delete from cache
        await removeCachedSong(accountId, id, { indexedDBFactory })
        return {
          song: null,
          state: 'ONLINE',
          isStale: false,
          error: 'Song not found in Shared Catalog',
        }
      }

      // Try offline cache fallback
      const cached = await getCachedSongById(accountId, id, { indexedDBFactory })
      if (cached) {
        const isStale = Date.now() - cached.fetchedAt > CACHE_FRESHNESS_TTL_MS
        return {
          song: cached,
          state: 'OFFLINE_CACHED',
          isStale,
          error: err instanceof Error ? err.message : 'Offline cached version',
        }
      }

      return {
        song: null,
        state: 'ERROR',
        isStale: false,
        error: err instanceof Error ? err.message : 'Failed to retrieve song',
      }
    }
  }
}

export const sharedCatalogService = new SharedCatalogService()
