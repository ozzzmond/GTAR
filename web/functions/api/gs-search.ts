import { ugGate, type UgEnv } from '../ugGate.ts'
import { fetchGuitarSongs } from '../gsFetch.ts'
import {
  DEFAULT_GUITARSONGS_HOST,
  GUITARSONGS_LIVE_ACCESS_PERMITTED,
  parseGuitarSongsSearchHtml,
  validateGuitarSongsQuery,
} from '../../src/utils/guitarSongsCore.ts'
import { JSON_HEADERS as BASE_JSON_HEADERS } from '../lib/authCore.ts'

interface CloudflarePagesContext {
  request: Request
  env: UgEnv
}

const GS_HEADERS = {
  Accept: 'text/html',
}

const JSON_HEADERS = {
  ...BASE_JSON_HEADERS,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: JSON_HEADERS,
  })
}

export async function onRequestGet(context: CloudflarePagesContext): Promise<Response> {
  const gated = await ugGate(context.env)
  if (gated) return gated

  if (!GUITARSONGS_LIVE_ACCESS_PERMITTED) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'GUITARSONGS_LIVE_ACCESS_DISABLED',
      }),
      {
        status: 503,
        headers: JSON_HEADERS,
      }
    )
  }

  const reqUrl = new URL(context.request.url)
  const validation = validateGuitarSongsQuery(reqUrl.searchParams.get('q'))

  if (!validation.valid) {
    return new Response(JSON.stringify({ success: false, error: validation.error }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  if (!validation.query) {
    return new Response(JSON.stringify({ success: true, results: [] }), {
      status: 200,
      headers: JSON_HEADERS,
    })
  }

  const target = `https://${DEFAULT_GUITARSONGS_HOST}/search?q=${encodeURIComponent(validation.query)}`

  try {
    const gsRes = await fetchGuitarSongs(target, GS_HEADERS)

    if (gsRes.status === 403) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'GuitarSongs.club restricted automated retrieval',
        }),
        {
          status: 403,
          headers: JSON_HEADERS,
        }
      )
    }

    if (gsRes.status === 429) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Rate limit exceeded on GuitarSongs.club',
        }),
        {
          status: 429,
          headers: JSON_HEADERS,
        }
      )
    }

    if (gsRes.status !== 200) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Upstream error from GuitarSongs.club (HTTP ${gsRes.status})`,
        }),
        {
          status: 502,
          headers: JSON_HEADERS,
        }
      )
    }

    const results = parseGuitarSongsSearchHtml(gsRes.html, {
      baseUrl: `https://${DEFAULT_GUITARSONGS_HOST}`,
      query: validation.query,
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
          error: 'Gateway timeout contacting GuitarSongs.club',
        }),
        {
          status: 504,
          headers: JSON_HEADERS,
        }
      )
    }

    if (error?.message?.includes('size limit') || error?.message?.includes('did not return HTML')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message,
        }),
        {
          status: 502,
          headers: JSON_HEADERS,
        }
      )
    }

    console.error('GuitarSongs search proxy error:', error?.name || 'UnknownError')

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to search GuitarSongs.club',
      }),
      {
        status: 502,
        headers: JSON_HEADERS,
      }
    )
  }
}

export async function onRequest(context: CloudflarePagesContext): Promise<Response> {
  if (context.request.method === 'OPTIONS') {
    return onRequestOptions()
  }
  if (context.request.method !== 'GET') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method Not Allowed' }),
      {
        status: 405,
        headers: {
          ...JSON_HEADERS,
          Allow: 'GET, OPTIONS',
        },
      }
    )
  }
  return onRequestGet(context)
}
