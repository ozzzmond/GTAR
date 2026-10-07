/**
 * Musical chord and key transposition utilities
 */

import { parseChord } from './chordParser'
import {
  transposeNoteWithKey,
  keyPrefersFlats,
  CHROMATIC_SHARPS,
  CHROMATIC_FLATS,
} from './enharmonicPolicy'

// Export parser utilities for unified consumers
export {
  parseChord,
  isChordToken,
  isValidRootNote,
  normalizeRootNote,
  type ParsedChord,
} from './chordParser'

export {
  keyPrefersFlats,
  spellPitchClass,
  transposeNoteWithKey,
} from './enharmonicPolicy'

// Shared token regex matching both known chords and safe-rooted unknown chords
export const CHORD_TOKEN_REGEX = {
  test(token: string): boolean {
    return parseChord(token) !== null
  },
}

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

/**
 * Transposes a single musical root note by semitones
 */
export function transposeNote(note: string, semitones: number, preferFlats = false): string {
  const clean = note.trim()
  if (!(clean in NOTE_ALIASES)) return note

  const currentIdx = NOTE_ALIASES[clean]
  const newIdx = ((currentIdx + semitones) % 12 + 12) % 12
  const scale = preferFlats ? CHROMATIC_FLATS : CHROMATIC_SHARPS
  return scale[newIdx]
}

/**
 * Enharmonic pairs mapping for accidental keys (black-key pitches)
 */
const ENHARMONIC_PAIRS: Record<string, [string, string]> = {
  'C#': ['C#', 'Db'],
  'Db': ['C#', 'Db'],
  'D#': ['Eb', 'D#'],
  'Eb': ['Eb', 'D#'],
  'F#': ['F#', 'Gb'],
  'Gb': ['F#', 'Gb'],
  'G#': ['Ab', 'G#'],
  'Ab': ['Ab', 'G#'],
  'A#': ['Bb', 'A#'],
  'Bb': ['Bb', 'A#'],
}

/**
 * Formats a key with enharmonic spelling pair when applicable (e.g. "C# / Db", "Eb / D#", "C#m / Dbm")
 */
