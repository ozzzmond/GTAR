import { parseSearchResults, validateSearchQuery } from '../../src/utils/ugCore.ts'

interface CloudflarePagesContext {
  request: Request
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
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
}

export async function onRequestGet(context: CloudflarePagesContext): Promise<Response> {
  const reqUrl = new URL(context.request.url)
  const validation = validateSearchQuery(reqUrl.searchParams.get('q'))

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

  const target = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(validation.query)}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const ugRes = await fetch(target, {
      headers: UG_HEADERS,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    // Idiosyncratic UG behavior: UG returns HTTP 404 when a search yields 0 matches.
    // Map upstream 404 to an empty result array with HTTP 200.
    if (ugRes.status === 404) {
      return new Response(JSON.stringify({ success: true, results: [] }), {
        status: 200,
        headers: JSON_HEADERS,
      })
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

    const html = await ugRes.text()
    const results = parseSearchResults(html)

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
  } catch (err: any) {
    const isTimeout =
      err?.name === 'AbortError' ||
      err?.name === 'TimeoutError' ||
      err?.message?.includes('aborted')

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

    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || 'Internal proxy error',
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
