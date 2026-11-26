/**
 * GuitarSongs.club Core Parser, Validator & ChordPro Converter
 * Adapted from PafsChordBridge guitarsongs.py / guitarsongs_http.py into TypeScript.
 * Pure, offline-capable module with zero Python or browser-automation dependencies.
 */

export const ALLOWED_GUITARSONGS_HOSTS = [
  'guitarsongs.club',
  'en.guitarsongs.club',
  'ru2.guitarsongs.club',
  'eo.guitarsongs.club',
] as const

export const DEFAULT_GUITARSONGS_HOST = 'en.guitarsongs.club'
export const MAX_GUITARSONGS_URL_LENGTH = 2048
export const MAX_GUITARSONGS_QUERY_LENGTH = 200
export const MAX_GUITARSONGS_HTML_BYTES = 1024 * 1024 // 1 MiB

/**
 * Live automated-access permission gate for GuitarSongs.club.
 * Enabled by owner authorization for preview testing on PR #633;
 * upstream 403 / Cf-Mitigated challenges and UG_PROXY_MODE=disabled remain fail-closed.
 */
export const GUITARSONGS_LIVE_ACCESS_PERMITTED = true

export interface GuitarSongsSearchResult {
  id: string
  songName: string
  artistName: string
  type: string
  tabUrl: string
  providerId: 'guitarsongs'
  providerName: 'GuitarSongs.club'
}

export interface GuitarSongsParsedSheet {
  title: string
  artist: string
  key: string
  capo: string
  bpm: string
  format: 'CHORD_PRO'
  rawContent: string
  sourceUrl: string
}

const SONG_URL_RE = /^https:\/\/((?:(?:en|ru2|eo)\.)?guitarsongs\.club)(\/song\/([0-9]+)\/?)$/i
const SONG_HREF_RE = /^(?:https?:\/\/(?:(?:en|ru2|eo)\.)?guitarsongs\.club)?(\/song\/([0-9]+)\/?)$/i
const ARTIST_TITLE_SPLIT_RE = /\s+(?:—|–|-)\s+/
const LEADING_DOC_TITLE_RE = /^Guitar Songs Club\s*-\s*.*?—\s*[^—]+—\s*(.+)$/

const SECTION_LABEL_PATTERN =
  '(?:Intro|Verse|Pre-?chorus|Pre chorus|Post-?chorus|Chorus|Refrain|' +
  'Interlude|Bridge|Instrumental|Turnaround|Solo|Vamp|Tag|Ending|Outro|Coda)' +
  '(?: [0-9]+)?'

