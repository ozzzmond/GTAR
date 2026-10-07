/**
 * Deterministic Chord Model and Parser for GTAR
 * Pure functions for parsing chord notation into root, quality/modifiers, and optional slash bass.
 */

export interface ParsedChord {
  root: string
  quality: string
  bass?: string
  bassQuality?: string
  raw: string
  isKnown: boolean
}

// Roots recognized across all twelve pitch classes plus enharmonics
export const CHROMATIC_ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'] as const

// Pitch classes: 0 = C, 1 = C#/Db, ..., 11 = B
export const PITCH_CLASS_MAP: Record<string, number> = {
  'B#': 0, 'C': 0, 'Dbb': 0,
  'C#': 1, 'Db': 1, 'B##': 1,
  'D': 2, 'C##': 2, 'Ebb': 2,
  'D#': 3, 'Eb': 3, 'Fbb': 3,
  'E': 4, 'Fb': 4, 'D##': 4,
  'E#': 5, 'F': 5, 'Gbb': 5,
  'F#': 6, 'Gb': 6, 'E##': 6,
  'G': 7, 'F##': 7, 'Abb': 7,
  'G#': 8, 'Ab': 8,
  'A': 9, 'G##': 9, 'Bbb': 9,
  'A#': 10, 'Bb': 10, 'Cbb': 10,
  'B': 11, 'Cb': 11, 'A##': 11,
}

// English words or non-chord words that start with A-G but should never be parsed as chords
const REJECTED_WORDS = new Set([
  'an', 'and', 'as', 'at', 'all', 'are', 'about', 'above', 'after', 'again', 'against',
  'be', 'been', 'being', 'before', 'between', 'below', 'behind', 'by', 'but', 'because',
  'can', 'could', 'come', 'came',
  'do', 'did', 'does', 'done', 'down', 'during',
  'each', 'even', 'every',
  'for', 'from', 'first',
  'go', 'get', 'got', 'give', 'gave', 'good', 'great',
  'intro', 'verse', 'chorus', 'bridge', 'outro', 'solo', 'pre-chorus', 'post-chorus', 'tab'
])

/**
 * Checks if a string is a valid musical root note (e.g. C, C#, Db, F#)
 */
export function isValidRootNote(root: string): boolean {
  return root in PITCH_CLASS_MAP
}

/**
 * Normalizes root capitalization: e.g. "c#" -> "C#", "db" -> "Db", "g" -> "G"
 */
export function normalizeRootNote(root: string): string {
  if (!root) return ''
  return root.charAt(0).toUpperCase() + root.slice(1).toLowerCase()
}

/**
 * Safe chord suffix regex components:
 * Supports standard triads, 7ths, 9/11/13, sus, add, alt, alterations (#5, b9, etc.),
 * parenthesized extensions like (add9), (b5), (#9), (b9), (#11), and delta/dim/aug symbols.
 */
// Sub-patterns for quality:
// 1. Quality bases: m, min, minor, maj, major, M, dim, diminished, aug, augmented, sus, add, alt
// 2. Modifiers: numbers, #/#, b/b, parenthesized groups like (b5), (#9), (add9), (11), (13)
// 3. Symbolic: Δ, °, ø, +
const QUAL_ATOM = '(?:maj(?:or)?|min(?:or)?|dim(?:inished)?|aug(?:mented)?|sus[24]?|add(?:2|4|9|11|13)?|alt|M|m|[0-9]+|[b#][0-9]+|[Δ°ø+])'
const PAREN_MOD = '(?:\\((?:[b#]?[0-9]+|add[0-9]+|omit[0-9]+|sus[24]?|maj[0-9]*|min[0-9]*)\\))'
const MOD_ATOM = `(?:${QUAL_ATOM}|${PAREN_MOD})`

// Known comprehensive chord token regex
export const KNOWN_CHORD_REGEX = new RegExp(
  `^[A-Ga-g][#b]?(?:${MOD_ATOM})*(?:\\/[0-9]{1,2})?(?:\\/[A-Ga-g][#b]?(?:min|m)?)?$`,
  'i'
)

// Conservative Safe Rooted Unknown: Root note + allowable suffix characters (alphanumerics, #, b, +, -, (), ^, /, ~)
// Must not look like standard English prose or random punctuation.
const SAFE_SUFFIX_REGEX = /^[A-Za-z0-9#b+()\-^Δ°ø~]*(?:\/[A-Ga-g][#b]?(?:min|m)?)?$/

/**
 * Parses a chord token into structured ParsedChord or null if not a chord.
 */
export function parseChord(token: string): ParsedChord | null {
  if (!token || typeof token !== 'string') return null
  const clean = token.trim()
  if (!clean || clean.length > 30) return null

  // Fast check: if lowercase word is in rejection dictionary (like "and", "can", "for", "do")
  const lower = clean.toLowerCase()
  if (REJECTED_WORDS.has(lower)) return null

  // Must start with musical root A-G with optional # or b
  const rootMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(clean)
  if (!rootMatch) return null

  const rawRoot = rootMatch[1]
  const normalizedRoot = normalizeRootNote(rawRoot)
  if (!isValidRootNote(normalizedRoot)) return null

  const remainder = rootMatch[2]

  // If token is just a single letter (like "A"), but surrounded or parsed alone,
  // it is a root. But if it's something like "Apple", remainder is "pple" -> rejected.
  // Check if remainder contains non-chord prose
  if (remainder && /^[a-z]{3,}$/.test(remainder)) {
    // If remainder is a sequence of 3+ lowercase letters, only accept known musical terms:
    // "maj", "min", "dim", "aug", "sus", "add", "alt"
    if (!/^(?:maj|min|minor|major|dim|diminished|aug|augmented|sus|add|alt)/i.test(remainder)) {
      return null
    }
  }

  // Parse optional slash bass
  // Distinguish slash quality like C6/9 from slash bass like C/E or C6/9/G
  let quality = remainder
  let bass: string | undefined
  let bassQuality: string | undefined

  const slashMatch = /\/([A-Ga-g][#b]?)(min|m)?$/.exec(remainder)
  if (slashMatch) {
    const rawBass = slashMatch[1]
    const normBass = normalizeRootNote(rawBass)
    if (isValidRootNote(normBass)) {
      bass = normBass
      bassQuality = slashMatch[2] || undefined
      quality = remainder.slice(0, slashMatch.index)
    }
  }

  // Check if known or safe rooted unknown
  const isKnown = KNOWN_CHORD_REGEX.test(clean)
  if (!isKnown) {
    // Check safe rooted unknown policy:
    // Quality must conform to safe musical chars and not look like arbitrary English prose
    if (!SAFE_SUFFIX_REGEX.test(remainder)) {
      return null
    }
    // Reject concatenated chord tokens where another uppercase root appears unslashed (e.g. "Cadd9A7sus4Em7")
    if (/[A-G]/.test(remainder)) {
      return null
    }
    // Reject arbitrary prose words starting with capital root (e.g. "Dance", "Best", "Every", "Father")
    if (remainder && /^[a-z]{2,}/.test(remainder) && !/^(?:maj|min|dim|aug|sus|add|alt)/i.test(remainder)) {
      return null
    }
  }

  return {
    root: normalizedRoot,
    quality,
    bass,
    bassQuality,
    raw: clean,
    isKnown,
  }
}

/**
 * Predicate to test whether a token is recognized as a valid or safe-rooted chord.
 */
export function isChordToken(token: string): boolean {
  return parseChord(token) !== null
}