export function formatEnharmonicKey(key: string | null | undefined): string {
  if (!key) return ''
  const trimmed = key.trim()
  const match = trimmed.match(/^([A-Ga-g][#b]?)(.*)$/)
  if (!match) return key
  const root = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
  const quality = match[2]

  const pair = ENHARMONIC_PAIRS[root]
  if (!pair) return `${root}${quality}`
  return `${pair[0]}${quality} / ${pair[1]}${quality}`
}

/**
 * Transposes a key signature (e.g. "G", "Am", "F#m", "Bb", "C#m")
 * Prefers conventional flat spellings for musician-facing keys (Bb, Eb, Ab) rather than esoteric sharps (A#, D#, G#).
 */
export function transposeKey(key: string | null | undefined, semitones: number): string {
  if (!key || semitones === 0) return key || ''
  const trimmed = key.trim()
  const match = trimmed.match(/^([A-Ga-g][#b]?)(.*)$/)
  if (!match) return key

  const root = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
  const quality = match[2]
  const currentIdx = NOTE_ALIASES[root]
  if (currentIdx === undefined) return key

  const newIdx = ((currentIdx + semitones) % 12 + 12) % 12
  const isMinor = quality.toLowerCase().startsWith('m') && !quality.toLowerCase().startsWith('maj')
  let preferFlats = root.includes('b') || root === 'F'
  if (!isMinor) {
    if (newIdx === 10 || newIdx === 3 || newIdx === 8) {
      preferFlats = true
    }
  } else {
    if (newIdx === 10 || newIdx === 1) {
      preferFlats = true
    }
  }

  const scale = preferFlats ? CHROMATIC_FLATS : CHROMATIC_SHARPS
  const newRoot = scale[newIdx]
  return `${newRoot}${quality}`
}

/**
 * Formats semitone offset for display (e.g. "+2", "-1", "0")
 */
export function formatTransposeOffset(offset: number): string {
  if (offset > 0) return `+${offset}`
  return `${offset}`
}

/**
 * Transposes a single chord token using pure chord parsing and enharmonic policy:
 * - transposes root
 * - preserves chord quality and modifiers intact (including parenthesized extensions, safe unknown suffixes)
 * - transposes slash bass with consistent enharmonic policy
 * - targetKey or preferFlats parameter guides enharmonic spelling
 */
export function transposeChordToken(
  chord: string,
  semitones: number,
  preferFlatsOrTargetKey?: boolean | string | null
): string {
  if (!Number.isSafeInteger(semitones) || semitones === 0) return chord

  const parsed = parseChord(chord)
  if (!parsed) return chord

  // Determine target key context or flats preference
  let targetKey: string | undefined
  let preferFlats: boolean | undefined

  if (typeof preferFlatsOrTargetKey === 'string') {
    targetKey = preferFlatsOrTargetKey
    preferFlats = keyPrefersFlats(targetKey)
  } else if (typeof preferFlatsOrTargetKey === 'boolean') {
    preferFlats = preferFlatsOrTargetKey
  } else {
    // If unspecified, inherit from source root preference: flats if source root had flat or was F
    preferFlats = parsed.root.includes('b') || parsed.root === 'F'
  }

  const transposedRoot = transposeNoteWithKey(parsed.root, semitones, targetKey, preferFlats)

  if (!parsed.bass) {
    return `${transposedRoot}${parsed.quality}`
  }

  const transposedBass = transposeNoteWithKey(parsed.bass, semitones, targetKey, preferFlats)
  const bassQuality = parsed.bassQuality ?? ''
  return `${transposedRoot}${parsed.quality}/${transposedBass}${bassQuality}`
}

/**
 * Transposes all bracketed chords in ChordPro content
 * e.g. [G]Amazing [D/F#]grace -> [A]Amazing [E/G#]grace
 */
export function transposeChordProText(
  text: string,
  semitones: number,
  preferFlatsOrTargetKey?: boolean | string | null
): string {
  if (semitones === 0) return text

  return text
    .replace(/\[([A-Ga-g][#b]?[^\]]*)\]/g, (match, chord) => {
      // Avoid transposing section headers inside brackets like [Verse 1]
      if (/^(Intro|Verse|Chorus|Bridge|Pre-Chorus|Post-Chorus|Outro|Solo|Tab)/i.test(chord)) {
        return match
      }
      return `[${transposeChordToken(chord, semitones, preferFlatsOrTargetKey)}]`
    })
    .replace(/<([A-Ga-g][#b]?[^>]*)>/g, (match, chord) => {
      if (/^(Intro|Verse|Chorus|Bridge|Pre-Chorus|Post-Chorus|Outro|Solo|Tab)/i.test(chord)) {
        return match
      }
      return `[${transposeChordToken(chord, semitones, preferFlatsOrTargetKey)}]`
    })
}

/**
 * Transposes a full chord line while preserving column-width alignment.
 * Uses spacing compensation matching Android TransposeEngine.transposeChordLine.
 */
export function transposeChordLine(
  chordLine: string,
  semitones: number,
  preferFlatsOrTargetKey?: boolean | string | null
): string {
  if (!Number.isSafeInteger(semitones) || semitones === 0 || !chordLine.trim()) return chordLine
  let result = ''
  let i = 0
  while (i < chordLine.length) {
    if (/\s/.test(chordLine[i])) { result += chordLine[i++]; continue }
    const start = i
    while (i < chordLine.length && !/\s/.test(chordLine[i])) i++
    const raw = chordLine.slice(start, i)
    const prefix = raw.match(/^[[<({|,:;~]+/)?.[0] ?? ''
    const suffix = raw.match(/[\]>)}|,:;~]+$/)?.[0] ?? ''
    const clean = raw.slice(prefix.length, raw.length - suffix.length)
    const parts = clean.split(/([-??])/)
    if (!parts.every((part, index) => index % 2 === 1 || CHORD_TOKEN_REGEX.test(part))) { result += raw; continue }
    const replacement = prefix + parts.map((part, index) => index % 2 === 1 ? part : transposeChordToken(part, semitones, preferFlatsOrTargetKey)).join('') + suffix
    result += replacement
    const difference = replacement.length - raw.length
    let spaces = 0
    while (chordLine[i + spaces] === ' ') spaces++
    if (difference > 0) i += Math.min(difference, Math.max(0, spaces - 1))
    else if (difference < 0 && spaces > 1) result += ' '.repeat(-difference)
  }
  return result
}

export * from './nashvilleNotation'
