/**
 * Guitar Chord Voicings Dictionary
 * Consolidated trusted guitar voicings and enharmonic alias resolution.
 */

import { NATURAL_CHORD_VOICINGS } from '../data/naturalChords'
import { ACCIDENTAL_CHORD_VOICINGS } from '../data/accidentalChords'

export interface ChordVoicing {
  chord: string
  baseFret: number
  frets: number[] // -1 = muted/x, 0 = open, 1..n = fret number
  fingers?: number[] // 0 = none, 1 = index, 2 = middle, 3 = ring, 4 = pinky
  barres?: number[]
}

// Enharmonic alias pairs for root lookups
const ENHARMONIC_ROOT_ALIASES: Record<string, string> = {
  'c#': 'db',
  'db': 'c#',
  'd#': 'eb',
  'eb': 'd#',
  'f#': 'gb',
  'gb': 'f#',
  'g#': 'ab',
  'ab': 'g#',
  'a#': 'bb',
  'bb': 'a#',
}

// Aggregate all trusted catalog entries (288 direct entries)
export const standardChords: ChordVoicing[] = [
  ...NATURAL_CHORD_VOICINGS,
  ...ACCIDENTAL_CHORD_VOICINGS,
]

const chordMap = new Map<string, ChordVoicing>()
for (const v of standardChords) {
  chordMap.set(v.chord.toLowerCase(), v)
}

/**
 * Normalizes quality aliases for diagram lookup:
 * e.g. "Cmajor7" -> "Cmaj7", "Cminor7" -> "Cm7", "C(add9)" -> "Cadd9", "CΔ" -> "Cmaj7"
 */
function normalizeQualityForLookup(chord: string): string {
  return chord
    .replace(/\(([^)]+)\)/g, '$1') // C(add9) -> Cadd9, F#m7(b5) -> F#m7b5
    .replace(/major/i, 'maj')
    .replace(/minor/i, 'm')
    .replace(/Δ/g, 'maj7')
    .replace(/°/g, 'dim7')
    .replace(/ø/g, 'm7b5')
    .trim()
}

/**
 * Resolves a trusted guitar voicing for a given chord name.
 * 1. Checks exact match
 * 2. Checks stripped brackets/parentheses and quality aliases
 * 3. Resolves enharmonic root/bass aliases (e.g. A# -> Bb)
 * Returns null if no trusted voicing exists (clean no-diagram state).
 */
export function getChordVoicing(chordName: string): ChordVoicing | null {
  if (!chordName || typeof chordName !== 'string') return null
  const clean = chordName.trim()
  if (!clean || clean.toLowerCase() === 'n.c.' || clean.toLowerCase() === 'nc') {
    return null
  }

  // 1. Direct exact lookup
  const exact = chordMap.get(clean.toLowerCase())
  if (exact) return exact

  // 2. Strip outer enclosing brackets/parentheses if fully enclosed: "[Am7]" -> "Am7", "(Am7)" -> "Am7"
  let stripped = clean
  if (
    (stripped.startsWith('[') && stripped.endsWith(']')) ||
    (stripped.startsWith('(') && stripped.endsWith(')')) ||
    (stripped.startsWith('<') && stripped.endsWith('>'))
  ) {
    const inner = stripped.slice(1, -1).trim()
    // Only strip if inner contains a chord root (avoid destroying parenthesized modifier like (add9) when standalone)
    if (inner) stripped = inner
  }
  const strippedMatch = chordMap.get(stripped.toLowerCase())
  if (strippedMatch) return strippedMatch

  // 3. Normalize internal parentheses and quality aliases: "C(add9)" -> "Cadd9", "F#m7(b5)" -> "F#m7b5"
  const normalized = normalizeQualityForLookup(stripped)
  const normMatch = chordMap.get(normalized.toLowerCase())
  if (normMatch) return normMatch

  // 4. Enharmonic root / bass alias resolution
  // e.g., if "A#7" is requested and catalog has "Bb7", or vice-versa
  const slashIdx = normalized.indexOf('/')
  const basePart = slashIdx !== -1 ? normalized.slice(0, slashIdx) : normalized
  const bassPart = slashIdx !== -1 ? normalized.slice(slashIdx + 1) : null

  // Extract root and quality
  const rootMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(basePart)
  if (rootMatch) {
    const root = rootMatch[1].toLowerCase()
    const qual = rootMatch[2]
    const aliasRoot = ENHARMONIC_ROOT_ALIASES[root]
    if (aliasRoot) {
      let candidateKey = `${aliasRoot}${qual}`
      if (bassPart) {
        const bassMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(bassPart)
        if (bassMatch) {
          const bassRoot = bassMatch[1].toLowerCase()
          const bassQual = bassMatch[2]
          const aliasBass = ENHARMONIC_ROOT_ALIASES[bassRoot] || bassRoot
          candidateKey = `${candidateKey}/${aliasBass}${bassQual}`
        } else {
          candidateKey = `${candidateKey}/${bassPart}`
        }
      }
      const aliasVoicing = chordMap.get(candidateKey.toLowerCase())
      if (aliasVoicing) {
        // Return voicing labeled with requested chord name for consistency
        return {
          ...aliasVoicing,
          chord: clean,
        }
      }
    }
  }

  return null
}
