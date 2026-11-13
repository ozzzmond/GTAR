import type { SongLine } from '../types/gtar'
import { parseChordProLine } from './songParser'

export interface LyricProjection {
  readonly lineId: number
  readonly anchorId: number
  readonly sectionId: number
  readonly tokens: readonly string[]
}
export function lyricTokens(text: string): string[] {
  return text.normalize('NFKC').toLowerCase()
    .replace(/[’‘ʼ]/gu, "'")
    .replace(/(?<=[\p{L}\p{M}\p{N}])'(?=[\p{L}\p{M}\p{N}])/gu, '')
    .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
}
// Read-only parsed lyrics; global anchors survive column splits.
export function projectLyrics(lines: readonly SongLine[]): LyricProjection[] {
  let sectionId = -1
  const result: LyricProjection[] = []
  lines.forEach((line, lineId) => {
    if (line.type === 'SECTION_HEADER') sectionId = lineId
    if (line.type !== 'LYRIC' && line.type !== 'CHORD_PRO') return
    const text = line.type === 'CHORD_PRO' ? line.segments.map(s => s.text).join('')
      : parseChordProLine(line.lyrics).map(s => s.text).join('')
    const tokens = lyricTokens(text)
    if (!tokens.length) return
    const previous = lines[lineId - 1]
    result.push({ lineId, anchorId: previous?.type === 'CHORD_ROW' && previous.isOverLyric ? lineId - 1 : lineId, sectionId, tokens })
  })
  return result
}
// Exact complete-line coverage; all occurrences, never a scroll target.
export function matchLiveLyrics(projection: readonly LyricProjection[], text: string): ReadonlySet<number> {
  const wanted = lyricTokens(text)
  const anchors = new Set<number>()
  if (!wanted.length) return anchors
  for (let start = 0; start < projection.length; start++) {
    let offset = 0
    for (let end = start; end < projection.length && projection[end].sectionId === projection[start].sectionId; end++) {
      const line = projection[end]
      if (!line.tokens.every((token, index) => token === wanted[offset + index])) break
      offset += line.tokens.length
      if (offset === wanted.length) {
        for (let index = start; index <= end; index++) anchors.add(projection[index].anchorId)
        break
      }
      if (offset > wanted.length) break
    }
  }
  return anchors
}
