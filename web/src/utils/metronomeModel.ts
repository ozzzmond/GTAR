/**
 * Metronome model: tempo, meters, accents, split ears and saved settings.
 * Pure data and math, no audio or DOM, so it can be tested with a fake clock.
 *
 * Time is kept on a sixteenth-note grid: every click position is a whole number of
 * sixteenths from bar 1. BPM always counts quarter notes.
 */

export const MIN_BPM = 30
export const MAX_BPM = 300
export const DEFAULT_BPM = 120

/** Grid resolution: sixteenths per quarter note. */
export const GRID_PER_QUARTER = 4

export type TimeSignature = '2/4' | '3/4' | '4/4' | '6/8'
export const TIME_SIGNATURES: readonly TimeSignature[] = ['2/4', '3/4', '4/4', '6/8']

export type NoteValue = 'quarter' | 'eighth' | 'sixteenth'
export const NOTE_VALUES: readonly NoteValue[] = ['quarter', 'eighth', 'sixteenth']

export type SoundId = 'beep' | 'wood' | 'tick' | 'snap'
export const SOUND_IDS: readonly SoundId[] = ['beep', 'wood', 'tick', 'snap']

export type Accent = 'accent' | 'normal' | 'silent'
export type EarSide = 'left' | 'right'

interface Meter {
  /** Lights and count clicks per bar. */
  counts: number
  /** What one count is: quarter in simple meters, eighth in 6/8. */
  countNote: NoteValue
  /** Counts per main-beat group: 6/8 is 3 + 3. */
  groups: readonly number[]
}

export const METERS: Record<TimeSignature, Meter> = {
  '2/4': { counts: 2, countNote: 'quarter', groups: [2] },
  '3/4': { counts: 3, countNote: 'quarter', groups: [3] },
  '4/4': { counts: 4, countNote: 'quarter', groups: [4] },
  '6/8': { counts: 6, countNote: 'eighth', groups: [3, 3] },
}

const NOTES_PER_QUARTER: Record<NoteValue, number> = { quarter: 1, eighth: 2, sixteenth: 4 }

export interface EarSettings {
  note: NoteValue
  sound: SoundId
  volume: number
  muted: boolean
}

export interface MetronomeSettings {
  bpm: number
  timeSignature: TimeSignature
  /** Per time signature, one entry per count. */
  accents: Record<TimeSignature, Accent[]>
  countIn: boolean
  /** Lights only: the scheduler and beat lights run, no sound. */
  isMuted: boolean
  /** Simple view uses sound and volume for both ears. Split view uses each ear's settings. */
  split: boolean
  sound: SoundId
  volume: number
  ears: Record<EarSide, EarSettings>
}

export function clampBpm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BPM
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)))
}

export function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100))
}

export function countsPerBar(timeSignature: TimeSignature): number {
  return METERS[timeSignature].counts
}

/** Grid steps (sixteenths) in one count. Quarter counts are 4, eighth counts are 2. */
export function sixteenthsPerCount(timeSignature: TimeSignature): number {
  return GRID_PER_QUARTER / NOTES_PER_QUARTER[METERS[timeSignature].countNote]
}

export function sixteenthsPerBar(timeSignature: TimeSignature): number {
  return sixteenthsPerCount(timeSignature) * METERS[timeSignature].counts
}

/** Grid steps (sixteenths) between two clicks of a note value. */
export function sixteenthsPerNote(note: NoteValue): number {
  return GRID_PER_QUARTER / NOTES_PER_QUARTER[note]
}

export function secondsPerSixteenth(bpm: number): number {
  return 60 / bpm / GRID_PER_QUARTER
}

/** Count indexes (0-based) where a main-beat group starts. */
export function groupStarts(timeSignature: TimeSignature): number[] {
  const starts: number[] = []
  let at = 0
  for (const size of METERS[timeSignature].groups) {
    starts.push(at)
    at += size
  }
  return starts
}

export function defaultAccents(timeSignature: TimeSignature): Accent[] {
  const starts = new Set(groupStarts(timeSignature))
  return Array.from({ length: countsPerBar(timeSignature) }, (_, index) => (starts.has(index) ? 'accent' : 'normal'))
}

/** Tap order: accent -> normal -> silent -> accent. */
export function nextAccent(accent: Accent): Accent {
  if (accent === 'accent') return 'normal'
  if (accent === 'normal') return 'silent'
  return 'accent'
}

export function defaultSettings(): MetronomeSettings {
  return {
    bpm: DEFAULT_BPM,
    timeSignature: '4/4',
    accents: {
      '2/4': defaultAccents('2/4'),
      '3/4': defaultAccents('3/4'),
      '4/4': defaultAccents('4/4'),
      '6/8': defaultAccents('6/8'),
    },
    countIn: false,
    isMuted: false,
    split: false,
    sound: 'wood',
    volume: 0.9,
    ears: {
      left: { note: 'quarter', sound: 'wood', volume: 0.9, muted: false },
      right: { note: 'eighth', sound: 'tick', volume: 0.6, muted: false },
    },
  }
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function sanitizeEar(raw: unknown, fallback: EarSettings): EarSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    note: pick(source.note, NOTE_VALUES, fallback.note),
    sound: pick(source.sound, SOUND_IDS, fallback.sound),
    volume: clampVolume(source.volume, fallback.volume),
    muted: typeof source.muted === 'boolean' ? source.muted : fallback.muted,
  }
}

/** Reads saved settings defensively: anything unknown or malformed falls back to the default. */
export function sanitizeSettings(raw: unknown): MetronomeSettings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const source = raw as Record<string, unknown>
  const accents = { ...base.accents }
  const savedAccents = (source.accents && typeof source.accents === 'object' ? source.accents : {}) as Record<string, unknown>
  for (const ts of TIME_SIGNATURES) {
    const saved = savedAccents[ts]
    if (!Array.isArray(saved) || saved.length !== countsPerBar(ts)) continue
    accents[ts] = saved.map((value, index) => pick(value, ['accent', 'normal', 'silent'] as const, defaultAccents(ts)[index]))
  }
  const savedEars = (source.ears && typeof source.ears === 'object' ? source.ears : {}) as Record<string, unknown>
  return {
    bpm: typeof source.bpm === 'number' ? clampBpm(source.bpm) : base.bpm,
    timeSignature: pick(source.timeSignature, TIME_SIGNATURES, base.timeSignature),
    accents,
    countIn: typeof source.countIn === 'boolean' ? source.countIn : base.countIn,
    isMuted: typeof source.isMuted === 'boolean' ? source.isMuted : base.isMuted,
    split: typeof source.split === 'boolean' ? source.split : base.split,
    sound: pick(source.sound, SOUND_IDS, base.sound),
    volume: clampVolume(source.volume, base.volume),
    ears: {
      left: sanitizeEar(savedEars.left, base.ears.left),
      right: sanitizeEar(savedEars.right, base.ears.right),
    },
  }
}
