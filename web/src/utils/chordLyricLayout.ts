import type { ChordSegment } from '../types/gtar'
import { CHORD_TOKEN_REGEX } from './songParser'

/** Word-sized wrap units; each chord stays attached to its authored lyric fragment. */
export function chordLyricWords(segments: ChordSegment[]): ChordSegment[][] {
  const words: ChordSegment[][] = []
  let current: ChordSegment[] = []
  for (const segment of segments) {
    const fragments = segment.text.match(/\S+\s*|\s+/g) || ['']
    fragments.forEach((text, index) => {
      current.push({ chord: index === 0 ? segment.chord : null, text })
      if (/\s$/.test(text)) { words.push(current); current = [] }
    })
  }
  if (current.length) words.push(current)
  return words
}

/** Legacy two-line columns become render-only anchors, never rewritten song content. */
export function twoLineSegments(chords: string, lyrics: string): ChordSegment[] {
  const anchors = [...chords.matchAll(/\S+/g)].filter(match => CHORD_TOKEN_REGEX.test(match[0]))
  const segments: ChordSegment[] = []
  if (!anchors.length) return [{ chord: null, text: lyrics }]
  if (anchors[0].index > 0) segments.push({ chord: null, text: lyrics.slice(0, anchors[0].index) })
  anchors.forEach((anchor, index) => {
    segments.push({ chord: anchor[0], text: lyrics.slice(anchor.index, anchors[index + 1]?.index ?? lyrics.length) })
  })
  return segments
}
