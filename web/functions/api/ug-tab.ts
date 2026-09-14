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

const ALLOWED_HOSTS = ['tabs.ultimate-guitar.com', 'www.ultimate-guitar.com']

function extractJsStore(html: string): any {
  // 1. Check data-content="..." in js-store
  const marker = 'data-content="'
  const idx = html.indexOf(marker)
  if (idx !== -1) {
    const end = html.indexOf('">', idx + marker.length)
    if (end !== -1) {
      const jsonStr = html
        .substring(idx + marker.length, end)
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
      try {
        return JSON.parse(jsonStr)
      } catch {
        // fallback
      }
    }
  }

  // 2. Check window.UGAPP
  const ugappMatch = html.match(/window\.UGAPP\s*=\s*(\{[\s\S]*?\});/i)
  if (ugappMatch && ugappMatch[1]) {
    try {
      return JSON.parse(ugappMatch[1])
    } catch {
      // fallback
    }
  }

  return null
}

function sanitizeUgMarkup(content: string): string {
  return content
    .replace(/\[ch\](.*?)\[\/ch\]/gi, '$1')
    .replace(/\[\/?tab\]/gi, '')
    .trim()
}

export async function onRequestGet(context: CloudflarePagesContext): Promise<Response> {
  const reqUrl = new URL(context.request.url)
  const tabUrl = String(reqUrl.searchParams.get('url') || '').trim()

  if (!tabUrl) {
    return new Response(
      JSON.stringify({ success: false, error: 'Missing tab url query parameter' }),
      {
        status: 400,
        headers: JSON_HEADERS,
      }
    )
  }

  // Strict Target Hostname & Protocol Validation (SSRF Prevention)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(tabUrl)
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid tab URL format' }),
      {
        status: 400,
        headers: JSON_HEADERS,
      }
    )
  }

  if (parsedUrl.protocol !== 'https:') {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden protocol: Only HTTPS target URLs are permitted',
      }),
      {
        status: 403,
        headers: JSON_HEADERS,
      }
    )
  }

  const hostname = parsedUrl.hostname.toLowerCase()
  if (!ALLOWED_HOSTS.includes(hostname)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Forbidden target host: '${hostname}'. Only Ultimate Guitar domains are permitted.`,
      }),
      {
        status: 403,
        headers: JSON_HEADERS,
      }
    )
  }

  try {
    const startTime = Date.now()
    const ugRes = await fetch(parsedUrl.toString(), {
      headers: UG_HEADERS,
    })
    const latencyMs = Date.now() - startTime

    if (ugRes.status !== 200) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Tab fetch HTTP ${ugRes.status}`,
          status: ugRes.status,
          latencyMs,
        }),
        {
          status: ugRes.status === 403 ? 403 : ugRes.status === 429 ? 429 : 502,
          headers: JSON_HEADERS,
        }
      )
    }

    const html = await ugRes.text()
    const storeJson = extractJsStore(html)
    const tabData = storeJson?.store?.page?.data || storeJson?.page?.data || storeJson?.data
    const wikiTab = tabData?.tab_view?.wiki_tab || tabData?.tab
    let rawContent = wikiTab?.content || ''

    if (!rawContent) {
      const contentMatch = html.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      if (contentMatch && contentMatch[1]) {
        try {
          rawContent = JSON.parse(`"${contentMatch[1]}"`)
        } catch {
          rawContent = contentMatch[1].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\"/g, '"')
        }
      }
    }

    if (!rawContent) {
      const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
      if (preMatch && preMatch[1]) {
        rawContent = preMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
      }
    }

    if (!rawContent) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No chord sheet text in tab data',
          latencyMs,
          payloadSize: html.length,
        }),
        {
          status: 404,
          headers: JSON_HEADERS,
        }
      )
    }

    const cleanContent = sanitizeUgMarkup(rawContent)
    const title = tabData?.tab?.song_name || 'Unknown'
    const artist = tabData?.tab?.artist_name || ''
    const key = tabData?.tab_view?.meta?.tonality || tabData?.tab?.tonality_name || 'G'
    const capoNum = tabData?.tab_view?.meta?.capo || tabData?.tab?.capo || 0
    const capoStr = capoNum > 0 ? `Capo ${capoNum}` : 'No Capo'

    const formatted = `{title: ${title}}
{artist: ${artist}}
{key: ${key}}
{capo: ${capoStr}}
{tempo: 120}

${cleanContent}`

    const sheet = {
      title,
      artist,
      key,
      capo: capoStr,
      bpm: '120',
      format:
        cleanContent.includes('[') && cleanContent.includes(']')
          ? 'CHORD_PRO'
          : 'TWO_LINE',
      rawContent: formatted,
      sourceUrl: parsedUrl.toString(),
    }

    return new Response(
      JSON.stringify({
        success: true,
        sheet,
        latencyMs,
        payloadSize: html.length,
      }),
      {
        status: 200,
        headers: JSON_HEADERS,
      }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Unknown fetch error',
      }),
      {
        status: 500,
        headers: JSON_HEADERS,
      }
    )
  }
}

export async function onRequest(context: CloudflarePagesContext): Promise<Response> {
  return onRequestGet(context)
}
