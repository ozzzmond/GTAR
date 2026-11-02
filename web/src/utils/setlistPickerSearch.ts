import type { ActiveSongState } from '../types/gtar'
import { normalizeTags } from './songTags'

/**
 * #312 S2: multi-song picker search, ported unchanged in behavior from GTAR1 @ da2bdee
 * src/components/MultiSongSetlistPicker.tsx (songMatchesPhrase, segmentSpaceSeparatedTitles,
 * parseSearchPhrases). Only the song type and tag normalization are GTAR's.
 */
export type SearchableSong = Pick<ActiveSongState, 'title' | 'artist' | 'key' | 'tags'>

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Checks if a song matches a search phrase across title, artist, key or tags (GTAR1 rules). */
export function songMatchesPhrase(song: SearchableSong, phrase: string): boolean {
  const p = phrase.trim().toLowerCase()
  if (!p) return false

  const titleLower = (song.title || '').toLowerCase()
  const artistLower = (song.artist || '').toLowerCase()
  const keyLower = (song.key || '').toLowerCase()
  const tags = normalizeTags(song.tags).map(t => t.toLowerCase())

  // Explicit field prefixes
  if (p.startsWith('key:')) {
    const targetKey = p.slice(4).trim()
    return keyLower === targetKey || keyLower.includes(targetKey)
  }
  if (p.startsWith('artist:')) return artistLower.includes(p.slice(7).trim())
  if (p.startsWith('title:')) return titleLower.includes(p.slice(6).trim())

  if (titleLower.includes(p) || artistLower.includes(p) || keyLower === p || tags.some(t => t.includes(p))) return true

  // Multi-word phrase across metadata (e.g. "Hallelujah Jeff" -> title Hallelujah, artist Jeff)
  const words = p.split(/\s+/).filter(Boolean)
  return words.length > 1 && words.every(w =>
    titleLower.includes(w) || artistLower.includes(w) || keyLower === w || tags.some(t => t.includes(w)))
}

/**
 * Splits a space-separated segment into phrases using the local catalog's titles and artists,
 * without splitting multi-word titles into separate words.
 */
export function segmentSpaceSeparatedTitles(segment: string, allSongs: SearchableSong[]): string[] {
  const trimmed = segment.trim()
  if (!trimmed) return []

  if (allSongs.some(song => songMatchesPhrase(song, trimmed))) {
    const fullTitlesPresent = allSongs.filter(song =>
      song.title && song.title.trim().length > 1 &&
      new RegExp(`(^|\\s)${escapeRegex(song.title.trim())}(?=\\s|$)`, 'i').test(trimmed))
    // 0 or 1 full title: keep as a single phrase (e.g. "Goodness of God", "Goodness of")
    if (fullTitlesPresent.length <= 1) return [trimmed]
  }

  const catalogPhrasesSet = new Set<string>()
  for (const song of allSongs) {
    if (song.title && song.title.trim().length > 1) catalogPhrasesSet.add(song.title.trim())
    if (song.artist && song.artist.trim().length > 1) catalogPhrasesSet.add(song.artist.trim())
  }
  const sortedCatalogPhrases = Array.from(catalogPhrasesSet).sort((a, b) => b.length - a.length)

  const spans: Array<{ start: number; end: number; phrase: string }> = []
  for (const phrase of sortedCatalogPhrases) {
    const regex = new RegExp(`(^|\\s)${escapeRegex(phrase)}(?=\\s|$)`, 'gi')
    let match: RegExpExecArray | null
    while ((match = regex.exec(trimmed)) !== null) {
      const start = match.index + (match[1] ? match[1].length : 0)
      const end = start + phrase.length
      if (!spans.some(s => start >= s.start && end <= s.end)) spans.push({ start, end, phrase: trimmed.slice(start, end) })
    }
  }
  if (spans.length === 0) return [trimmed]

  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const resultPhrases: string[] = []
  const has = (text: string) => resultPhrases.some(p => p.toLowerCase() === text.toLowerCase())
  let lastIndex = 0
  for (const span of spans) {
    if (span.start < lastIndex) {
      if (!has(span.phrase)) resultPhrases.push(span.phrase)
      lastIndex = Math.max(lastIndex, span.end)
      continue
    }
    if (span.start > lastIndex) {
      const gap = trimmed.slice(lastIndex, span.start).trim()
      if (gap.length > 0 && !has(gap)) resultPhrases.push(gap)
    }
    if (!has(span.phrase)) resultPhrases.push(span.phrase)
    lastIndex = Math.max(lastIndex, span.end)
  }
  if (lastIndex < trimmed.length) {
    const trailingGap = trimmed.slice(lastIndex).trim()
    if (trailingGap.length > 0 && !has(trailingGap)) resultPhrases.push(trailingGap)
  }
  return resultPhrases.length > 0 ? resultPhrases : [trimmed]
}

/** Comma- and space-separated multi-song search input → independent phrases. */
export function parseSearchPhrases(rawInput: string, allSongs: SearchableSong[]): string[] {
  if (!rawInput.trim()) return []
  if (!rawInput.includes(',')) return segmentSpaceSeparatedTitles(rawInput.trim(), allSongs)
  const phrases: string[] = []
  for (const segment of rawInput.split(',').map(s => s.trim()).filter(Boolean)) {
    for (const sp of segmentSpaceSeparatedTitles(segment, allSongs)) {
      if (!phrases.some(p => p.toLowerCase() === sp.toLowerCase())) phrases.push(sp)
    }
  }
  return phrases
}
