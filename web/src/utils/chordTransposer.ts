/**
 * Musical chord and key transposition utilities
 */

// Shared by detection, highlighting and transposition; numeric slashes belong to the quality.
export const CHORD_TOKEN_REGEX = /^[A-G][b#]?(?:maj|min|dim|aug|sus[24]?|add(?:2|4|9|11|13)|M|m|[0-9]+|b[0-9]+|#[0-9]+|alt)*(?:\/[0-9]{1,2})?(?:\/[A-G][b#]?(?:min|m)?)?$/i

const CHROMATIC_SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const CHROMATIC_FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

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
 * Transposes a single chord token, handling slash chords (e.g. "D/F#", "Am7", "C#m7b5")
 */
export function transposeChordToken(chord: string, semitones: number, preferFlats?: boolean): string {
  if (!Number.isSafeInteger(semitones) || semitones === 0 || !CHORD_TOKEN_REGEX.test(chord)) return chord
  const rootMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(chord)!
  const root = rootMatch[1][0].toUpperCase() + rootMatch[1].slice(1)
  // Only a final note slash is a bass: the slash in C6/9 is part of its quality.
  const bassMatch = /\/([A-Ga-g][#b]?)(min|m)?$/.exec(rootMatch[2])
  const quality = bassMatch ? rootMatch[2].slice(0, bassMatch.index) : rootMatch[2]
  const flats = preferFlats ?? (root.includes('b') || root === 'F')
  const transposedRoot = transposeNote(root, semitones, flats)
  if (!bassMatch) return transposedRoot + quality
  const bass = bassMatch[1][0].toUpperCase() + bassMatch[1].slice(1)
  return `${transposedRoot}${quality}/${transposeNote(bass, semitones, flats)}${bassMatch[2] ?? ''}`
}

/**
 * Transposes all bracketed chords in ChordPro content
 * e.g. [G]Amazing [D/F#]grace -> [A]Amazing [E/G#]grace
 */
export function transposeChordProText(text: string, semitones: number): string {
  if (semitones === 0) return text

  return text
    .replace(/\[([A-Ga-g][#b]?[^\]]*)\]/g, (match, chord) => {
      // Avoid transposing section headers inside brackets like [Verse 1]
      if (/^(Intro|Verse|Chorus|Bridge|Pre-Chorus|Post-Chorus|Outro|Solo|Tab)/i.test(chord)) {
        return match
      }
      return `[${transposeChordToken(chord, semitones)}]`
    })
    .replace(/<([A-Ga-g][#b]?[^>]*)>/g, (match, chord) => {
      if (/^(Intro|Verse|Chorus|Bridge|Pre-Chorus|Post-Chorus|Outro|Solo|Tab)/i.test(chord)) {
        return match
      }
      return `[${transposeChordToken(chord, semitones)}]`
    })
}

/**
 * Transposes a full chord line while preserving column-width alignment.
 * Uses spacing compensation matching Android TransposeEngine.transposeChordLine.
 */
export function transposeChordLine(chordLine: string, semitones: number): string {
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
    const replacement = prefix + parts.map((part, index) => index % 2 === 1 ? part : transposeChordToken(part, semitones)).join('') + suffix
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