const BRACKET_SECTION_COLON_RE = new RegExp(`^\\s*\\[(${SECTION_LABEL_PATTERN}):\\]\\s*(.*)$`, 'i')
const BRACKET_SECTION_ONLY_RE = new RegExp(`^\\[${SECTION_LABEL_PATTERN}\\]$`, 'i')
const SECTION_FULL_RE = new RegExp(`^(?:(${SECTION_LABEL_PATTERN}):?|\\[(${SECTION_LABEL_PATTERN}):?\\])$`, 'i')
const SECTION_PREFIX_RE = new RegExp(
  `^(${SECTION_LABEL_PATTERN})(?:\\s*[:\\-]\\s*(.+)|\\s+(\\([^)]+\\)))?$`,
  'i'
)
const CHORD_SYMBOL_RE =
  /^(?:N\.C\.|[A-G][#b♯♭]?(?:maj|min|m|M|dim|aug|sus|add|omit|no|[0-9+#b°øΔ()-])*(?:\/[A-G][#b♯♭]?)?)$/

const SECTION_CANONICAL: Record<string, string> = {
  intro: 'Intro',
  verse: 'Verse',
  prechorus: 'Pre-Chorus',
  'pre-chorus': 'Pre-Chorus',
  'pre chorus': 'Pre-Chorus',
  postchorus: 'Post-Chorus',
  'post-chorus': 'Post-Chorus',
  chorus: 'Chorus',
  refrain: 'Refrain',
  interlude: 'Interlude',
  bridge: 'Bridge',
  instrumental: 'Instrumental',
  turnaround: 'Turnaround',
  solo: 'Solo',
  vamp: 'Vamp',
  tag: 'Tag',
  ending: 'Ending',
  outro: 'Outro',
  coda: 'Coda',
}

export function validateGuitarSongsQuery(raw: unknown): {
  valid: boolean
  query: string
  error?: string
} {
  const q = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!q) {
    return { valid: true, query: '' }
  }
  if (q.length > MAX_GUITARSONGS_QUERY_LENGTH) {
    return {
      valid: false,
      query: '',
      error: `Query exceeds maximum length of ${MAX_GUITARSONGS_QUERY_LENGTH} characters`,
    }
  }
  return { valid: true, query: q }
}

export function isAllowedGuitarSongsDestination(targetUrl: string): boolean {
  if (!targetUrl || targetUrl.length > MAX_GUITARSONGS_URL_LENGTH) return false
  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    const hostname = parsed.hostname.toLowerCase()
    if (!(ALLOWED_GUITARSONGS_HOSTS as readonly string[]).includes(hostname)) return false
    if (parsed.port && parsed.port !== '443') return false
    return true
  } catch {
    return false
  }
}

