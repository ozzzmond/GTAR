/**
 * Nashville Number System Notation Utilities for GTAR
 *
 * Converts musical chords to relative scale degrees (1, 2, 3, etc.) preserving
 * qualities, extensions, alterations, and slash bass degrees.
 */

import { CHORD_TOKEN_REGEX } from './chordTransposer'

export const NOTATION_STORAGE_KEY = 'gtar_stage_notation'
export type StageNotationMode = 'chords' | 'numbers'

const NOTE_ALIASES: Record<string, number> = {
  'B#': 0, 'C': 0,
  'C#': 1, 'Db': 1,
  'D': 2,
  'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4,
  'E#': 5, 'F': 5,
  'F#': 6, 'Gb': 6,
  'G': 7,
  'G#': 8, 'Ab': 8,
  'A': 9,
  'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
}

const SEMITONE_DEGREES = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'] as const

/**
 * Validates whether a key string is a valid musical key (e.g. "C", "G", "Am", "F#m", "Bb").
 */
export function isValidMusicalKey(key: string | null | undefined): boolean {
  if (!key || typeof key !== 'string') return false
  const trimmed = key.trim()
  const match = /^([A-Ga-g][#b]?)(?:m|min|maj)?$/i.exec(trimmed)
  if (!match) return false
  const root = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
  return root in NOTE_ALIASES
}

/**
 * Extracts the root note from a key string (e.g. "G" -> "G", "F#m" -> "F#", "Bb" -> "Bb").
 */
export function extractKeyRootNote(key: string | null | undefined): string | null {
  if (!isValidMusicalKey(key)) return null
  const trimmed = key!.trim()
  const match = /^([A-Ga-g][#b]?)/i.exec(trimmed)
  if (!match) return null
  return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
}

/**
 * Extracts trustworthy key from song metadata or explicit directives.
 * Strictly adheres to rule: DO NOT GUESS KEY FROM CHORD PROGRESSION.
 * Returns null if key is missing or invalid.
 */
export function getTrustworthySongKey(songKey?: string | null, rawContent?: string | null): string | null {
  if (songKey && isValidMusicalKey(songKey)) {
    const trimmed = songKey.trim()
    const match = /^([A-Ga-g][#b]?)(?:m|min|maj)?$/i.exec(trimmed)
    if (match) {
      const root = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
      const isMinor = /m(?:in)?$/i.test(trimmed)
      return isMinor ? `${root}m` : root
    }
  }

  if (rawContent && typeof rawContent === 'string') {
    // 1. Explicit ChordPro directive {key: X} or {k: X}
    const directiveMatch = /\{(?:key|k):\s*([A-Ga-g][#b]?(?:m|maj|min)?)(?:\s|\}|$)/i.exec(rawContent)
    if (directiveMatch && directiveMatch[1] && isValidMusicalKey(directiveMatch[1])) {
      const trimmed = directiveMatch[1].trim()
      const match = /^([A-Ga-g][#b]?)(?:m|min|maj)?$/i.exec(trimmed)
      if (match) {
        const root = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
        const isMinor = /m(?:in)?$/i.test(trimmed)
        return isMinor ? `${root}m` : root
      }
    }

    // 2. Metadata line at start of chart: "Key: X" or "Key of X" or "Original Key: X"
    const metaMatch = /^\s*(?:original\s+)?key(?:\s+of)?\s*:\s*([A-Ga-g][#b]?(?:m|maj|min)?)(?:\s|\r|\n|$)/im.exec(rawContent)
    if (metaMatch && metaMatch[1] && isValidMusicalKey(metaMatch[1])) {
      const trimmed = metaMatch[1].trim()
      const match = /^([A-Ga-g][#b]?)(?:m|min|maj)?$/i.exec(trimmed)
      if (match) {
        const root = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
        const isMinor = /m(?:in)?$/i.test(trimmed)
        return isMinor ? `${root}m` : root
      }
    }
  }

  return null
}

/**
 * Converts a musical note to its scale degree relative to reference key root.
 * Evaluates exact semitone distance to ensure scale degrees are strictly invariant
 * under transposition across all keys.
 */
export function noteToNashvilleDegree(note: string, keyRootNote: string): string {
  const cleanNote = note.trim()
  const cleanKeyRoot = keyRootNote.trim()
  if (!(cleanNote in NOTE_ALIASES) || !(cleanKeyRoot in NOTE_ALIASES)) {
    return note
  }

  const semitones = ((NOTE_ALIASES[cleanNote] - NOTE_ALIASES[cleanKeyRoot]) % 12 + 12) % 12
  return SEMITONE_DEGREES[semitones]
}

/**
 * Converts a chord token (e.g. "Dm7", "Fmaj7", "D/F#", "Am7/D", "Cadd9")
 * into Nashville Number System notation relative to a reference key.
 */
export function chordTokenToNashville(chord: string, referenceKey: string): string {
  if (!chord || !referenceKey) return chord
  const cleanChord = chord.trim()
  if (!CHORD_TOKEN_REGEX.test(cleanChord)) return chord

  const keyRoot = extractKeyRootNote(referenceKey)
  if (!keyRoot) return chord

  const rootMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(cleanChord)
  if (!rootMatch) return chord

  const root = rootMatch[1].charAt(0).toUpperCase() + rootMatch[1].slice(1).toLowerCase()
  const remainder = rootMatch[2]

  // Only a final note slash is a bass: the slash in C6/9 is part of quality
  const bassMatch = /\/([A-Ga-g][#b]?)(min|m)?$/.exec(remainder)
  const quality = bassMatch ? remainder.slice(0, bassMatch.index) : remainder

  const rootDegree = noteToNashvilleDegree(root, keyRoot)

  if (!bassMatch) {
    return `${rootDegree}${quality}`
  }

  const bassNote = bassMatch[1].charAt(0).toUpperCase() + bassMatch[1].slice(1).toLowerCase()
  const rawBassDegree = noteToNashvilleDegree(bassNote, keyRoot)
  // In Nashville Number notation, slash bass scale degrees omit accidentals
  // (e.g. G/B in Key F is 2/4, A/C# in Key G is 2/4, D/F# in Key C is 2/4)
  const bassDegree = rawBassDegree.replace(/^[#b]+/, '')
  const bassQuality = bassMatch[2] || ''

  return `${rootDegree}${quality}/${bassDegree}${bassQuality}`
}

/**
 * Converts a whole chord line to Nashville notation while preserving column alignment.
 */
export function convertChordLineToNashville(chordLine: string, referenceKey: string): string {
  if (!chordLine || !referenceKey || !isValidMusicalKey(referenceKey)) return chordLine
  let result = ''
  let i = 0
  while (i < chordLine.length) {
    if (/\s/.test(chordLine[i])) {
      result += chordLine[i++]
      continue
    }
    const start = i
    while (i < chordLine.length && !/\s/.test(chordLine[i])) i++
    const raw = chordLine.slice(start, i)
    const prefix = raw.match(/^[[<({|,:;~]+/)?.[0] ?? ''
    const suffix = raw.match(/[\]>)}|,:;~]+$/)?.[0] ?? ''
    const clean = raw.slice(prefix.length, raw.length - suffix.length)
    const parts = clean.split(/([---])/)
    if (!parts.every((part, index) => index % 2 === 1 || CHORD_TOKEN_REGEX.test(part))) {
      result += raw
      continue
    }
    const replacement =
      prefix +
      parts
        .map((part, index) => (index % 2 === 1 ? part : chordTokenToNashville(part, referenceKey)))
        .join('') +
      suffix
    result += replacement
    const difference = replacement.length - raw.length
    let spaces = 0
    while (chordLine[i + spaces] === ' ') spaces++
    if (difference > 0) i += Math.min(difference, Math.max(0, spaces - 1))
    else if (difference < 0 && spaces > 1) result += ' '.repeat(-difference)
  }
  return result
}

/**
 * Converts ChordPro bracketed chords in text to Nashville notation.
 */
export function convertChordProTextToNashville(text: string, referenceKey: string): string {
  if (!text || !referenceKey || !isValidMusicalKey(referenceKey)) return text

  return text
    .replace(/\[([A-Ga-g][#b]?[^\]]*)\]/g, (match, chord) => {
      if (/^(Intro|Verse|Chorus|Bridge|Pre-Chorus|Post-Chorus|Outro|Solo|Tab)/i.test(chord)) {
        return match
      }
      return `[${chordTokenToNashville(chord, referenceKey)}]`
    })
    .replace(/<([A-Ga-g][#b]?[^>]*)>/g, (match, chord) => {
      if (/^(Intro|Verse|Chorus|Bridge|Pre-Chorus|Post-Chorus|Outro|Solo|Tab)/i.test(chord)) {
        return match
      }
      return `[${chordTokenToNashville(chord, referenceKey)}]`
    })
}
