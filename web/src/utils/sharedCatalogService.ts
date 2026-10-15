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
  private accountEpoch: number = 0
  private freshConfirmedIds: Set<string> = new Set()
  private catalogSongMetadataMap: Map<string, SharedCatalogSongItem> = new Map()

  /**
   * Set or switch active authenticated account identity.
   * Advances monotonic account epoch. If account identity changes, in-memory reference
   * updates and previous account's in-memory data is dropped.
   */
  public setAccount(accountId: string | null): void {
    const clean = accountId ? accountId.trim().toLowerCase() : null
    if (this.currentAccountId !== clean) {
      this.currentAccountId = clean
      this.accountEpoch++
      this.freshConfirmedIds.clear()
      this.catalogSongMetadataMap.clear()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gtar-shared-catalog-cache-updated'))
      }
    }
  }

  public getAccount(): string | null {
    return this.currentAccountId
  }

  public getAccountEpoch(): number {
    return this.accountEpoch
  }

  public advanceAccountEpoch(): number {
    this.accountEpoch++
    return this.accountEpoch
  }

  /**
   * Explicitly purge cache for an account (e.g. on logout or account revocation).
   * Advances monotonic account epoch to invalidate all in-flight requests and writes.
   * Clears in-memory state only if target account matches active account context.
   */
  public async clearAccountCache(accountId: string, options?: IDBCacheOptions): Promise<void> {
    const clean = accountId ? accountId.trim().toLowerCase() : ''
    if (!clean) return
    this.accountEpoch++
    if (this.currentAccountId === clean) {
      this.currentAccountId = null
      this.freshConfirmedIds.clear()
      this.catalogSongMetadataMap.clear()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gtar-shared-catalog-cache-updated'))
      }
    }
    try {
      await clearAccountCatalogCache(clean, options)
    } catch (err) {
      console.warn('[CatalogService] Failed to clear account catalog cache:', err)
    }
  }

  /**
   * Fetch catalog songs with automatic offline fallback and reconciliation.
   */
  public getCatalogSong(id: string): SharedCatalogSongItem | undefined {
    return this.catalogSongMetadataMap.get(id)
  }

  public getCatalogMetadataMap(): Map<string, SharedCatalogSongItem> {
    return new Map(this.catalogSongMetadataMap)
  }

  public setCatalogSongMetadata(song: SharedCatalogSongItem): void {
    if (song && song.id) {
      this.catalogSongMetadataMap.set(song.id, song)
    }
  }

  public async getCatalogSongs(
    options: CatalogServiceOptions = {}
  ): Promise<CatalogQueryResult> {
    const { limit = 20, offset = 0, signal, timeoutMs, forceOnline = false, indexedDBFactory } = options

    let accountId: string
    try {
      const auth = getAuthenticatedSessionToken()
      accountId = auth.accountId
      const cleanAuthId = accountId.trim().toLowerCase()
      if (this.currentAccountId !== cleanAuthId) {
        this.setAccount(cleanAuthId)
      }
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

    const cleanAccountId = accountId.trim().toLowerCase()
    const requestEpoch = this.accountEpoch

    // Try online fetch first if not forced offline
    let networkErrorMessage: string | undefined
    try {
      const res = await listSharedCatalogSongs({ limit, offset, signal, timeoutMs })

      // Monotonic epoch and account switch protection:
      // Drop delayed/stale responses from prior account or prior session of same account (A->B->A)
      if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
        return {
          songs: [],
          state: 'AUTH_REQUIRED',
          isStale: false,
          error: 'Account context switched during request',
        }
      }

      // Successful authoritative server response
      const serverSongs = res.songs || []

      // Reconcile into IndexedDB cache without purging unseen paginated songs:
      try {
        // 1. Save freshly fetched songs to cache (upsert)
        await saveSongsToCache(cleanAccountId, serverSongs, { indexedDBFactory })

        // 2. Validate epoch post-write: if account transitioned or logged out during async write,
        // purge written data immediately to prevent repopulating revoked/logged-out accounts.
        if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
          try {
            await clearAccountCatalogCache(cleanAccountId, { indexedDBFactory })
          } catch { /* best effort */ }
          return {
            songs: [],
            state: 'AUTH_REQUIRED',
            isStale: false,
            error: 'Account context switched during request',
          }
        }

        // 3. Full first-page reconciliation: If fetching offset=0 with limit >= total,
        // server response is comprehensive; remove server-deleted songs from cache.
        if (offset === 0 && res.pagination && (res.pagination.total <= res.songs.length || !res.pagination.has_more)) {
          const cached = await getCachedSongs(cleanAccountId, { indexedDBFactory })
          if (this.accountEpoch === requestEpoch && this.currentAccountId === cleanAccountId) {
            const serverIds = new Set(serverSongs.map((s) => s.id))
            for (const c of cached) {
              if (!serverIds.has(c.id)) {
                await removeCachedSong(cleanAccountId, c.id, { indexedDBFactory })
                this.unmarkCatalogId(c.id)
                this.catalogSongMetadataMap.delete(c.id)
              }
            }
          }
        }
      } catch (cacheErr) {
        // Cache failure must not break online catalog access
        console.warn('[CatalogService] Cache save/reconciliation degraded gracefully:', cacheErr)
      }

      // Check epoch before publishing authoritative in-memory metadata
      if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
        return {
          songs: [],
          state: 'AUTH_REQUIRED',
          isStale: false,
          error: 'Account context switched during request',
        }
      }

      for (const song of serverSongs) {
        this.markCatalogIdLiveConfirmed(song.id)
        this.catalogSongMetadataMap.set(song.id, song)
      }

      if (serverSongs.length === 0 && offset === 0 && (res.pagination ? res.pagination.total === 0 : true)) {
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
        total: res.pagination ? res.pagination.total : serverSongs.length,
        hasMore: res.pagination ? res.pagination.has_more : false,
      }
    } catch (err) {
      if (err instanceof CatalogApiError) {
        // If aborted or unauthorized, return immediately
        if (err.code === 'ABORTED') {
          throw err
        }
        if (err.status === 401 || err.status === 403) {
          // Invalidate relevant protected cache state, strictly scoped to affected account
          try {
            await clearAccountCatalogCache(cleanAccountId, { indexedDBFactory })
          } catch { /* best effort */ }

          // Only clear active account's in-memory metadata if failure belongs to current active session
          if (this.accountEpoch === requestEpoch && this.currentAccountId === cleanAccountId) {
            this.accountEpoch++
            this.freshConfirmedIds.clear()
            this.catalogSongMetadataMap.clear()
            this.currentAccountId = null
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('gtar-shared-catalog-cache-updated'))
            }
          }

          return {
            songs: [],
            state: 'AUTH_REQUIRED',
            isStale: false,
            error: err.message || (err.status === 403 ? 'Access denied' : 'Authentication required'),
          }
        }
        networkErrorMessage = err.message
      } else {
        networkErrorMessage = err instanceof Error ? err.message : 'Unknown network failure'
      }
    }

    // If online fetch failed, attempt to fall back to IndexedDB offline cache
    if (!forceOnline) {
      if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
        return {
          songs: [],
          state: 'AUTH_REQUIRED',
          isStale: false,
          error: 'Account context switched during request',
        }
      }

      const cached = await getCachedSongs(cleanAccountId, { indexedDBFactory })
      const meta = await getCachedMetadata(cleanAccountId, { indexedDBFactory })

      if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
        return {
          songs: [],
          state: 'AUTH_REQUIRED',
          isStale: false,
          error: 'Account context switched during request',
        }
      }

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
    const { signal, timeoutMs, indexedDBFactory, forceOnline = false } = options

    let accountId: string
    try {
      const auth = getAuthenticatedSessionToken()
      accountId = auth.accountId
      const cleanAuthId = accountId.trim().toLowerCase()
      if (this.currentAccountId !== cleanAuthId) {
        this.setAccount(cleanAuthId)
      }
    } catch (err) {
      return {
        song: null,
        state: 'AUTH_REQUIRED',
        isStale: false,
        error: err instanceof Error ? err.message : 'Authentication required',
      }
    }

    const cleanAccountId = accountId.trim().toLowerCase()
    const requestEpoch = this.accountEpoch

    try {
      const detail = await getSharedCatalogSong({ id, signal, timeoutMs })

      // Monotonic epoch and account switch protection
      if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
        return {
          song: null,
          state: 'AUTH_REQUIRED',
          isStale: false,
          error: 'Account context switched during request',
        }
      }

      // Upsert into cache
      try {
        await saveSongsToCache(cleanAccountId, [detail.song], { indexedDBFactory })
      } catch (cacheErr) {
        console.warn('[CatalogService] Detail cache save degraded gracefully:', cacheErr)
      }

      // Guard post-write against mid-write account transitions or logouts
      if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
        try {
          await removeCachedSong(cleanAccountId, detail.song.id, { indexedDBFactory })
        } catch { /* best effort */ }
        return {
          song: null,
          state: 'AUTH_REQUIRED',
          isStale: false,
          error: 'Account context switched during request',
        }
      }

      this.markCatalogIdLiveConfirmed(detail.song.id)
      this.catalogSongMetadataMap.set(detail.song.id, detail.song)
      return {
        song: detail.song,
        state: 'ONLINE',
        isStale: false,
      }
    } catch (err) {
      if (err instanceof CatalogApiError && err.code === 'ABORTED') {
        throw err
      }

      // HTTP 401 and HTTP 403 are authorization failures — NOT offline fallback opportunities!
      if (err instanceof CatalogApiError && (err.status === 401 || err.status === 403)) {
        // Invalidate relevant protected cache state, strictly scoped to affected account
        try {
          await clearAccountCatalogCache(cleanAccountId, { indexedDBFactory })
        } catch { /* best effort */ }

        // Only clear active account's in-memory metadata if failure belongs to current active session
        if (this.accountEpoch === requestEpoch && this.currentAccountId === cleanAccountId) {
          this.accountEpoch++
          this.freshConfirmedIds.clear()
          this.catalogSongMetadataMap.clear()
          this.currentAccountId = null
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gtar-shared-catalog-cache-updated'))
          }
        }

        return {
          song: null,
          state: 'AUTH_REQUIRED',
          isStale: false,
          error: err.message || (err.status === 403 ? 'Access denied' : 'Authentication required'),
        }
      }

      // Check if song was deleted by server (404)
      if (err instanceof CatalogApiError && err.status === 404) {
        if (this.accountEpoch === requestEpoch && this.currentAccountId === cleanAccountId) {
          this.unmarkCatalogId(id)
          this.catalogSongMetadataMap.delete(id)
        }
        await removeCachedSong(cleanAccountId, id, { indexedDBFactory })
        return {
          song: null,
          state: 'ONLINE',
          isStale: false,
          error: 'Song not found in Shared Catalog',
        }
      }

      // Try offline cache fallback
      if (!forceOnline) {
        if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
          return {
            song: null,
            state: 'AUTH_REQUIRED',
            isStale: false,
            error: 'Account context switched during request',
          }
        }

        const cached = await getCachedSongById(cleanAccountId, id, { indexedDBFactory })
        if (this.accountEpoch !== requestEpoch || !this.currentAccountId || this.currentAccountId !== cleanAccountId) {
          return {
            song: null,
            state: 'AUTH_REQUIRED',
            isStale: false,
            error: 'Account context switched during request',
          }
        }

        if (cached) {
          const isStale = Date.now() - cached.fetchedAt > CACHE_FRESHNESS_TTL_MS
          return {
            song: cached,
            state: 'OFFLINE_CACHED',
            isStale,
            error: err instanceof Error ? err.message : 'Offline cached version',
          }
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
   * Mark a newly published song as live confirmed, persist to local IDB cache,
   * and notify listening UI components.
   */
  public async markPublishedSong(
    song: SharedCatalogSongItem,
    options?: IDBCacheOptions
  ): Promise<void> {
    let accountId: string
    try {
      const auth = getAuthenticatedSessionToken()
      accountId = auth.accountId.trim().toLowerCase()
      if (this.currentAccountId !== accountId) {
        this.setAccount(accountId)
      }
    } catch {
      return
    }

    const requestEpoch = this.accountEpoch

    if (this.accountEpoch !== requestEpoch || this.currentAccountId !== accountId) {
      return
    }

    this.markCatalogIdLiveConfirmed(song.id)
    this.catalogSongMetadataMap.set(song.id, song)

    try {
      await saveSongsToCache(accountId, [song], options)
      if (this.accountEpoch !== requestEpoch || this.currentAccountId !== accountId) {
        try {
          await removeCachedSong(accountId, song.id, options)
        } catch { /* best effort */ }
        return
      }
    } catch (cacheErr) {
      console.warn('[CatalogService] Post-publish cache save degraded gracefully:', cacheErr)
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gtar-shared-catalog-cache-updated'))
    }
  }

  /**
   * Publish a song to the shared catalog and cache it locally.
   */
  public async publishSong(
    params: PublishSharedSongParams,
    options?: IDBCacheOptions
  ): Promise<SharedCatalogSongItem> {
    try {
      const auth = getAuthenticatedSessionToken()
      const cleanAuthId = auth.accountId.trim().toLowerCase()
      if (this.currentAccountId !== cleanAuthId) {
        this.setAccount(cleanAuthId)
      }
    } catch { /* proceed to call */ }

    const requestEpoch = this.accountEpoch
    const res = await publishSharedCatalogSong(params)
    const song = res.song
    if (this.accountEpoch === requestEpoch && this.currentAccountId) {
      await this.markPublishedSong(song, options)
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
    try {
      const auth = getAuthenticatedSessionToken()
      const cleanAuthId = auth.accountId.trim().toLowerCase()
      if (this.currentAccountId !== cleanAuthId) {
        this.setAccount(cleanAuthId)
      }
    } catch { /* proceed to call */ }

    const requestEpoch = this.accountEpoch
    const res = await updateSharedCatalogSong(params)
    const song = res.song
    if (this.accountEpoch === requestEpoch && this.currentAccountId) {
      await this.markPublishedSong(song, options)
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
      const cleanAccountId = auth.accountId.trim().toLowerCase()
      await removeCachedSong(cleanAccountId, params.id, options)
      if (this.currentAccountId === cleanAccountId) {
        this.unmarkCatalogId(params.id)
        this.catalogSongMetadataMap.delete(params.id)
      }
    } catch (cacheErr) {
      console.warn('[CatalogService] Post-unpublish cache removal degraded gracefully:', cacheErr)
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gtar-shared-catalog-cache-updated'))
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
      const cleanAuthId = accountId.trim().toLowerCase()
      if (this.currentAccountId !== cleanAuthId) {
        this.setAccount(cleanAuthId)
      }
    } catch {
      return 'UNCONFIRMED'
    }

    const cleanAccountId = accountId.trim().toLowerCase()
    const requestEpoch = this.accountEpoch

    try {
      const cachedSong = await getCachedSongById(cleanAccountId, cleanId, options)
      if (this.accountEpoch !== requestEpoch || this.currentAccountId !== cleanAccountId) {
        return 'UNCONFIRMED'
      }
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
   * Returns a set of confirmed active shared catalog song IDs from authoritative local cache
   * and live in-memory server confirmations.
   */
  public async getConfirmedActiveCatalogIds(options?: IDBCacheOptions): Promise<Set<string>> {
    let accountId: string
    try {
      const auth = getAuthenticatedSessionToken()
      accountId = auth.accountId
      const cleanAuthId = accountId.trim().toLowerCase()
      if (this.currentAccountId !== cleanAuthId) {
        this.setAccount(cleanAuthId)
      }
    } catch {
      this.setAccount(null)
      return new Set<string>()
    }

    const cleanAccountId = accountId.trim().toLowerCase()
    const requestEpoch = this.accountEpoch
    const result = new Set<string>(this.freshConfirmedIds)
    try {
      const cached = await getCachedSongs(cleanAccountId, options)
      if (this.accountEpoch !== requestEpoch || this.currentAccountId !== cleanAccountId) {
        return new Set<string>()
      }
      for (const s of cached) {
        result.add(s.id)
        this.catalogSongMetadataMap.set(s.id, s)
      }
      return result
    } catch {
      return result
    }
  }

  /**
   * Reconciles publication status across active catalog songs without per-song requests.
   */
  public async reconcilePublicationsBatch(
    options?: CatalogServiceOptions
  ): Promise<{ confirmedIds: Set<string>; freshIds: Set<string> }> {
    try {
      const auth = getAuthenticatedSessionToken()
      const cleanAuthId = auth.accountId.trim().toLowerCase()
      if (this.currentAccountId !== cleanAuthId) {
        this.setAccount(cleanAuthId)
      }
    } catch {
      // not authenticated
    }

    const requestEpoch = this.accountEpoch
    try {
      const res = await this.getCatalogSongs({ limit: 100, ...options })
      if (this.accountEpoch !== requestEpoch) {
        return { confirmedIds: new Set(), freshIds: new Set() }
      }
      if (res.state === 'ONLINE') {
        const fresh = this.getFreshConfirmedCatalogIds()
        const allConfirmed = await this.getConfirmedActiveCatalogIds(options)
        return { confirmedIds: allConfirmed, freshIds: fresh }
      }
    } catch {
      // Degrade gracefully
    }
    if (this.accountEpoch !== requestEpoch) {
      return { confirmedIds: new Set(), freshIds: new Set() }
    }
    const cachedConfirmed = await this.getConfirmedActiveCatalogIds(options)
    return { confirmedIds: cachedConfirmed, freshIds: this.getFreshConfirmedCatalogIds() }
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

export function getCatalogMetadataMap(): Map<string, SharedCatalogSongItem> {
  return sharedCatalogService.getCatalogMetadataMap()
}