export function validateGuitarSongsSongUrl(raw: unknown): {
  valid: boolean
  parsedUrl?: URL
  error?: string
  status: number
} {
  const songUrl = String(raw ?? '').trim()
  if (!songUrl) {
    return { valid: false, error: 'Missing song url query parameter', status: 400 }
  }
  if (songUrl.length > MAX_GUITARSONGS_URL_LENGTH) {
    return {
      valid: false,
      error: `URL exceeds maximum length of ${MAX_GUITARSONGS_URL_LENGTH} characters`,
      status: 400,
    }
  }

  let parsed: URL
  try {
    parsed = new URL(songUrl)
  } catch {
    return { valid: false, error: 'Invalid GuitarSongs.club song URL format', status: 400 }
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Forbidden protocol: Only HTTPS target URLs are permitted',
      status: 403,
    }
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'Forbidden credentials in target URL',
      status: 403,
    }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!(ALLOWED_GUITARSONGS_HOSTS as readonly string[]).includes(hostname)) {
    return {
      valid: false,
      error: `Forbidden target host: '${hostname}'. Only GuitarSongs.club domains are permitted.`,
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

  if (!SONG_URL_RE.test(parsed.href)) {
    return {
      valid: false,
      error: 'Unsupported URL. Enter an HTTPS guitarsongs.club song URL (/song/<id>).',
      status: 400,
    }
  }

  return { valid: true, parsedUrl: parsed, status: 200 }
}

export function decodeHtmlEntities(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''
  return raw
    .replace(/&(?:quot|amp|#39|apos|lt|gt|nbsp|mdash|ndash);/gi, (match) => {
      switch (match.toLowerCase()) {
        case '&quot;': return '"'
        case '&amp;': return '&'
        case '&#39;':
        case '&apos;': return "'"
        case '&lt;': return '<'
        case '&gt;': return '>'
        case '&nbsp;': return ' '
        case '&mdash;': return '—'
        case '&ndash;': return '–'
        default: return match
      }
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _
    })
}

export function isGuitarSongsHtml(html: string): boolean {
  if (!html || typeof html !== 'string') return false
  const lower = html.toLowerCase()
  return (
    lower.includes('<tt>') &&
    (lower.includes('guitarsongs.club') ||
      lower.includes('/user/changenotation/') ||
      lower.includes('<title>guitar songs club'))
  )
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function normalizeArtistTitle(label: string): { artistName: string; songName: string } {
  const parts = label.split(ARTIST_TITLE_SPLIT_RE)
  if (parts.length >= 2) {
    const artist = parts[0].replace(/\s+/g, ' ').trim()
    const title = parts.slice(1).join(' - ').replace(/\s+/g, ' ').trim()
    if (artist && title) {
      return { artistName: artist, songName: title }
    }
  }
  return { artistName: 'Unknown', songName: label.replace(/\s+/g, ' ').trim() }
}

function scoreResult(item: GuitarSongsSearchResult, query: string): [number, number, number, number] {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return [1, 0, 0, 0]
  const qUnique = Array.from(new Set(qTokens))
  const qNorm = qTokens.join(' ')
  const titleTokens = tokenize(item.songName)
  const artistTokens = tokenize(item.artistName)
  const titleSet = new Set(titleTokens)
  const combinedSet = new Set([...titleTokens, ...artistTokens])

  let matched = 0
  for (const tok of qUnique) {
    if (combinedSet.has(tok)) matched += 1
  }
  if (matched === 0) return [0, 0, 0, 0]

  const titleNorm = titleTokens.join(' ')
  const artistNorm = artistTokens.join(' ')
  let titleMatches = 0
  for (const tok of qUnique) {
    if (titleSet.has(tok)) titleMatches += 1
  }

  let tier = 1
  if (titleNorm === qNorm) tier = 4
  else if (
    titleNorm.includes(qNorm) ||
    `${titleNorm} ${artistNorm}`.includes(qNorm) ||
    `${artistNorm} ${titleNorm}`.includes(qNorm)
  ) {
    tier = 3
  } else if (matched === qUnique.length) {
    tier = 2
  }

  return [tier, matched, titleMatches, -titleTokens.length]
}

export function parseGuitarSongsSearchHtml(
  html: string,
  options: { baseUrl?: string; query?: string } = {}
): GuitarSongsSearchResult[] {
  if (!html || typeof html !== 'string') return []
  const base = (options.baseUrl || `https://${DEFAULT_GUITARSONGS_HOST}`).replace(/\/+$/, '')
  const query = options.query ?? ''

  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi
  const seenIds = new Set<string>()
  const results: GuitarSongsSearchResult[] = []

  let match: RegExpExecArray | null
  while ((match = anchorRe.exec(html)) !== null) {
    const href = (match[1] ?? match[2] ?? '').trim()
    const hrefMatch = SONG_HREF_RE.exec(href)
    if (!hrefMatch) continue

    const songId = hrefMatch[2]
    if (seenIds.has(songId)) continue

    const rawText = match[3].replace(/<[^>]+>/g, ' ')
    const label = decodeHtmlEntities(rawText).replace(/\s+/g, ' ').trim()
    if (!label) continue

    seenIds.add(songId)
    const { artistName, songName } = normalizeArtistTitle(label)
    results.push({
      id: `guitarsongs:${songId}`,
      songName,
      artistName,
      type: 'Chords',
      tabUrl: `${base}/song/${songId}`,
      providerId: 'guitarsongs',
      providerName: 'GuitarSongs.club',
    })
  }

  if (!query.trim()) return results

  return results
    .map((item) => ({ item, score: scoreResult(item, query) }))
    .filter(({ score }) => score[0] > 0)
    .sort((a, b) => {
      for (let i = 0; i < a.score.length; i += 1) {
        if (b.score[i] !== a.score[i]) return b.score[i] - a.score[i]
      }
      return 0
    })
    .map(({ item }) => item)
}

function cleanTitle(text: string): string | null {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned || /[{}\\\0]/.test(cleaned)) return null
  return cleaned
}

function extractSongTitle(html: string): string | null {
  const h3Match = html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)
  if (h3Match) {
    const text = decodeHtmlEntities(h3Match[1].replace(/<[^>]+>/g, ' '))
    const heading = cleanTitle(text)
    if (heading) return heading
  }
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    const docTitle = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    const docMatch = LEADING_DOC_TITLE_RE.exec(docTitle)
    if (docMatch) return cleanTitle(docMatch[1])
  }
  return null
}

