import { enforceAbuseLimit } from '../lib/abuseProtection.ts'
import { fetchUg } from '../ugFetch.ts'
import { parseTabSheet, validateTabUrl } from '../../src/utils/ugCore.ts'
import {
  authenticateUserRequest,
  JSON_HEADERS as BASE_JSON_HEADERS,
  type AuthEnv,
} from '../lib/authCore.ts'

interface CloudflarePagesContext {
  request: Request
  env: AuthEnv
}

const UG_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Referer: 'https://www.ultimate-guitar.com/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
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
  const auth = await authenticateUserRequest(context.request, context.env)
  if ('error' in auth) {
    return new Response(JSON.stringify({ success: false, error: auth.error }), {
      status: auth.status,
      headers: JSON_HEADERS,
    })
  }

  const reqUrl = new URL(context.request.url)
  const validation = validateTabUrl(reqUrl.searchParams.get('url'))

  if (!validation.valid || !validation.parsedUrl) {
    return new Response(JSON.stringify({ success: false, error: validation.error }), {
      status: validation.status,
      headers: JSON_HEADERS,
    })
  }

  const rejection = await enforceAbuseLimit(context.env, 'ug-fetch', auth.user.id)
  if (rejection) return rejection

  try {
    const ugRes = await fetchUg(validation.parsedUrl.toString(), UG_HEADERS)

    if (ugRes.status === 404) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Tab not found on Ultimate Guitar',
        }),
        {
          status: 404,
          headers: JSON_HEADERS,
        }
      )
    }

    if (ugRes.status === 403) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Ultimate Guitar access restricted by WAF',
        }),
        {
          status: 403,
          headers: JSON_HEADERS,
        }
      )
    }

    if (ugRes.status === 429) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Rate limit exceeded on Ultimate Guitar',
        }),
        {
          status: 429,
          headers: JSON_HEADERS,
        }
      )
    }

    if (ugRes.status !== 200) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Upstream error from Ultimate Guitar (HTTP ${ugRes.status})`,
        }),
        {
          status: 502,
          headers: JSON_HEADERS,
        }
      )
    }

    const html = ugRes.html
    const parseResult = parseTabSheet(html, validation.parsedUrl.toString())

    if (!parseResult.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: parseResult.error,
        }),
        {
          status: parseResult.status,
          headers: JSON_HEADERS,
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        sheet: parseResult.sheet,
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
          error: 'Gateway timeout contacting Ultimate Guitar',
        }),
        {
          status: 504,
          headers: JSON_HEADERS,
        }
      )
    }

    if (error?.message?.includes('size limit')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Ultimate Guitar response body exceeds size limit',
        }),
        {
          status: 502,
          headers: JSON_HEADERS,
        }
      )
    }

    console.error('UG tab proxy error:', error?.name || 'UnknownError')

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to fetch chord sheet from Ultimate Guitar',
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
