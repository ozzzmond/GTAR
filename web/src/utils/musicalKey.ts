const roots: Record<string, string> = {
  C: 'C', 'B#': 'C', 'C#': 'C#', Db: 'C#', D: 'D', 'D#': 'D#', Eb: 'D#',
  E: 'E', Fb: 'E', 'E#': 'F', F: 'F', 'F#': 'F#', Gb: 'F#', G: 'G',
  'G#': 'G#', Ab: 'G#', A: 'A', 'A#': 'A#', Bb: 'A#', B: 'B', Cb: 'B',
}

// null means unsupported input; empty metadata remains supported.
export function normalizeMusicalKey(value: string): string | null {
  if (!value.trim()) return ''
  const match = /^([a-g])([#b]?)(m|min|maj)?$/i.exec(value.trim())
  if (!match) return null
  const root = roots[match[1].toUpperCase() + match[2].toLowerCase()]
  if (!root) return null
  const suffix = match[3]?.toLowerCase()
  return root + (suffix === 'm' || suffix === 'min' ? 'm' : '')
}

export function canonicalSongKey(value: string): string {
  return normalizeMusicalKey(value) ?? ''
}