function extractArtist(html: string): string | null {
  const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi
  let sawArtistLabel = false
  let match: RegExpExecArray | null
  while ((match = tdRe.exec(html)) !== null) {
    const cellHtml = match[1]
    const cellText = decodeHtmlEntities(cellHtml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (cellText === 'Artist:') {
      sawArtistLabel = true
      continue
    }
    if (sawArtistLabel) {
      const linkMatch = cellHtml.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
      const candidate = linkMatch
        ? decodeHtmlEntities(linkMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
        : cellText
      if (candidate) return candidate
      sawArtistLabel = false
    }
  }
  return null
}

function sanitizeLyricLine(line: string): string {
  let sanitized = line
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\\/g, '/')
  if (sanitized.trimStart().startsWith('#')) {
    sanitized = sanitized.replace('#', '')
  }
  return sanitized
}

function sanitizeChordProDelimiters(line: string): string {
  if (BRACKET_SECTION_ONLY_RE.test(line.trim())) return line
  return sanitizeLyricLine(line)
}

function normalizeChartText(rawTt: string): string {
  const normalizedNewlines = rawTt.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines: string[] = []
  for (const rawLine of normalizedNewlines.replace(/\u00a0/g, ' ').split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    const secMatch = BRACKET_SECTION_COLON_RE.exec(line)
    if (secMatch) {
      const label = secMatch[1]
      const rest = secMatch[2].replace(/\s+$/, '')
      lines.push(`[${label}]`)
      if (rest) lines.push(sanitizeChordProDelimiters(rest))
      continue
    }
    lines.push(sanitizeChordProDelimiters(line))
  }
  return lines.join('\n')
}

function normalizeSectionLabel(raw: string): string {
  let cleaned = raw.replace(/\s+/g, ' ').trim().replace(/:+$/, '').trim()
  if (!cleaned) return cleaned
  let repeatPrefix = ''
  if (cleaned.toLowerCase().startsWith('repeat ')) {
    repeatPrefix = 'Repeat '
    cleaned = cleaned.slice(7).trim()
  }
  const match = SECTION_PREFIX_RE.exec(cleaned)
  if (!match) return `${repeatPrefix}${cleaned}`

  const baseRaw = match[1]
  const parts = baseRaw.split(/\s+/)
  let num = ''
  let nameKey = baseRaw.toLowerCase()
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
    num = ` ${parts[parts.length - 1]}`
    nameKey = parts.slice(0, -1).join(' ').toLowerCase()
  }
  const canonical = SECTION_CANONICAL[nameKey] ?? baseRaw
  const suffix = match[2] ? ` - ${match[2].trim()}` : match[3] ? ` ${match[3].trim()}` : ''
  return `${repeatPrefix}${canonical}${num}${suffix}`
}

interface ChordPos {
  symbol: string
  column: number
}

function parseChordLine(line: string): ChordPos[] | null {
  const tokens: ChordPos[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (!CHORD_SYMBOL_RE.test(m[0])) return null
    tokens.push({ symbol: m[0], column: m.index })
  }
  return tokens.length > 0 ? tokens : null
}

function renderInlineChords(lyrics: string, chords: ChordPos[]): string {
  if (chords.length === 0) return lyrics
  if (!lyrics) return chords.map((c) => `[${c.symbol}]`).join(' ')

  let out = ''
  let cursor = 0
  const trailing: string[] = []
  for (const chord of chords) {
    if (chord.column < lyrics.length) {
      out += lyrics.slice(cursor, chord.column) + `[${chord.symbol}]`
      cursor = chord.column
    } else {
      trailing.push(`[${chord.symbol}]`)
    }
  }
  out += lyrics.slice(cursor)
  if (trailing.length > 0) {
    out += '  ' + trailing.join(' ')
  }
  return out
}

