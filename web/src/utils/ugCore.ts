/**
 * Ultimate Guitar Core Parser & Validation Utilities
 * Shared contract logic for Cloudflare Pages Functions, Vite Dev Middleware, and Test Suites.
 */

export const ALLOWED_UG_HOSTS = ['tabs.ultimate-guitar.com', 'www.ultimate-guitar.com']
export const MAX_URL_LENGTH = 2048
export const MAX_QUERY_LENGTH = 500
export const CLAMP_QUERY_LENGTH = 200

export interface UgSearchResult {
  id: number | string
  songName: string
  artistName: string
  type: string
  version: number
  votes: number
  rating: number
  tabUrl: string
  tonality?: string
}

export interface UgParsedSheet {
  title: string
  artist: string
  key: string
  capo: string
  bpm: string
  format: 'CHORD_PRO' | 'TWO_LINE'
  rawContent: string
  sourceUrl: string
}

export function validateSearchQuery(raw: unknown): {
  valid: boolean
  query: string
  error?: string
} {
  const q = String(raw || '').trim()
  if (!q) {
    return { valid: true, query: '' }
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return {
      valid: false,
      query: '',
      error: `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`,
    }
  }
  return { valid: true, query: q.slice(0, CLAMP_QUERY_LENGTH).trim() }
}

export function validateTabUrl(raw: unknown): {
  valid: boolean
  parsedUrl?: URL
  error?: string
  status: number
} {
  const tabUrl = String(raw || '').trim()
  if (!tabUrl) {
    return { valid: false, error: 'Missing tab url query parameter', status: 400 }
  }

  if (tabUrl.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters`,
      status: 400,
    }
  }

  let parsed: URL
  try {
    parsed = new URL(tabUrl)
  } catch {
    return { valid: false, error: 'Invalid tab URL format', status: 400 }
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Forbidden protocol: Only HTTPS target URLs are permitted',
      status: 403,
    }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!ALLOWED_UG_HOSTS.includes(hostname)) {
    return {
      valid: false,
      error: `Forbidden target host: '${hostname}'. Only Ultimate Guitar domains are permitted.`,
      status: 403,
    }
  }

  if (parsed.port && parsed.port !== '443') {
    return {
      valid: false,
      error: 'Forbidden non-standard port: Only standard HTTPS (443) is permitted',
      status: 403,
    }
  }

  return { valid: true, parsedUrl: parsed, status: 200 }
}

export function extractJsStore(html: string): Record<string, any> | null {
  if (!html || typeof html !== 'string') return null

  // 1. Check data-content="..." or data-content='...' in js-store
  const quoteMatch = html.match(/data-content=(["'])/i)
  if (quoteMatch && quoteMatch.index !== undefined) {
    const quote = quoteMatch[1]
    const startIdx = quoteMatch.index + quoteMatch[0].length
    const endIdx = html.indexOf(quote + '>', startIdx)
    const effectiveEnd = endIdx !== -1 ? endIdx : html.indexOf(quote, startIdx)
    if (effectiveEnd !== -1) {
      const rawStr = html.substring(startIdx, effectiveEnd)
      const jsonStr = rawStr
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

  // 3. Fallback: store JSON object
  const storeMatch = html.match(/"store"\s*:\s*(\{[\s\S]*?\})\s*,\s*"type"/i)
  if (storeMatch && storeMatch[1]) {
    try {
      return JSON.parse(storeMatch[1])
    } catch {
      // fallback
    }
  }

  return null
}

export function sanitizeUgMarkup(content: string): string {
  if (!content) return ''
  return content
    .replace(/\[ch\](.*?)\[\/ch\]/gi, '$1')
    .replace(/\[\/?tab\]/gi, '')
    .trim()
}

interface RawUgResult {
  id?: number | string
  song_name?: string
  artist_name?: string
  type?: string
  version?: number | string
  votes?: number | string
  rating?: number | string
  tab_url?: string
  tonality_name?: string
}

export function parseSearchResults(html: string): UgSearchResult[] {
  const storeJson = extractJsStore(html)
  const rawResults: unknown =
    storeJson?.store?.page?.data?.results ||
    storeJson?.page?.data?.results ||
    storeJson?.data?.results ||
    []

  if (!Array.isArray(rawResults)) return []

  return (rawResults as RawUgResult[])
    .filter(
      (r): r is RawUgResult & { song_name: string; tab_url: string } =>
        Boolean(
          r &&
          r.song_name &&
          r.tab_url &&
          (r.type === 'Chords' || String(r.tab_url).includes('-chords-') || r.type === 'Tab')
        )
    )
    .map((r, i: number) => ({
      id: r.id || `ug-${i}-${Date.now()}`,
      songName: String(r.song_name || '').trim(),
      artistName: String(r.artist_name || '').trim(),
      type: String(r.type || 'Chords'),
      version: Number(r.version) || 1,
      votes: Number(r.votes) || 0,
      rating: Number(r.rating) || 0,
      tabUrl: String(r.tab_url || '').trim(),
      tonality: r.tonality_name ? String(r.tonality_name) : undefined,
    }))
    .sort((a, b) => (b.votes || 0) - (a.votes || 0) || (b.rating || 0) - (a.rating || 0))
}

export function parseTabSheet(
  html: string,
  sourceUrl: string
): {
  success: boolean
  sheet?: UgParsedSheet
  error?: string
  status: number
} {
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

  if (!rawContent || !rawContent.trim()) {
    return {
      success: false,
      error: 'No chord sheet text in tab data',
      status: 404,
    }
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

  const sheet: UgParsedSheet = {
    title,
    artist,
    key,
    capo: capoStr,
    bpm: '120',
    format: cleanContent.includes('[') && cleanContent.includes(']') ? 'CHORD_PRO' : 'TWO_LINE',
    rawContent: formatted,
    sourceUrl,
  }

  return {
    success: true,
    sheet,
    status: 200,
  }
}
