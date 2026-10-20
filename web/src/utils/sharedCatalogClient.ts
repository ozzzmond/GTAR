/**
 * Client-Side Shared Catalog HTTP Client (DEV.2 Phase 3)
 * Provides typed, authenticated access to the server-authoritative Shared Catalog API.
 * Handles timeouts, network failure detection, signal cancellation, and structured error responses.
 */

import {
  type CatalogListResponse,
  type CatalogSongDetailResponse,
  type SharedCatalogSongItem,
  type CatalogSongRevisionItem,
  CatalogApiError,
} from '../types/sharedCatalog'
import { getStoredSessionStatus } from './googleAuth'

export const DEFAULT_CATALOG_TIMEOUT_MS = 15000
export const DEFAULT_PAGE_LIMIT = 20
export const MAX_PAGE_LIMIT = 50

export interface FetchCatalogListParams {
  limit?: number
  offset?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export interface FetchCatalogSongParams {
  id: string
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Extracts bearer token and accountId from authenticated session.
 * Throws structured CatalogApiError(401) if not authenticated.
 */
export function getAuthenticatedSessionToken(): { token: string; accountId: string } {
  const { session, isExpired } = getStoredSessionStatus()
  if (!session || isExpired) {
    throw new CatalogApiError('Authentication required to access Shared Catalog', 401, 'AUTH_REQUIRED')
  }

  const token = session.sessionToken || session.idToken || session.token
  if (!token) {
    throw new CatalogApiError('Authentication session token is missing', 401, 'AUTH_TOKEN_MISSING')
  }

  const accountId = (session.user.id || session.user.sub || session.user.email || '').trim().toLowerCase()
  if (!accountId) {
    throw new CatalogApiError('Authenticated user identifier cannot be resolved', 401, 'ACCOUNT_ID_UNRESOLVED')
  }

  return { token, accountId }
}

/**
 * Internal helper to perform typed fetch requests with timeout and cancellation.
 */
export async function catalogFetch<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    token: string
    body?: unknown
    signal?: AbortSignal
    timeoutMs?: number
    idempotencyKey?: string
  }
): Promise<T> {
  const { method = 'GET', token, body: requestBody, signal, timeoutMs = DEFAULT_CATALOG_TIMEOUT_MS } = options

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new Error(`Shared Catalog network request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  }

  const handleExternalAbort = () => {
    controller.abort(signal?.reason || new Error('Request aborted by caller'))
  }

  if (signal) {
    if (signal.aborted) {
      if (timer) clearTimeout(timer)
      throw signal.reason || new Error('Request aborted by caller')
    }
    signal.addEventListener('abort', handleExternalAbort, { once: true })
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
    if (requestBody !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      method,
      cache: 'no-store',
      headers,
      body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
      signal: controller.signal,
    })

    let body: unknown
    const contentType = (response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : '') || ''
    if (contentType.includes('application/json')) {
      try {
        body = await response.json()
      } catch {
        body = null
      }
    }

    if (!response.ok) {
      let code: string | undefined = undefined
      let errorMsg = `HTTP ${response.status} ${response.statusText}`

      if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>
        if (typeof obj.message === 'string') {
          errorMsg = obj.message
        } else if (typeof obj.error === 'string') {
          errorMsg = obj.error
        } else if (obj.error && typeof obj.error === 'object' && typeof (obj.error as Record<string, unknown>).message === 'string') {
          errorMsg = (obj.error as Record<string, unknown>).message as string
        }

        if (typeof obj.code === 'string') {
          code = obj.code
        } else if (obj.error === 'REVISION_CONFLICT' || response.status === 409) {
          code = 'CONFLICT'
        }
      } else if (response.status === 409) {
        code = 'CONFLICT'
      }

      throw new CatalogApiError(errorMsg, response.status, code)
    }

    return body as T
  } catch (err: unknown) {
    if (err instanceof CatalogApiError) {
      throw err
    }

    // Check for abort or timeout
    const isTimedOut =
      (controller.signal.aborted && (!signal || !signal.aborted)) ||
      String(err).includes("timed out")
    const isAbort =
      isTimedOut ||
      (signal && signal.aborted) ||
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")

    if (isAbort) {
      throw new CatalogApiError(
        isTimedOut ? `Request timed out after ${timeoutMs}ms` : "Request was cancelled",
        isTimedOut ? 408 : 499,
        isTimedOut ? "NETWORK_TIMEOUT" : "ABORTED"
      )
    }

    // Offline or network error
    throw new CatalogApiError(
      err instanceof Error ? err.message : 'Network error connecting to Shared Catalog',
      0,
      'NETWORK_ERROR'
    )
  } finally {
    if (timer) clearTimeout(timer)
    if (signal) {
      signal.removeEventListener('abort', handleExternalAbort)
    }
  }
}

/**
 * List songs from the shared catalog with bounded pagination.
 */
export async function listSharedCatalogSongs(
  params: FetchCatalogListParams = {}
): Promise<CatalogListResponse> {
  const { limit = DEFAULT_PAGE_LIMIT, offset = 0, signal, timeoutMs } = params
  const boundedLimit = Math.max(1, Math.min(limit, MAX_PAGE_LIMIT))
  const boundedOffset = Math.max(0, offset)

  const { token } = getAuthenticatedSessionToken()
  const query = new URLSearchParams({
    limit: String(boundedLimit),
    offset: String(boundedOffset),
  })

  return catalogFetch<CatalogListResponse>(`/api/catalog/songs?${query.toString()}`, {
    method: 'GET',
    token,
    signal,
    timeoutMs,
  })
}

/**
 * Retrieve an individual shared catalog song by ID with revision history.
 */
export async function getSharedCatalogSong(
  params: FetchCatalogSongParams
): Promise<{ song: SharedCatalogSongItem; revisions: CatalogSongRevisionItem[] }> {
  const { id, signal, timeoutMs } = params
  if (!id || !id.trim()) {
    throw new CatalogApiError('Shared song ID is required', 400, 'INVALID_ID')
  }

  const { token } = getAuthenticatedSessionToken()
  const res = await catalogFetch<CatalogSongDetailResponse>(`/api/catalog/songs/${encodeURIComponent(id.trim())}`, {
    method: 'GET',
    token,
    signal,
    timeoutMs,
  })

  return {
    song: res.song,
    revisions: res.revisions || [],
  }
}

export interface PublishSharedSongParams {
  title: string
  artist?: string | null
  key?: string | null
  original_key?: string | null
  capo?: string | null
  bpm?: string | null
  time_signature?: string | null
  year?: string | null
  raw_content: string
  format?: string
  change_summary?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface PublishSharedSongResponse {
  success: boolean
  song: SharedCatalogSongItem
  deduplicated?: boolean
}

/**
 * Publish a new song to the Shared Catalog (POST /api/catalog/songs).
 */
export async function publishSharedCatalogSong(
  params: PublishSharedSongParams
): Promise<PublishSharedSongResponse> {
  const { signal, timeoutMs, ...payload } = params
  if (!payload.title || !payload.title.trim()) {
    throw new CatalogApiError('Title is required', 400, 'INVALID_INPUT')
  }
  if (!payload.raw_content || !payload.raw_content.trim()) {
    throw new CatalogApiError('Song content is required', 400, 'INVALID_INPUT')
  }

  const { token } = getAuthenticatedSessionToken()
  return catalogFetch<PublishSharedSongResponse>('/api/catalog/songs', {
    method: 'POST',
    token,
    body: payload,
    signal,
    timeoutMs,
  })
}

export interface UpdateSharedSongParams extends PublishSharedSongParams {
  id: string
  expected_revision: number
}

/**
 * Update an existing song in the Shared Catalog with CAS (PUT /api/catalog/songs/:id).
 */
export async function updateSharedCatalogSong(
  params: UpdateSharedSongParams
): Promise<{ success: boolean; song: SharedCatalogSongItem }> {
  const { id, expected_revision, signal, timeoutMs, ...payload } = params
  if (!id || !id.trim()) {
    throw new CatalogApiError('Song ID is required', 400, 'INVALID_ID')
  }
  if (!expected_revision || expected_revision < 1) {
    throw new CatalogApiError('expected_revision is required', 400, 'INVALID_REVISION')
  }

  const { token } = getAuthenticatedSessionToken()
  return catalogFetch<{ success: boolean; song: SharedCatalogSongItem }>(
    `/api/catalog/songs/${encodeURIComponent(id.trim())}`,
    {
      method: 'PUT',
      token,
      body: {
        ...payload,
        expected_revision,
      },
      signal,
      timeoutMs,
    }
  )
}

export interface UnpublishSharedSongParams {
  id: string
  expected_revision?: number
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Soft delete/unpublish a song from the Shared Catalog (DELETE /api/catalog/songs/:id).
 */
export async function unpublishSharedCatalogSong(
  params: UnpublishSharedSongParams
): Promise<{ success: boolean; message: string; id: string }> {
  const { id, expected_revision, signal, timeoutMs } = params
  if (!id || !id.trim()) {
    throw new CatalogApiError('Song ID is required', 400, 'INVALID_ID')
  }

  const { token } = getAuthenticatedSessionToken()
  const url = expected_revision
    ? `/api/catalog/songs/${encodeURIComponent(id.trim())}?expected_revision=${encodeURIComponent(expected_revision)}`
    : `/api/catalog/songs/${encodeURIComponent(id.trim())}`

  return catalogFetch<{ success: boolean; message: string; id: string }>(url, {
    method: 'DELETE',
    token,
    signal,
    timeoutMs,
  })
}
