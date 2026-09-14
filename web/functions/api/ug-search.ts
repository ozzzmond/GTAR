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

export async function onRequestGet(context: CloudflarePagesContext): Promise<Response> {
  const reqUrl = new URL(context.request.url)
  const q = String(reqUrl.searchParams.get('q') || '').trim()

  if (!q) {
    return new Response(JSON.stringify({ success: true, results: [] }), {
      status: 200,
      headers: JSON_HEADERS,
    })
  }

  const target = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`

  try {
    const startTime = Date.now()
    const ugRes = await fetch(target, {
      headers: UG_HEADERS,
    })
    const latencyMs = Date.now() - startTime

    if (ugRes.status !== 200) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Search HTTP ${ugRes.status}`,
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
    const rawResults =
      storeJson?.store?.page?.data?.results ||
      storeJson?.page?.data?.results ||
      storeJson?.data?.results ||
      []

    const results = rawResults
      .filter(
        (r: any) =>
          r &&
          r.song_name &&
          r.tab_url &&
          (r.type === 'Chords' || String(r.tab_url).includes('-chords-') || r.type === 'Tab')
      )
      .map((r: any, i: number) => ({
        id: r.id || `ug-${i}-${Date.now()}`,
        songName: String(r.song_name).trim(),
        artistName: String(r.artist_name || '').trim(),
        type: r.type || 'Chords',
        version: Number(r.version) || 1,
        votes: Number(r.votes) || 0,
        rating: Number(r.rating) || 0,
        tabUrl: String(r.tab_url).trim(),
        tonality: r.tonality_name || undefined,
      }))
      .sort((a: any, b: any) => (b.votes || 0) - (a.votes || 0) || (b.rating || 0) - (a.rating || 0))

    return new Response(
      JSON.stringify({
        success: true,
        query: q,
        results,
        count: results.length,
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
