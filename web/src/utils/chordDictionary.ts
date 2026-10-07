/**
 * Guitar Chord Voicings Dictionary
 * Consolidated trusted guitar voicings and enharmonic alias resolution.
 */

import { NATURAL_CHORD_VOICINGS } from '../data/naturalChords'
import { ACCIDENTAL_CHORD_VOICINGS } from '../data/accidentalChords'
import { IMPORTED_CHORD_VOICINGS } from '../data/importedChords'

export type VoicingProvenance = 'CURATED_GTAR' | 'LICENSED_IMPORTED' | 'SONG_DEFINED'

export interface ChordVoicing {
  chord: string
  baseFret: number
  frets: number[] // -1 = muted/x, 0 = open, 1..n = fret number
  fingers?: number[] // 0 = none, 1 = index, 2 = middle, 3 = ring, 4 = pinky
  barres?: number[]
  source?: VoicingProvenance
  voicingIndex?: number
}

// Enharmonic alias pairs for root and bass lookups
export const ENHARMONIC_ROOT_ALIASES: Record<string, string> = {
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
  'e#': 'f',
  'b#': 'c',
  'cb': 'b',
  'fb': 'e',
}

// Curated GTAR voicings (hand-verified highest priority)
export const curatedChords: ChordVoicing[] = [
  ...NATURAL_CHORD_VOICINGS.map((v) => ({ ...v, source: 'CURATED_GTAR' as const })),
  ...ACCIDENTAL_CHORD_VOICINGS.map((v) => ({ ...v, source: 'CURATED_GTAR' as const })),
]

// Aggregate all trusted catalog entries
export const standardChords: ChordVoicing[] = [
  ...curatedChords,
  ...IMPORTED_CHORD_VOICINGS.map((v) => ({ ...v, source: 'LICENSED_IMPORTED' as const })),
]

// Primary default map (curated has precedence, then imported)
const chordMap = new Map<string, ChordVoicing>()
// Curated-only map for prioritized candidate lookups
const curatedMap = new Map<string, ChordVoicing>()
// Multi-voicing catalog: maps normalized chord name -> array of all trusted voicings
const multiVoicingMap = new Map<string, ChordVoicing[]>()

// Index imported first so curated can overwrite default voicing
for (const v of IMPORTED_CHORD_VOICINGS) {
  const key = v.chord.toLowerCase()
  if (!chordMap.has(key)) {
    chordMap.set(key, { ...v, source: 'LICENSED_IMPORTED' })
  }
  const existing = multiVoicingMap.get(key) || []
  existing.push({ ...v, source: 'LICENSED_IMPORTED' })
  multiVoicingMap.set(key, existing)
}

// Index curated (overwriting default voicing so GTAR hand-curated shapes take precedence)
for (const v of curatedChords) {
  const key = v.chord.toLowerCase()
  curatedMap.set(key, v)
  chordMap.set(key, v)
  const existing = multiVoicingMap.get(key) || []
  // Prepend curated voicing to multi-voicing list
  existing.unshift(v)
  multiVoicingMap.set(key, existing)
}

/**
 * Pure normalization layer: generates prioritized candidates for diagram lookup.
 * Resolves harmless notation wrappers, safe quality aliases, enharmonics,
 * and preserves slash-bass requirements without mutating song text or transpose logic.
 */
