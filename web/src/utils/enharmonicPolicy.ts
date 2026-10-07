/**
 * Target-key aware enharmonic spelling policy for GTAR
 * Ensures transposed chords and roots follow musical convention based on target key context.
 */

import { PITCH_CLASS_MAP } from './chordParser'

export const CHROMATIC_SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export const CHROMATIC_FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

// Standard preferred accidental spellings per key (both Major and Minor keys)
// 0=C, 1=C#/Db, 2=D, 3=D#/Eb, 4=E, 5=F, 6=F#/Gb, 7=G, 8=G#/Ab, 9=A, 10=A#/Bb, 11=B

// Flat-preferring keys:
// Major: F (1b), Bb (2b), Eb (3b), Ab (4b), Db (5b), Gb (6b)
// Minor: Dm (1b), Gm (2b), Cm (3b), Fm (4b), Bbm (5b), Ebm (6b)
const FLAT_KEYS = new Set([
  'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm'
])

// Key specific scale spelling preferences for all 12 pitch classes
// Standard chromatic scales tailored to key signature
const KEY_SPELLING_TABLE: Record<string, readonly string[]> = {
  // Flat major keys
  'F':  ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  'Bb': ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  'Eb': ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  'Ab': ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'C'],
  'Db': ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'C'],
  'Gb': ['Cb', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'],

  // Flat minor keys
  'Dm':  ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
  'Gm':  ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
  'Cm':  ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  'Fm':  ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'C'],
  'Bbm': ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'C'],
  'Ebm': ['Cb', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'],

  // Sharp/Natural major keys
  'C':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
  'G':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'D':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'A':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'E':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'B':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'F#': ['C', 'C#', 'D', 'D#', 'E', 'E#', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'C#': ['B#', 'C#', 'D', 'D#', 'E', 'E#', 'F#', 'G', 'G#', 'A', 'A#', 'B#'],

  // Sharp/Natural minor keys
  'Am':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
  'Em':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'Bm':  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'F#m': ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'C#m': ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  'G#m': ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
}

/**
 * Determines whether a given key signature conventionally prefers flats.
 */
export function keyPrefersFlats(key: string | null | undefined): boolean {
  if (!key) return false
  const clean = key.trim()
  if (FLAT_KEYS.has(clean)) return true
  // Check if root has 'b' or is 'F'
  const match = /^([A-Ga-g][#b]?)(.*)$/.exec(clean)
  if (!match) return false
  const root = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
  return root.includes('b') || root === 'F'
}

/**
 * Spells a pitch class (0..11) given an optional target key context or flat preference.
 */
export function spellPitchClass(pitch: number, targetKey?: string | null, preferFlats?: boolean): string {
  const normPitch = ((pitch % 12) + 12) % 12

  if (targetKey) {
    const cleanKey = targetKey.trim()
    const table = KEY_SPELLING_TABLE[cleanKey]
    if (table && table[normPitch]) {
      return table[normPitch]
    }
    const flats = preferFlats ?? keyPrefersFlats(cleanKey)
    return flats ? CHROMATIC_FLATS[normPitch] : CHROMATIC_SHARPS[normPitch]
  }

  const flats = preferFlats ?? false
  return flats ? CHROMATIC_FLATS[normPitch] : CHROMATIC_SHARPS[normPitch]
}

/**
 * Transposes a note by semitones, respecting targetKey or preferFlats.
 */
export function transposeNoteWithKey(
  note: string,
  semitones: number,
  targetKey?: string | null,
  preferFlats?: boolean
): string {
  const clean = note.trim()
  const currentIdx = PITCH_CLASS_MAP[clean]
  if (currentIdx === undefined) return note

  const newIdx = ((currentIdx + semitones) % 12 + 12) % 12
  return spellPitchClass(newIdx, targetKey, preferFlats)
}