function convertNormalizedTextToChordProLines(normalized: string): string[] {
  const rawLines = normalized.replace(/^\n+|\n+$/g, '').split('\n')
  const out: string[] = []
  let pending: ChordPos[] = []

  for (const line of rawLines) {
    const trimmed = line.trim()
    const sectionMatch = SECTION_FULL_RE.exec(trimmed)
    if (sectionMatch) {
      if (pending.length > 0) {
        out.push(renderInlineChords('', pending))
        pending = []
      }
      const label = normalizeSectionLabel(sectionMatch[1] ?? sectionMatch[2] ?? trimmed)
      out.push(`{comment: Repeat ${label}}`)
      continue
    }

    if (!trimmed) {
      if (pending.length > 0) {
        out.push(renderInlineChords('', pending))
        pending = []
      }
      continue
    }

    const chords = parseChordLine(line)
    if (chords) {
      if (pending.length > 0) {
        out.push(renderInlineChords('', pending))
      }
      pending = chords
      continue
    }

    if (pending.length > 0) {
      out.push(renderInlineChords(line, pending))
      pending = []
    } else {
      out.push(line)
    }
  }

  if (pending.length > 0) {
    out.push(renderInlineChords('', pending))
  }
  return out
}

function extractTtText(ttInnerHtml: string): string {
  let out = ''
  let i = 0
  while (i < ttInnerHtml.length) {
    const lt = ttInnerHtml.indexOf('<', i)
    if (lt === -1) {
      out += ttInnerHtml.slice(i).replace(/[\r\n]/g, '')
      break
    }
    if (lt > i) {
      out += ttInnerHtml.slice(i, lt).replace(/[\r\n]/g, '')
    }
    let j = lt + 1
    let quote: string | null = null
    while (j < ttInnerHtml.length) {
      const ch = ttInnerHtml[j]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        j += 1
        break
      }
      j += 1
    }
    const tagContent = ttInnerHtml.slice(lt + 1, j - (ttInnerHtml[j - 1] === '>' ? 1 : 0)).trim()
    if (/^br(?:\s|\/|$)/i.test(tagContent)) {
      out += '\n'
    }
    i = j
  }
  return out
}

export function parseGuitarSongsTabSheet(
  html: string,
  sourceUrl: string
): {
  success: boolean
  sheet?: GuitarSongsParsedSheet
  error?: string
  status: number
} {
  if (!html || typeof html !== 'string') {
    return { success: false, error: 'Empty GuitarSongs.club response', status: 502 }
  }

  const ttMatch = html.match(/<tt\b[^>]*>([\s\S]*?)<\/tt>/i)
  if (!ttMatch) {
    return { success: false, error: 'Unrecognized GuitarSongs.club chart HTML', status: 422 }
  }

  const title = extractSongTitle(html)
  if (!title) {
    return { success: false, error: 'Missing GuitarSongs.club song title', status: 422 }
  }

  const artist = extractArtist(html) ?? ''
  const rawTtWithBreaks = extractTtText(ttMatch[1])
  const decodedTt = decodeHtmlEntities(rawTtWithBreaks)
  const normalized = normalizeChartText(decodedTt)
  const bodyLines = convertNormalizedTextToChordProLines(normalized)

  if (bodyLines.length === 0) {
    return { success: false, error: 'No chord sheet text in GuitarSongs.club page', status: 404 }
  }

  const directives = [`{title: ${title}}`]
  if (artist) directives.push(`{artist: ${artist}}`)
  const rawContent = [...directives, '', ...bodyLines].join('\n')

  return {
    success: true,
    sheet: {
      title,
      artist,
      key: '',
      capo: '',
      bpm: '',
      format: 'CHORD_PRO',
      rawContent,
      sourceUrl,
    },
    status: 200,
  }
}
