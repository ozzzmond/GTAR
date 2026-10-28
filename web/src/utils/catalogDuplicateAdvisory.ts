// #253 non-blocking duplicate advisory at publish time. Read-only: compares against the cached
// Shared Catalog only; never merges, blocks or changes anything.
import { lyricsSignature, normalizeChartBody } from './duplicateSongs'

export interface CatalogDuplicateCandidate { id: string; title: string; artist?: string | null; raw_content?: string }
export interface CatalogDuplicateMatch { id: string; title: string; artist: string | null; match: 'chart' | 'lyrics' }

/** Lyrics shorter than this are too generic (e.g. chord-only charts) to call a match. */
const MIN_LYRICS = 24

export function findCatalogDuplicates(
  song: { rawContent: string; publishedCatalogSongId?: string | null },
  catalog: Iterable<CatalogDuplicateCandidate | { id?: string }>,
  limit = 3,
): CatalogDuplicateMatch[] {
  const chart = normalizeChartBody(song.rawContent || '')
  const lyrics = lyricsSignature(song.rawContent || '')
  if (!chart) return []
  const matches: CatalogDuplicateMatch[] = []
  for (const item of catalog) {
    const candidate = item as CatalogDuplicateCandidate
    // Own publication (republish/update) is not a duplicate; entries without content cannot be compared.
    if (!candidate.id || candidate.id === song.publishedCatalogSongId || typeof candidate.raw_content !== 'string') continue
    const match = normalizeChartBody(candidate.raw_content) === chart ? 'chart'
      : lyrics.length >= MIN_LYRICS && lyricsSignature(candidate.raw_content) === lyrics ? 'lyrics' : null
    if (match) matches.push({ id: candidate.id, title: candidate.title, artist: candidate.artist ?? null, match })
    if (matches.length >= limit) break
  }
  return matches
}
