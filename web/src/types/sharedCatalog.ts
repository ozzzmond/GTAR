/**
 * Shared Catalog Types & API Contracts (DEV.2 Phase 3)
 * Defines wire types, client parameters, cache models, and service states
 * for the server-authoritative GTAR Shared Catalog.
 */

export interface SharedCatalogSongItem {
  id: string
  title: string
  artist: string | null
  key: string | null
  original_key: string | null
  capo: string | null
  bpm: string | null
  time_signature: string | null
  year: string | null
  raw_content: string
  format: string
  checksum: string
  publisher_user_id: string
  publisher_name?: string | null
  publisher_display_name?: string | null
  last_editor_user_id: string
  current_revision: number
  created_at: string
  updated_at: string
}

export interface SharedCatalogPagination {
  limit: number
  offset: number
  total: number
  has_more: boolean
}

export interface CatalogListResponse {
  success: boolean
  songs: SharedCatalogSongItem[]
  pagination: SharedCatalogPagination
}

export interface CatalogSongRevisionItem {
  id: string
  song_id: string
  revision: number
  title: string
  artist: string | null
  key: string | null
  original_key: string | null
  capo: string | null
  bpm: string | null
  time_signature: string | null
  year: string | null
  raw_content: string
  format: string
  checksum: string
  editor_user_id: string
  change_summary: string | null
  created_at: string
}

export interface CatalogSongDetailResponse {
  success: boolean
  song: SharedCatalogSongItem
  revisions: CatalogSongRevisionItem[]
}

export interface CatalogApiErrorDetails {
  error: string
  code?: string
  status: number
}

export class CatalogApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'CatalogApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Account-partitioned IndexedDB cached record for a Shared Catalog song.
 */
export interface CachedCatalogSongRecord {
  /** Composite key: `${accountId}:${id}` */
  compositeKey: string
  /** Isolated authenticated user account ID (user.id or user.sub) */
  accountId: string
  /** Shared song UUID */
  id: string
  title: string
  artist: string | null
  key: string | null
  original_key: string | null
  capo: string | null
  bpm: string | null
  time_signature: string | null
  year: string | null
  raw_content: string
  format: string
  checksum: string
  publisher_user_id: string
  last_editor_user_id: string
  current_revision: number
  created_at: string
  updated_at: string
  /** Timestamp when fetched from authoritative server */
  fetchedAt: number
}

/**
 * Account-level cache metadata (last full or partial sync time, highest offset, etc.)
 */
export interface CachedCatalogMetadata {
  /** Isolated authenticated user account ID */
  accountId: string
  lastFetchedAt: number
  totalServerCount?: number
}

/**
 * Explicit Shared Catalog UI / Service State
 */
export type CatalogDataState =
  | 'LOADING'
  | 'ONLINE'
  | 'OFFLINE_CACHED'
  | 'EMPTY'
  | 'AUTH_REQUIRED'
  | 'ERROR'

export interface CatalogQueryResult {
  songs: SharedCatalogSongItem[]
  state: CatalogDataState
  isStale: boolean
  total?: number
  hasMore?: boolean
  error?: string
}