export function normalizeChordForVoicingLookup(chord: string): string[] {
  if (!chord || typeof chord !== 'string') return []
  const clean = chord.trim()
  if (!clean || clean.toLowerCase() === 'n.c.' || clean.toLowerCase() === 'nc') {
    return []
  }

  // Strip enclosing brackets/parentheses: "[Am7]" -> "Am7", "(Am7)" -> "Am7", "<Am7>" -> "Am7"
  let stripped = clean
  if (
    (stripped.startsWith('[') && stripped.endsWith(']')) ||
    (stripped.startsWith('(') && stripped.endsWith(')')) ||
    (stripped.startsWith('<') && stripped.endsWith('>'))
  ) {
    const inner = stripped.slice(1, -1).trim()
    if (inner) stripped = inner
  }

  const slashIdx = stripped.indexOf('/')
  const basePart = slashIdx !== -1 ? stripped.slice(0, slashIdx).trim() : stripped
  const bassPart = slashIdx !== -1 ? stripped.slice(slashIdx + 1).trim() : null

  const rootMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(basePart)
  if (!rootMatch) return [clean]

  const rootRaw = rootMatch[1]
  const rootCanonical = rootRaw.charAt(0).toUpperCase() + rootRaw.slice(1).toLowerCase()
  let qual = rootMatch[2].trim()

  // Strip inner parens: C(add9) -> Cadd9, F#m7(b5) -> F#m7b5
  qual = qual.replace(/\(([^)]+)\)/g, '$1')
  // Quality symbol and word normalizations
  qual = qual
    .replace(/major/i, 'maj')
    .replace(/minor/i, 'm')
    .replace(/Δ/g, 'maj7')
    .replace(/°/g, 'dim7')
    .replace(/ø/g, 'm7b5')

  if (qual === 'M' || qual === 'maj') qual = ''
  if (qual === 'min') qual = 'm'

  // Quality candidate variants
  const qualVariants: string[] = []
  if (qual === 'sus') {
    qualVariants.push('sus4', 'sus2')
  } else if (qual === '2') {
    qualVariants.push('2', 'add2', 'add9', 'sus2')
  } else if (qual === 'add2') {
    qualVariants.push('add2', 'add9', 'sus2')
  } else if (qual === 'add4') {
    qualVariants.push('add4', 'add11')
  } else if (qual === 'add11') {
    qualVariants.push('add11', 'add4')
  } else if (qual === 'madd9' || qual === 'm(add9)') {
    qualVariants.push('madd9', 'm9')
  } else {
    qualVariants.push(qual)
  }

  // Root variants (canonical + enharmonic)
  const rootVariants = [rootCanonical]
  const aliasRoot = ENHARMONIC_ROOT_ALIASES[rootCanonical.toLowerCase()]
  if (aliasRoot) {
    rootVariants.push(aliasRoot.charAt(0).toUpperCase() + aliasRoot.slice(1).toLowerCase())
  }

  // Bass variants (canonical + enharmonic)
  const bassVariants: string[] = []
  if (bassPart) {
    const bassMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(bassPart)
    if (bassMatch) {
      const bRoot = bassMatch[1].charAt(0).toUpperCase() + bassMatch[1].slice(1).toLowerCase()
      const bQual = bassMatch[2]
      bassVariants.push(bRoot + bQual)
      const aliasBass = ENHARMONIC_ROOT_ALIASES[bRoot.toLowerCase()]
      if (aliasBass) {
        bassVariants.push(aliasBass.charAt(0).toUpperCase() + aliasBass.slice(1).toLowerCase() + bQual)
      }
    } else {
      bassVariants.push(bassPart)
    }
  }

  const candidates: string[] = []
  const add = (c: string) => {
    if (!candidates.includes(c)) candidates.push(c)
  }

  // Priority 1: exact requested string and stripped form
  add(clean)
  if (stripped !== clean) add(stripped)

  // Priority 2: root/enharmonic + quality variants (+ bass/enharmonics)
  for (const r of rootVariants) {
    for (const q of qualVariants) {
      if (bassVariants.length > 0) {
        for (const b of bassVariants) {
          add(`${r}${q}/${b}`)
        }
      } else {
        add(`${r}${q}`)
      }
    }
  }

  // Priority 3: for slash chords with 2/add2/add9/sus, allow fallback to root/bass
  // Strictly preserving the requested bass note!
  if (
    bassVariants.length > 0 &&
    (qual === '2' || qual === 'add2' || qual === 'add9' || qual === 'sus' || qual === 'sus4')
  ) {
    for (const r of rootVariants) {
      for (const b of bassVariants) {
        add(`${r}/${b}`)
      }
    }
  }

  return candidates
}

/**
 * Resolves a trusted guitar voicing for a given chord name.
 * Precedence order:
 * SONG_DEFINED_VOICING -> GTAR_CURATED -> LICENSED_IMPORTED -> SAFE_ALIAS -> UNAVAILABLE (null)
 * 
 * Returns null if no trusted voicing exists (clean no-diagram state).
 */
export function getChordVoicing(
  chordName: string,
  songDefinitions?: Map<string, ChordVoicing> | Record<string, ChordVoicing>
): ChordVoicing | null {
  if (!chordName || typeof chordName !== 'string') return null
  const clean = chordName.trim()
  if (!clean || clean.toLowerCase() === 'n.c.' || clean.toLowerCase() === 'nc') {
    return null
  }

  // Precedence 1: Song-level defined voicing ({define: ...})
  if (songDefinitions) {
    const songMatch =
      songDefinitions instanceof Map
        ? songDefinitions.get(clean.toLowerCase())
        : songDefinitions[clean.toLowerCase()]
    if (songMatch) {
      return {
        ...songMatch,
        chord: clean,
        source: 'SONG_DEFINED',
      }
    }
  }

  const candidates = normalizeChordForVoicingLookup(clean)

  // Pass 1: Check curated GTAR hand-verified voicings across all candidates
  for (const candidate of candidates) {
    const curatedMatch = curatedMap.get(candidate.toLowerCase())
    if (curatedMatch) {
      return {
        ...curatedMatch,
        chord: clean, // Preserve requested chord label
      }
    }
  }

  // Pass 2: Check licensed imported voicings across candidates
  for (const candidate of candidates) {
    const match = chordMap.get(candidate.toLowerCase())
    if (match) {
      return {
        ...match,
        chord: clean, // Preserve requested chord label
      }
    }
  }

  return null
}

/**
 * Returns all trusted voicings available for a given chord identity.
 */
export function getAllChordVoicings(chordName: string): ChordVoicing[] {
  if (!chordName || typeof chordName !== 'string') return []
  const clean = chordName.trim()
  if (!clean || clean.toLowerCase() === 'n.c.' || clean.toLowerCase() === 'nc') {
    return []
  }

  const candidates = normalizeChordForVoicingLookup(clean)
  for (const candidate of candidates) {
    const matches = multiVoicingMap.get(candidate.toLowerCase())
    if (matches && matches.length > 0) {
      return matches.map((m, idx) => ({
        ...m,
        chord: clean,
        voicingIndex: idx,
      }))
    }
  }

  return []
}
