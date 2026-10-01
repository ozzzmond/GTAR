/**
 * GTAR Server-Side Song Metadata Proxy (Cloudflare Pages Function)
 * Proxies queries to GetSongBPM Web API (api.getsong.co)
 * Security: Uses server-side secret GETSONGBPM_API_KEY. Never exposed in client bundle.
 */

import { cleanSearchTitle, cleanSearchArtist, extractEarliestYear } from '../../src/utils/songMetadata.ts'

interface Env {
  GETSONGBPM_API_KEY?: string
}

interface CloudflarePagesContext {
  request: Request
  env: Env
}

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: JSON_HEADERS,
  })
}

export async function onRequestGet(context: CloudflarePagesContext): Promise<Response> {
  const apiKey = context.env?.GETSONGBPM_API_KEY
  if (!apiKey || !apiKey.trim()) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'GetSongBPM API key is not configured on server (GETSONGBPM_API_KEY). Please configure this Cloudflare environment secret.',
      }),
      {
        status: 503,
        headers: JSON_HEADERS,
      }
    )
  }

  const reqUrl = new URL(context.request.url)
  const rawTitle = reqUrl.searchParams.get('title') || reqUrl.searchParams.get('q') || ''
  const rawArtist = reqUrl.searchParams.get('artist') || ''

  const title = cleanSearchTitle(rawTitle)
  const artist = cleanSearchArtist(rawArtist)

  if (!title) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Missing required search parameter: title',
      }),
      {
        status: 400,
        headers: JSON_HEADERS,
      }
    )
  }

  // Construct query to GetSongBPM API
  // Target: https://api.getsong.co/search/
  let searchType = 'song'
  let lookup = title

  if (artist) {
    searchType = 'both'
    lookup = `song:${title} artist:${artist}`
  }

  const upstreamUrl = new URL('https://api.getsong.co/search/')
  upstreamUrl.searchParams.set('api_key', apiKey.trim())
  upstreamUrl.searchParams.set('type', searchType)
  upstreamUrl.searchParams.set('lookup', lookup)
  upstreamUrl.searchParams.set('limit', '10')

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const upstreamRes = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GTAR-Songbook/1.0',
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (upstreamRes.status === 401 || upstreamRes.status === 403) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'GetSongBPM access restricted or API key invalid. Please verify GETSONGBPM_API_KEY and backlink attribution.',
        }),
        {
          status: 403,
          headers: JSON_HEADERS,
        }
      )
    }

    if (upstreamRes.status === 429) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Rate limit exceeded on GetSongBPM (3,000 req/hr limit). Please try again later.',
        }),
        {
          status: 429,
          headers: JSON_HEADERS,
        }
      )
    }

    if (upstreamRes.status === 404) {
      return new Response(
        JSON.stringify({
          success: true,
          results: [],
        }),
        {
          status: 200,
          headers: JSON_HEADERS,
        }
      )
    }

    if (!upstreamRes.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Upstream error from GetSongBPM (HTTP ${upstreamRes.status})`,
        }),
        {
          status: 502,
          headers: JSON_HEADERS,
        }
      )
    }

    const data = await upstreamRes.json() as Record<string, unknown>
    // GetSongBPM returns { search: [ ... ] } or { error: ... }
    const rawList = Array.isArray(data.search) ? data.search : []

    const results = rawList.map((item: Record<string, unknown>) => {
      const id = String(item.id || '')
      const candTitle = String(item.title || item.name || '')

      let candArtist = ''
      if (typeof item.artist === 'string') {
        candArtist = item.artist
      } else if (item.artist && typeof item.artist === 'object') {
        candArtist = String((item.artist as { name?: unknown }).name || '')
      }

      const tempo = item.tempo !== undefined && item.tempo !== null ? String(item.tempo).trim() : undefined
      const keyOf = item.key_of !== undefined && item.key_of !== null ? String(item.key_of).trim() : undefined
      const earliestYear = extractEarliestYear(item.album, item.year)
      const uri = typeof item.uri === 'string' ? item.uri : undefined

      return {
        id,
        title: candTitle,
        artist: candArtist,
        originalKey: keyOf,
        bpm: tempo,
        year: earliestYear,
        sourceUrl: uri,
      }
    })

    return new Response(
      JSON.stringify({
        success: true,
        results,
      }),
      {
        status: 200,
        headers: JSON_HEADERS,
      }
    )
  } catch (err: unknown) {
    const error = err instanceof Error ? err : null
    const isTimeout =
      error?.name === 'AbortError' ||
      error?.name === 'TimeoutError' ||
      error?.message?.includes('aborted')

    if (isTimeout) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Gateway timeout contacting GetSongBPM service',
        }),
        {
          status: 504,
          headers: JSON_HEADERS,
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Internal proxy error contacting GetSongBPM',
      }),
      {
        status: 502,
        headers: JSON_HEADERS,
      }
    )
  }
}

export async function onRequest(context: CloudflarePagesContext): Promise<Response> {
  return onRequestGet(context)
}
