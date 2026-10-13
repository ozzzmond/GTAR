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
  publishSharedCatalogSong,
  updateSharedCatalogSong,
  unpublishSharedCatalogSong,
  type PublishSharedSongParams,
  type UpdateSharedSongParams,
  type UnpublishSharedSongParams,
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

export type PublicationFreshnessStatus = 'FRESH_CONFIRMED' | 'STALE_CACHED' | 'UNCONFIRMED'

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
  private freshConfirmedIds: Set<string> = new Set()

  /**
   * Set or switch active authenticated account identity.
   * If account identity changes, in-memory reference updates and previous account's
   * in-memory data is dropped.
   */
  public setAccount(accountId: string | null) {
    const clean = accountId ? accountId.trim().toLowerCase() : null
    if (this.currentAccountId !== clean) {
      this.currentAccountId = clean
      this.freshConfirmedIds.clear()
    }
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
        // Reconcile: delete from cache and fresh live confirmations
        this.unmarkCatalogId(id)
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

  /**
   * Publish a song to the shared catalog and cache it locally.
   */
  public async publishSong(
    params: PublishSharedSongParams,
    options?: IDBCacheOptions
  ): Promise<SharedCatalogSongItem> {
    const res = await publishSharedCatalogSong(params)
    const song = res.song
    this.markCatalogIdLiveConfirmed(song.id)
    try {
      const auth = getAuthenticatedSessionToken()
      await saveSongsToCache(auth.accountId, [song], options)
    } catch (cacheErr) {
      console.warn('[CatalogService] Post-publish cache save degraded gracefully:', cacheErr)
    }
    return song
  }

  /**
   * Update a song in the shared catalog (CAS revision update) and update local cache.
   */
  public async updateSong(
    params: UpdateSharedSongParams,
    options?: IDBCacheOptions
  ): Promise<SharedCatalogSongItem> {
    const res = await updateSharedCatalogSong(params)
    const song = res.song
    this.markCatalogIdLiveConfirmed(song.id)
    try {
      const auth = getAuthenticatedSessionToken()
      await saveSongsToCache(auth.accountId, [song], options)
    } catch (cacheErr) {
      console.warn('[CatalogService] Post-update cache save degraded gracefully:', cacheErr)
    }
    return song
  }

  /**
   * Unpublish / soft delete a song from the shared catalog and remove from local cache.
   */
  public async unpublishSong(
    params: UnpublishSharedSongParams,
    options?: IDBCacheOptions
  ): Promise<{ success: boolean; message: string; id: string }> {
    const res = await unpublishSharedCatalogSong(params)
    try {
      const auth = getAuthenticatedSessionToken()
      await removeCachedSong(auth.accountId, params.id, options)
      this.unmarkCatalogId(params.id)
    } catch (cacheErr) {
      console.warn('[CatalogService] Post-unpublish cache removal degraded gracefully:', cacheErr)
    }
    return res
  }

  /**
   * Mark a catalog song ID as authoritatively confirmed by live server response.
   */
  public markCatalogIdLiveConfirmed(catalogId: string): void {
    if (catalogId && catalogId.trim()) {
      this.freshConfirmedIds.add(catalogId.trim())
    }
  }

  /**
   * Unmark a catalog song ID from confirmed state (e.g. after unpublish or server 404).
   */
  public unmarkCatalogId(catalogId: string): void {
    if (catalogId && catalogId.trim()) {
      this.freshConfirmedIds.delete(catalogId.trim())
    }
  }

  /**
   * Returns fresh server-confirmed IDs accumulated during current session or fresh list fetch.
   */
  public getFreshConfirmedCatalogIds(): Set<string> {
    return new Set(this.freshConfirmedIds)
  }

  /**
   * Check publication freshness status for a given catalog song ID.
   * - FRESH_CONFIRMED: exact ID has authoritative live server confirmation within fresh TTL
   * - STALE_CACHED: exact ID exists in cached records but lacks fresh live server confirmation
   * - UNCONFIRMED: exact ID is missing from both live confirmations and cache
   */
  public async getPublicationStatus(
    catalogId: string,
    options?: IDBCacheOptions
  ): Promise<PublicationFreshnessStatus> {
    if (!catalogId || !catalogId.trim()) return 'UNCONFIRMED'
    const cleanId = catalogId.trim()

    // 1. Check live in-memory confirmation first
    if (this.freshConfirmedIds.has(cleanId)) {
      return 'FRESH_CONFIRMED'
    }

    // 2. Check cached records
    let accountId: string
    try {
      const auth = getAuthenticatedSessionToken()
      accountId = auth.accountId
    } catch {
      return 'UNCONFIRMED'
    }

    try {
      const cachedSong = await getCachedSongById(accountId, cleanId, options)
      if (cachedSong) {
        const isFresh = Date.now() - cachedSong.fetchedAt < CACHE_FRESHNESS_TTL_MS
        if (isFresh) {
          this.freshConfirmedIds.add(cleanId)
          return 'FRESH_CONFIRMED'
        }
        return 'STALE_CACHED'
      }
    } catch {
      // Degrade gracefully
    }

    return 'UNCONFIRMED'
  }

  /**
   * Returns a set of confirmed active shared catalog song IDs from authoritative local cache.
   */
  public async getConfirmedActiveCatalogIds(options?: IDBCacheOptions): Promise<Set<string>> {
    let accountId: string
    try {
      const auth = getAuthenticatedSessionToken()
      accountId = auth.accountId
      this.currentAccountId = accountId
    } catch {
      return new Set<string>()
    }
    try {
      const cached = await getCachedSongs(accountId, options)
      return new Set(cached.map((s) => s.id))
    } catch {
      return new Set<string>()
    }
  }

  /**
   * Reconciles publication status for a personal song against authoritative catalog records.
   */
  public async reconcileConfirmedPublication(
    catalogSongId: string,
    options?: CatalogServiceOptions
  ): Promise<boolean> {
    if (!catalogSongId || !catalogSongId.trim()) return false
    try {
      const details = await this.getSongDetails(catalogSongId.trim(), options)
      if (details.song !== null && details.state === 'ONLINE') {
        this.markCatalogIdLiveConfirmed(catalogSongId.trim())
      }
      return details.song !== null
    } catch {
      return false
    }
  }
}

export const sharedCatalogService = new SharedCatalogService()

export async function getConfirmedActiveCatalogIds(options?: IDBCacheOptions): Promise<Set<string>> {
  return sharedCatalogService.getConfirmedActiveCatalogIds(options)
}

export async function getPublicationStatus(
  catalogId: string,
  options?: IDBCacheOptions
): Promise<PublicationFreshnessStatus> {
  return sharedCatalogService.getPublicationStatus(catalogId, options)
}
