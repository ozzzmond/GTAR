/**
 * GTAR Song Metadata Engine (GetSongBPM Integration)
 * On-demand manual lookup for song title, artist, original recording key, BPM, and year.
 * Security: Uses server-side /api/metadata-lookup function. Zero client API key exposure.
 */

import { canonicalSongKey } from './musicalKey'

export type MetadataMatchStatus = 'MATCH' | 'REVIEW' | 'NO_MATCH' | 'ERROR'

export interface MetadataCandidate {
  id: string
  title: string
  artist: string
  originalKey?: string
  bpm?: string
  year?: string
  sourceUrl?: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface SongMetadataReviewItem {
  songId?: string | number
  storedTitle: string
  storedArtist: string
  currentChartKey: string
  currentOriginalKey: string
  currentBpm: string
  currentYear: string
  status: MetadataMatchStatus
  candidates: MetadataCandidate[]
  selectedCandidateIndex: number
  selectedFields: {
    title: boolean
    artist: boolean
    originalKey: boolean
    bpm: boolean
    year: boolean
  }
  isSelected: boolean
  error?: string
}

/**
 * Non-destructive search query normalization for legacy song titles.
 * Strips bracketed/parenthesized keys, capo annotations, copy numbers, and audio tags
 * without modifying or renaming the stored title in the songbook.
 */
export function cleanSearchTitle(title: string): string {
  if (!title) return ''
  let cleaned = title.trim()
  let prev = ''
  let iterations = 0

  while (cleaned !== prev && iterations < 5) {
    prev = cleaned
    iterations++

    // 1. Remove bracketed/parenthesized keys: (Key of G), (Key G), (in G), (G), [G], [F#m]
    cleaned = cleaned.replace(/\s*[([]\s*(?:key\s+(?:of\s+)?)?[a-g][#b]?(?:m|maj|min|minor|major)?\s*[)\]]/gi, '')
    cleaned = cleaned.replace(/\s*-\s*(?:key\s+(?:of\s+)?)?[a-g][#b]?(?:m|maj|min|minor|major)?\s*$/gi, '')

    // 2. Remove capo annotations: (Capo 2), [Capo 3], - Capo 1
    cleaned = cleaned.replace(/\s*[([]\s*capo\s+[0-9]+\s*[)\]]/gi, '')
    cleaned = cleaned.replace(/\s*-\s*capo\s+[0-9]+\s*$/gi, '')

    // 3. Remove copy numbers: (2), [2], - 2
    cleaned = cleaned.replace(/\s*[([]\s*[0-9]+\s*[)\]]/g, '')
    cleaned = cleaned.replace(/\s*-\s*[0-9]+\s*$/g, '')

    // 4. Remove common audio tags: (Acoustic), (Live), (Remastered), (Official Audio), - Live
    cleaned = cleaned.replace(/\s*[([]\s*(?:acoustic|live|remaster(?:ed)?|version|album\s+version|official\s+audio|audio)\s*[)\]]/gi, '')
    cleaned = cleaned.replace(/\s*-\s*(?:acoustic|live|remaster(?:ed)?|version|album\s+version|official\s+audio|audio)\s*$/gi, '')

    // 5. Clean up any leftover trailing hyphens or redundant spaces
    cleaned = cleaned.replace(/\s*-\s*$/g, '').replace(/\s+/g, ' ').trim()
  }

  return cleaned || title.trim()
}

/**
 * Normalizes artist query for search
 */
export function cleanSearchArtist(artist?: string): string {
  if (!artist) return ''
  return artist.trim().replace(/\s+/g, ' ')
}

/**
 * Extracts earliest 4-digit release year from album metadata or raw year
 */
export function extractEarliestYear(albumData: unknown, rawYear?: unknown): string | undefined {
  const years: number[] = []

  const testYear = (val: unknown) => {
    if (typeof val === 'number' && Number.isInteger(val) && val >= 1900 && val <= 2099) {
      years.push(val)
    } else if (typeof val === 'string') {
      const match = val.match(/\b(19\d\d|20\d\d)\b/)
      if (match) {
        years.push(parseInt(match[1], 10))
      }
    }
  }

  if (Array.isArray(albumData)) {
    for (const alb of albumData) {
      if (alb && typeof alb === 'object') {
        testYear((alb as { year?: unknown }).year)
      }
    }
  } else if (albumData && typeof albumData === 'object') {
    testYear((albumData as { year?: unknown }).year)
  }

  if (rawYear) {
    testYear(rawYear)
  }

  if (years.length === 0) return undefined
  return String(Math.min(...years))
}

/**
 * Normalizes raw key string from GetSongBPM to canonical GTAR musical key
 */
export function normalizeProviderKey(rawKey?: string): string | undefined {
  if (!rawKey) return undefined
  const trimmed = rawKey.trim()
  if (!trimmed) return undefined

  // Common conversions: "C# minor" -> "C#m", "Bb major" -> "Bb"
  const formatted = trimmed
    .replace(/\s*minor$/i, 'm')
    .replace(/\s*min$/i, 'm')
    .replace(/\s*major$/i, '')
    .replace(/\s*maj$/i, '')

  const canonical = canonicalSongKey(formatted)
  return canonical || formatted
}

/**
 * Computes matching confidence between queried terms and provider candidate
 */
export function computeMatchConfidence(
  candidate: { title: string; artist: string },
  queryTitle: string,
  queryArtist?: string
): 'HIGH' | 'MEDIUM' | 'LOW' {
  const normCandTitle = cleanSearchTitle(candidate.title).toLowerCase()
  const normQueryTitle = cleanSearchTitle(queryTitle).toLowerCase()
  const normCandArtist = (candidate.artist || '').trim().toLowerCase()
  const normQueryArtist = cleanSearchArtist(queryArtist).toLowerCase()

  const titleExact = normCandTitle === normQueryTitle
  const titlePartial = normCandTitle.includes(normQueryTitle) || normQueryTitle.includes(normCandTitle)

  const artistExact = Boolean(normQueryArtist && normCandArtist && (normCandArtist === normQueryArtist || normCandArtist.includes(normQueryArtist) || normQueryArtist.includes(normCandArtist)))
  const artistEmpty = !normQueryArtist

  if (titleExact && artistExact) return 'HIGH'
  if (titleExact && artistEmpty) return 'HIGH'
  if (titleExact && !artistExact) return 'MEDIUM'
  if (titlePartial && (artistExact || artistEmpty)) return 'MEDIUM'
  return 'LOW'
}

/**
 * Determines overall match status from candidate list
 */
export function classifyMatchStatus(
  candidates: MetadataCandidate[],
  _queryTitle?: string,
  _queryArtist?: string
): MetadataMatchStatus {
  if (candidates.length === 0) return 'NO_MATCH'
  if (candidates.length === 1 && candidates[0].confidence === 'HIGH') return 'MATCH'
  if (candidates[0].confidence === 'HIGH' && (candidates.length < 2 || candidates[1].confidence !== 'HIGH')) {
    return 'MATCH'
  }
  return 'REVIEW'
}

/**
 * Fetches song metadata from server-side Cloudflare proxy function.
 * Manual on-demand only. No background or startup querying.
 */
export async function fetchSongMetadataFromProvider(
  title: string,
  artist?: string
): Promise<{ success: boolean; candidates: MetadataCandidate[]; status: MetadataMatchStatus; error?: string }> {
  const cleanTitle = cleanSearchTitle(title)
  const cleanArtist = cleanSearchArtist(artist)

  if (!cleanTitle) {
    return { success: false, candidates: [], status: 'ERROR', error: 'Song title is required' }
  }

  const queryParams = new URLSearchParams()
  queryParams.set('title', cleanTitle)
  if (cleanArtist) {
    queryParams.set('artist', cleanArtist)
  }

  try {
    const res = await fetch(`/api/metadata-lookup?${queryParams.toString()}`, {
      headers: { Accept: 'application/json' },
    })

    const data = await res.json() as {
      success: boolean
      error?: string
      results?: Array<{
        id: string
        title: string
        artist: string
        originalKey?: string
        bpm?: string
        year?: string
        sourceUrl?: string
      }>
    }

    if (!res.ok || !data.success) {
      return {
        success: false,
        candidates: [],
        status: 'ERROR',
        error: data.error || `HTTP ${res.status}: Failed to lookup metadata`,
      }
    }

    const results = data.results || []
    const candidates: MetadataCandidate[] = results.map((r) => {
      const confidence = computeMatchConfidence(r, cleanTitle, cleanArtist)
      return {
        id: r.id,
        title: r.title,
        artist: r.artist,
        originalKey: normalizeProviderKey(r.originalKey),
        bpm: r.bpm ? String(r.bpm).trim() : undefined,
        year: r.year ? String(r.year).trim() : undefined,
        sourceUrl: r.sourceUrl,
        confidence,
      }
    })

    const status = classifyMatchStatus(candidates, cleanTitle, cleanArtist)

    return {
      success: true,
      candidates,
      status,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network failure contacting metadata service'
    return {
      success: false,
      candidates: [],
      status: 'ERROR',
      error: message,
    }
  }
}
