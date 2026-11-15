/** Offline-only WorshipChords parsing seam. No network access or provider registration. */
import { OnlineSearchError, type OnlineChordResult, type FetchedChordSheet } from './onlineSearchProvider'

function parseError(message = 'Unable to parse WorshipChords HTML'): never {
  throw new OnlineSearchError(message, { code: 'PARSE_ERROR' })
}

function boundedHtml(html: string): string {
  if (html.length > 2 * 1024 * 1024 || new TextEncoder().encode(html).byteLength > 2 * 1024 * 1024) {
    parseError('WorshipChords HTML exceeds size limit')
  }
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return named[name.toLowerCase()] ?? entity
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd'
  })
}

function textContent(html: string): string {
  return decodeEntities(html.replace(/<br\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ''))
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)
  return match ? decodeEntities(match[2]) : undefined
}

/** Parse supplied HTML only. A missing search layout is a failure, never a fake empty result. */
export function parseWorshipChordsSearch(input: string): OnlineChordResult[] {
  const html = boundedHtml(input)
  if (!/<h1\b[^>]*>\s*Search results\b/i.test(html)) parseError()
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
    .filter(match => attribute(' ' + match[1], 'rel')?.split(/\s+/).includes('bookmark'))
  const results: OnlineChordResult[] = []
  const seen = new Set<string>()
  for (let i = 0; i < links.length; i++) {
    const match = links[i]
    const url = validateWorshipChordsSongUrl(attribute(' ' + match[1], 'href') ?? '')
    const songName = textContent(match[2]).trim()
    if (!url || !songName || seen.has(url)) continue
    const following = html.slice(match.index! + match[0].length, links[i + 1]?.index ?? html.length)
    const artist = /<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi
    const artistName = [...following.matchAll(artist)].find(span =>
      attribute(' ' + span[1], 'class')?.split(/\s+/).includes('categories'))
    seen.add(url)
    results.push({
      id: `worshipchords:${new URL(url).pathname.slice(1, -1)}`, songName,
      artistName: artistName ? textContent(artistName[2]).trim() : '',
      tabUrl: url, type: 'Chords', version: 1, votes: 0, rating: 0,
      providerId: 'worshipchords', providerName: 'WorshipChords',
    })
    if (results.length >= 50) break
  }
  if (!results.length && !/Sorry,\s*no songs matched your search/i.test(textContent(html))) parseError()
  return results
}

/** Supplied HTML -> existing chart contract, without chord conversion or inferred metadata.
 * CHART_KEY stays separate from ORIGINAL_KEY; suggested keys/capos are deliberately ignored.
 * This offline result is not wired to App import (which currently guesses missing keys).
 */
export function parseWorshipChordsSheet(input: string, sourceUrl: string): { sheet: FetchedChordSheet; chartKey: string } {
  const safeUrl = validateWorshipChordsSongUrl(sourceUrl)
  if (!safeUrl) throw new OnlineSearchError('Invalid WorshipChords song URL', { code: 'INVALID_QUERY' })
  const html = boundedHtml(input)
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)
  const title = h1 ? textContent(h1[1]).trim().replace(/\s+Chords$/i, '') : ''
  const blocks = [...html.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre\s*>/gi)]
  const keyed = blocks.filter(block => attribute(' ' + block[1], 'data-key') !== undefined)
  // Ambiguous widgets/multiple charts must not silently select the wrong chart.
  const chart = keyed.length === 1 ? keyed[0] : keyed.length === 0 && blocks.length === 1 ? blocks[0] : undefined
  if (!title || !chart) parseError()
  const rawContent = textContent(chart[2])
  if (!rawContent.trim()) parseError()
  const metadata = decodeEntities(html.replace(/<[^>]*>/g, ' '))
  const originalKey = /\bOriginal Key:\s*([A-G](?:#|b)?m?)(?=\s|$)/.exec(metadata)?.[1] ?? ''
  const chartKeyRaw = attribute(' ' + chart[1], 'data-key') ?? ''
  const chartKey = /^[A-G](?:#|b)?m?$/.test(chartKeyRaw) ? chartKeyRaw : ''
  const descriptionTag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .find(tag => attribute(tag[0], 'property') === 'og:description')
  const description = descriptionTag ? attribute(descriptionTag[0], 'content') ?? '' : ''
  const artist = /^.*?\sChords\s+[-–]\s+(.+?)\s+[-–]\s+view\b/i.exec(description)?.[1].trim() ?? ''
  return {
    chartKey,
    sheet: { title, artist, key: originalKey, capo: '', bpm: '', format: 'TWO_LINE', rawContent, sourceUrl: safeUrl },
  }
}

export function validateWorshipChordsSongUrl(raw: string): string | null {
  // Validate the literal form too: URL parsing otherwise hides traversal and encoded paths.
  if (raw.length > 2048 || !/^https:\/\/worshipchords\.com\/[a-z0-9]+(?:-[a-z0-9]+)*-chords\/$/.test(raw)) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'worshipchords.com'
      && !url.username && !url.password && !url.port && !url.search && !url.hash ? url.href : null
  } catch { return null }
}
