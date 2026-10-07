/**
 * Client-side songbook metadata service client.
 * Calls the server-authoritative POST /api/songbook/metadata endpoint with current session bearer token.
 */

import { getStoredSessionStatus } from './googleAuth'
import { normalizeMusicalKey } from './musicalKey'

export interface SongMetadataResult {
  title: string
  artist: string
  originalKey: string | null
  tempo?: number | string | null
  timeSignature?: string | null
  year?: string | null
  confidence: 'high' | 'medium' | 'low'
  source: string
}

export interface SongMetadataResponse {
  success: boolean
  status: 'ok' | 'not_found' | 'ambiguous' | 'error'
  metadata?: SongMetadataResult
  error?: string
}

export async function lookupSongMetadata(params: {
  title: string
  artist?: string
  currentKey?: string
}): Promise<SongMetadataResponse> {
  const { title, artist, currentKey } = params
  if (!title || !title.trim()) {
    return {
      success: false,
      status: 'error',
      error: 'Song title is required for metadata lookup',
    }
  }

  // 1. Retrieve session bearer token from authenticated user session
  const { session } = getStoredSessionStatus()
  const token = session?.sessionToken || session?.idToken || session?.token
  if (!token) {
    return {
      success: false,
      status: 'error',
      error: 'Active account login required for metadata lookup',
    }
  }

  try {
    const res = await fetch('/api/songbook/metadata', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: title.trim(),
        artist: artist?.trim() || undefined,
        currentKey: currentKey?.trim() || undefined,
      }),
      signal: AbortSignal.timeout(10000),
    })

    const data = (await res.json()) as SongMetadataResponse
    if (!res.ok) {
      return {
        success: false,
        status: 'error',
        error: data?.error || `Server error (${res.status})`,
      }
    }

    // Strictly validate returned metadata original key
    if (data.metadata?.originalKey) {
      const validatedKey = normalizeMusicalKey(data.metadata.originalKey)
      data.metadata.originalKey = validatedKey || null
    } else if (data.metadata) {
      data.metadata.originalKey = null
    }

    return data
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'TimeoutError'
    return {
      success: false,
      status: 'error',
      error: isAbort ? 'Metadata lookup timed out' : 'Metadata lookup unavailable offline',
    }
  }
}
