import type { NoteSpelling, PitchSpec } from './tunerMath'

export type TunerInstrument = 'guitar' | 'bass' | 'ukulele'

export interface TunerPreset {
  id: string
  instrument: TunerInstrument
  name: string
  /** Strings in the order listed by the preset. */
  strings: readonly PitchSpec[]
}

export const INSTRUMENT_LABELS: Readonly<Record<TunerInstrument, string>> = {
  guitar: 'Guitar',
  bass: 'Bass',
  ukulele: 'Ukulele',
}

const p = (note: NoteSpelling, octave: number): PitchSpec => ({ note, octave })

export const TUNER_PRESETS: readonly TunerPreset[] = [
  { id: 'guitar-standard', instrument: 'guitar', name: 'Standard', strings: [p('E', 2), p('A', 2), p('D', 3), p('G', 3), p('B', 3), p('E', 4)] },
  { id: 'guitar-half-step-down', instrument: 'guitar', name: 'Half step down', strings: [p('Eb', 2), p('Ab', 2), p('Db', 3), p('Gb', 3), p('Bb', 3), p('Eb', 4)] },
  { id: 'guitar-full-step-down', instrument: 'guitar', name: 'Full step down', strings: [p('D', 2), p('G', 2), p('C', 3), p('F', 3), p('A', 3), p('D', 4)] },
  { id: 'guitar-drop-d', instrument: 'guitar', name: 'Drop D', strings: [p('D', 2), p('A', 2), p('D', 3), p('G', 3), p('B', 3), p('E', 4)] },
  { id: 'guitar-dadgad', instrument: 'guitar', name: 'DADGAD', strings: [p('D', 2), p('A', 2), p('D', 3), p('G', 3), p('A', 3), p('D', 4)] },
  { id: 'guitar-open-g', instrument: 'guitar', name: 'Open G', strings: [p('D', 2), p('G', 2), p('D', 3), p('G', 3), p('B', 3), p('D', 4)] },
  { id: 'guitar-open-d', instrument: 'guitar', name: 'Open D', strings: [p('D', 2), p('A', 2), p('D', 3), p('F#', 3), p('A', 3), p('D', 4)] },
  { id: 'guitar-open-c', instrument: 'guitar', name: 'Open C', strings: [p('C', 2), p('G', 2), p('C', 3), p('G', 3), p('C', 4), p('E', 4)] },
  { id: 'guitar-open-e', instrument: 'guitar', name: 'Open E', strings: [p('E', 2), p('B', 2), p('E', 3), p('G#', 3), p('B', 3), p('E', 4)] },
  { id: 'guitar-open-a', instrument: 'guitar', name: 'Open A', strings: [p('E', 2), p('A', 2), p('E', 3), p('A', 3), p('C#', 4), p('E', 4)] },
  { id: 'bass-4-string', instrument: 'bass', name: '4-string', strings: [p('E', 1), p('A', 1), p('D', 2), p('G', 2)] },
  { id: 'bass-5-string', instrument: 'bass', name: '5-string', strings: [p('B', 0), p('E', 1), p('A', 1), p('D', 2), p('G', 2)] },
  { id: 'ukulele-standard', instrument: 'ukulele', name: 'Standard', strings: [p('G', 4), p('C', 4), p('E', 4), p('A', 4)] },
]

export const DEFAULT_PRESET_ID = 'guitar-standard'

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'] as const

export function findPreset(id: string): TunerPreset {
  return TUNER_PRESETS.find((preset) => preset.id === id) ?? TUNER_PRESETS[0]
}

/** Reference label such as "E2 (6th)"; the string number counts from the last listed string down to the first. */
export function stringLabel(strings: readonly PitchSpec[], index: number): string {
  const spec = strings[index]
  const number = strings.length - index
  return `${spec.note}${spec.octave} (${ORDINALS[number - 1] ?? `${number}th`})`
}
