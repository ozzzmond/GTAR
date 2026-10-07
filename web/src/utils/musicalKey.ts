// Pitch class mapping (0-11) for comparison
export const PITCH_CLASSES: Record<string, number> = {
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

// Canonical display roots: preserves flats (Bb, Eb, Ab, Db, Gb, Cb) and sharps (C#, D#, F#, G#, A#)
// Standardizes casing and esoteric forms (e.g. B# -> C, E# -> F, Fb -> E)
const standardRoots: Record<string, string> = {
  C: 'C', 'B#': 'C',
  'C#': 'C#', Db: 'Db',
  D: 'D',
  'D#': 'D#', Eb: 'Eb',
  E: 'E', Fb: 'E',
  'E#': 'F', F: 'F',
  'F#': 'F#', Gb: 'Gb',
  G: 'G',
  'G#': 'G#', Ab: 'Ab',
  A: 'A',
  'A#': 'A#', Bb: 'Bb',
  B: 'B', Cb: 'Cb',
}

// null means unsupported input; empty metadata remains supported.
export function normalizeMusicalKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (!value.trim()) return ''
  const match = /^([a-g])([#b]?)(m|min|maj)?$/i.exec(value.trim())
  if (!match) return null
  const rootKey = match[1].toUpperCase() + match[2].toLowerCase()
  const root = standardRoots[rootKey]
  if (!root) return null
  const suffix = match[3]?.toLowerCase()
  return root + (suffix === 'm' || suffix === 'min' ? 'm' : '')
}

export function canonicalSongKey(value: string): string {
  return normalizeMusicalKey(value) ?? ''
}

export function musicalKeyPitchClass(key: string): number | null {
  const norm = normalizeMusicalKey(key)
  if (!norm) return null
  const match = /^([A-G][#b]?)(m)?$/.exec(norm)
  if (!match) return null
  const root = match[1]
  return PITCH_CLASSES[root] ?? null
}

export function keysArePitchEquivalent(keyA: string, keyB: string): boolean {
  const normA = normalizeMusicalKey(keyA)
  const normB = normalizeMusicalKey(keyB)
  if (normA === null || normB === null) return false
  if (!normA && !normB) return true
  if (!normA || !normB) return false

  const isMinA = normA.endsWith('m')
  const isMinB = normB.endsWith('m')
  if (isMinA !== isMinB) return false

  const pcA = musicalKeyPitchClass(normA)
  const pcB = musicalKeyPitchClass(normB)
  return pcA !== null && pcB !== null && pcA === pcB
}
