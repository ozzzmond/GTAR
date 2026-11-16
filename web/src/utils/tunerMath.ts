/** Pure pitch math for the Tuner: equal temperament, cents, the A4 reference and its saved setting. */

export type NoteSpelling =
  | 'C' | 'C#' | 'Db' | 'D' | 'D#' | 'Eb' | 'E' | 'F' | 'F#' | 'Gb' | 'G' | 'G#' | 'Ab' | 'A' | 'A#' | 'Bb' | 'B'

export interface PitchSpec {
  note: NoteSpelling
  octave: number
}

export type TuningMode = 'auto' | 'preset'

export interface TuningReading {
  /** Note name (Auto) or target string label (Preset); empty when there is no signal. */
  headline: string
  /** Short musician-facing status: In tune, Flat, Sharp, Tune up, Tune down, Play a note. */
  status: string
  /** Cents from the target; null when there is no signal. Negative is flat. */
  cents: number | null
  inTune: boolean
  /** Text for the screen-reader live region. Changes only when the note or in-tune state changes. */
  announce: string
}

export const A4_DEFAULT_HZ = 440
export const A4_MIN_HZ = 400
export const A4_MAX_HZ = 480
export const IN_TUNE_CENTS = 5
export const A4_STORAGE_KEY = 'gtar_tuner_a4_v1'

const PITCH_CLASS: Record<NoteSpelling, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** MIDI note number; C4 is 60 and A4 is 69. */
export function midiOf(spec: PitchSpec): number {
  return (spec.octave + 1) * 12 + PITCH_CLASS[spec.note]
}

export function frequencyOfMidi(midi: number, a4: number = A4_DEFAULT_HZ): number {
  return a4 * 2 ** ((midi - 69) / 12)
}

export function frequencyOf(spec: PitchSpec, a4: number = A4_DEFAULT_HZ): number {
  return frequencyOfMidi(midiOf(spec), a4)
}

export function centsBetween(freq: number, target: number): number {
  return 1200 * Math.log2(freq / target)
}

/** Display and tone resolution: 0.01 Hz. */
export function roundHz(freq: number): number {
  return Math.round(freq * 100) / 100
}

export function clampA4(value: number): number {
  if (!Number.isFinite(value)) return A4_DEFAULT_HZ
  return Math.min(A4_MAX_HZ, Math.max(A4_MIN_HZ, Math.round(value)))
}

/** Nearest equal-tempered note to a frequency, spelled with sharps. */
export function nearestNote(freq: number, a4: number = A4_DEFAULT_HZ): { name: string; octave: number; cents: number } {
  const midi = Math.round(69 + 12 * Math.log2(freq / a4))
  const target = frequencyOfMidi(midi, a4)
  return {
    name: SHARP_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: centsBetween(freq, target),
  }
}

/** Index of the string closest in cents to the frequency, or -1 when there are no strings. */
export function nearestSpecIndex(freq: number, specs: readonly PitchSpec[], a4: number = A4_DEFAULT_HZ): number {
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  specs.forEach((spec, index) => {
    const distance = Math.abs(centsBetween(freq, frequencyOf(spec, a4)))
    if (distance < bestDistance) { bestDistance = distance; best = index }
  })
  return best
}

export function describeTuning(
  freq: number | null,
  mode: TuningMode,
  specs: readonly PitchSpec[],
  labels: readonly string[],
  a4: number = A4_DEFAULT_HZ,
): TuningReading {
  if (freq === null || !(freq > 0)) {
    return { headline: '', status: 'Play a note', cents: null, inTune: false, announce: '' }
  }
  const index = mode === 'preset' ? nearestSpecIndex(freq, specs, a4) : -1
  if (index < 0) {
    const note = nearestNote(freq, a4)
    const headline = `${note.name}${note.octave}`
    const inTune = Math.abs(note.cents) <= IN_TUNE_CENTS
    return {
      headline,
      status: inTune ? 'In tune' : note.cents < 0 ? 'Flat' : 'Sharp',
      cents: note.cents,
      inTune,
      announce: inTune ? `${headline}, in tune` : headline,
    }
  }
  const cents = centsBetween(freq, frequencyOf(specs[index], a4))
  const inTune = Math.abs(cents) <= IN_TUNE_CENTS
  const headline = labels[index] ?? ''
  return {
    headline,
    status: inTune ? 'In tune' : cents < 0 ? 'Tune up' : 'Tune down',
    cents,
    inTune,
    announce: inTune ? `${headline}, in tune` : headline,
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Saved A4 reference, or the default when nothing valid is saved or storage is blocked. */
export function readSavedA4(storage: Pick<Storage, 'getItem'> | null = browserStorage()): number {
  try {
    const raw = storage?.getItem(A4_STORAGE_KEY)
    if (raw === null || raw === undefined || raw.trim() === '') return A4_DEFAULT_HZ
    return clampA4(Number(raw))
  } catch {
    return A4_DEFAULT_HZ
  }
}

/** Saves the A4 reference locally. Returns false when storage is unavailable. */
export function saveA4(value: number, storage: Pick<Storage, 'setItem'> | null = browserStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(A4_STORAGE_KEY, String(clampA4(value)))
    return true
  } catch {
    return false
  }
}
