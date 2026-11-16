/**
 * Metronome engine for GTAR Stage.
 *
 * Web Audio lookahead scheduler: a timer wakes every 25 ms and places clicks up to 150 ms ahead
 * on the AudioContext clock. Beat lights are fired from the same schedule, at the moment the
 * click sounds, so they stay in step with the audio. Nothing starts without a user tap: the
 * AudioContext is created by start() only.
 */
import {
  clampBpm,
  clampVolume,
  countsPerBar,
  nextAccent,
  sanitizeEar,
  sanitizeSettings,
  secondsPerSixteenth,
  sixteenthsPerBar,
  sixteenthsPerCount,
  sixteenthsPerNote,
  SOUND_IDS,
  TIME_SIGNATURES,
  type Accent,
  type EarSettings,
  type EarSide,
  type MetronomeSettings,
  type SoundId,
  type TimeSignature,
} from './metronomeModel'
import { playClick, type AudioContextLike, type AudioNodeLike, type VoiceHandle } from './metronomeVoices'

export type {
  Accent,
  EarSettings,
  EarSide,
  MetronomeSettings,
  NoteValue,
  SoundId,
  TimeSignature,
} from './metronomeModel'

export interface MetronomeState extends MetronomeSettings {
  isRunning: boolean
  /** Counts per bar of the current time signature. */
  beatsPerBar: number
  /** 1-indexed count that last lit. */
  currentBeat: number
  /** True while the count-in bar is playing. */
  countingIn: boolean
}

export interface BeatDetail {
  accent: Accent
  countingIn: boolean
  timeSignature: TimeSignature
}

/** Fired at the scheduled moment: `beat` is 1-indexed, `isAccented` is true for accent clicks. */
export type BeatCallback = (beat: number, isAccented: boolean, detail: BeatDetail) => void

export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Everything the engine touches from the outside. Tests replace it with a fake clock. */
export interface MetronomeDeps {
  createContext(): AudioContextLike | null
  /** Fallback clock in seconds, used only when there is no AudioContext. */
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(id: unknown): void
  storage(): SettingsStorage | null
  onVisible(callback: () => void): () => void
}

export const METRONOME_STORAGE_KEY = 'gtar_metronome_v2'
export const SCHEDULER_TICK_MS = 25
export const LOOKAHEAD_S = 0.15
const START_DELAY_S = 0.05
const NORMAL_LEVEL = 0.6
const SUBDIVISION_LEVEL = 0.35
const EAR_SIDES: readonly EarSide[] = ['left', 'right']

interface Voice {
  start: number
  handle: VoiceHandle
}

interface Beat {
  time: number
  beat: number
  accent: Accent
  countingIn: boolean
  timeSignature: TimeSignature
}

interface Outputs {
  left: AudioNodeLike
  right: AudioNodeLike
}

const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor

const levelFor = (accent: Accent): number => (accent === 'accent' ? 1 : NORMAL_LEVEL)

function cloneSettings(source: MetronomeSettings): MetronomeSettings {
  return {
    ...source,
    accents: Object.fromEntries(TIME_SIGNATURES.map(ts => [ts, [...source.accents[ts]]])) as MetronomeSettings['accents'],
    ears: { left: { ...source.ears.left }, right: { ...source.ears.right } },
  }
}

function readStored(deps: MetronomeDeps): unknown {
  try {
    const raw = deps.storage()?.getItem(METRONOME_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function buildOutputs(ctx: AudioContextLike): Outputs | null {
  try {
    const merger = ctx.createChannelMerger(2)
    const left = ctx.createGain()
    const right = ctx.createGain()
    left.connect(merger, 0, 0)
    right.connect(merger, 0, 1)
    merger.connect(ctx.destination)
    return { left, right }
  } catch {
    return null
  }
}

function browserDeps(): MetronomeDeps {
  return {
    createContext() {
      const host = globalThis as unknown as {
        AudioContext?: new () => AudioContextLike
        webkitAudioContext?: new () => AudioContextLike
      }
      const Ctor = host.AudioContext ?? host.webkitAudioContext
      if (!Ctor) return null
      try {
        return new Ctor()
      } catch {
        return null
      }
    },
    now: () => performance.now() / 1000,
    setTimer: (callback, ms) => setInterval(callback, ms),
    clearTimer: id => clearInterval(id as ReturnType<typeof setInterval>),
    storage() {
      try {
        return typeof localStorage === 'undefined' ? null : localStorage
      } catch {
        return null
      }
    },
    onVisible(callback) {
      if (typeof document === 'undefined') return () => {}
      const handler = () => {
        if (document.visibilityState === 'visible') callback()
      }
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
  }
}

/**
 * Positions are whole sixteenths from bar 1 (negative during count-in). The clock maps a
 * position to a time through an anchor, so a tempo change re-anchors and keeps the bar position.
 */
export class MetronomeEngine {
  private settings: MetronomeSettings
  private running = false
  private ctx: AudioContextLike | null = null
  private contextTried = false
  private outputs: Outputs | null = null
  private timerId: unknown = null
  private anchorTime = 0
  private anchorPos = 0
  private nextPos = 0
  private voices: Voice[] = []
  private beats: Beat[] = []
  private lit: { beat: number; countingIn: boolean } = { beat: 1, countingIn: false }
  private readonly listeners = new Set<(state: MetronomeState) => void>()
  private readonly beatListeners = new Set<BeatCallback>()
  private readonly deps: MetronomeDeps

  constructor(deps: MetronomeDeps = browserDeps()) {
    this.deps = deps
    this.settings = sanitizeSettings(readStored(deps))
    deps.onVisible(() => this.wake())
  }

  subscribe(listener: (state: MetronomeState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  onBeat(callback: BeatCallback): () => void {
    this.beatListeners.add(callback)
    return () => {
      this.beatListeners.delete(callback)
    }
  }

  getState(): MetronomeState {
    const s = this.settings
    return {
      ...cloneSettings(s),
      isRunning: this.running,
      beatsPerBar: countsPerBar(s.timeSignature),
      currentBeat: this.lit.beat,
      countingIn: this.lit.countingIn,
    }
  }

  /** Starts the scheduler. Called from a user tap only: this is where the AudioContext is created. */
  start(): void {
    if (this.running) {
      this.wake()
      return
    }
    this.ensureContext()
    const startPos = this.settings.countIn ? -sixteenthsPerBar(this.settings.timeSignature) : 0
    const now = this.clockNow()
    this.running = true
    this.anchorTime = now + START_DELAY_S
    this.anchorPos = startPos
    this.nextPos = startPos
    this.voices = []
    this.beats = []
    this.lit = { beat: 1, countingIn: startPos < 0 }
    this.clearTimer()
    this.timerId = this.deps.setTimer(() => this.tick(), SCHEDULER_TICK_MS)
    this.emit()
    this.tick()
  }

  /** Stops the scheduler and cancels every click that has not sounded yet. */
  stop(): void {
    this.clearTimer()
    const now = this.clockNow()
    for (const voice of this.voices) voice.handle.stop(now)
    this.voices = []
    this.beats = []
    this.running = false
    this.lit = { beat: 1, countingIn: false }
    this.emit()
  }

  toggle(): void {
    if (this.running) this.stop()
    else this.start()
  }

  /** Call from a user tap: resumes a suspended AudioContext while the metronome runs. */
  unlock(): void {
    if (this.running && this.ctx && this.ctx.state === 'suspended') this.resumeContext()
  }

  setBpm(value: number): void {
    if (!Number.isFinite(value)) return
    const bpm = clampBpm(value)
    if (bpm === this.settings.bpm) return
    this.change(s => {
      s.bpm = bpm
    }, true)
  }

  setTimeSignature(timeSignature: TimeSignature): void {
    if (!TIME_SIGNATURES.includes(timeSignature) || timeSignature === this.settings.timeSignature) return
    if (this.running) {
      const bar = sixteenthsPerBar(timeSignature)
      this.rebase(this.clockNow(), () => {
        this.settings.timeSignature = timeSignature
      })
      // The new meter starts on its own bar line.
      this.nextPos = Math.ceil(this.nextPos / bar) * bar
      this.save()
      this.emit()
    } else {
      this.change(s => {
        s.timeSignature = timeSignature
      })
    }
  }

  /** Accent -> normal -> silent -> accent for one count of the current time signature. */
  cycleAccent(index: number): void {
    const ts = this.settings.timeSignature
    if (!Number.isInteger(index) || index < 0 || index >= this.settings.accents[ts].length) return
    this.change(s => {
      s.accents[ts][index] = nextAccent(s.accents[ts][index])
    })
  }

  setCountIn(countIn: boolean): void {
    this.change(s => {
      s.countIn = countIn
    })
  }

  /** Lights only when muted: the scheduler and beat lights keep running, no sound. */
  toggleMute(): void {
    this.change(s => {
      s.isMuted = !s.isMuted
    })
    if (this.running && this.settings.isMuted) this.cancelFrom(this.clockNow())
  }

  setSplit(split: boolean): void {
    this.change(s => {
      s.split = split
    })
  }

  setSound(sound: SoundId): void {
    if (!SOUND_IDS.includes(sound)) return
    this.change(s => {
      s.sound = sound
    })
  }

  setVolume(volume: number): void {
    this.change(s => {
      s.volume = clampVolume(volume, s.volume)
    })
  }

  setEar(side: EarSide, patch: Partial<EarSettings>): void {
    this.change(s => {
      s.ears[side] = sanitizeEar({ ...s.ears[side], ...patch }, s.ears[side])
    })
  }

  private change(mutate: (s: MetronomeSettings) => void, retime = false): void {
    if (this.running && retime) this.rebase(this.clockNow(), () => mutate(this.settings))
    else mutate(this.settings)
    this.save()
    this.emit()
  }

  private save(): void {
    try {
      this.deps.storage()?.setItem(METRONOME_STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      // Storage unavailable: the settings last for this page view only.
    }
  }

  private emit(): void {
    if (this.listeners.size === 0) return
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      this.deps.clearTimer(this.timerId)
      this.timerId = null
    }
  }

  private ensureContext(): void {
    if (!this.ctx && !this.contextTried) {
      this.contextTried = true
      try {
        this.ctx = this.deps.createContext()
      } catch {
        this.ctx = null
      }
      if (this.ctx) this.outputs = buildOutputs(this.ctx)
    }
    if (this.ctx && this.ctx.state === 'suspended') this.resumeContext()
  }

  private resumeContext(): void {
    const ctx = this.ctx
    if (!ctx) return
    try {
      Promise.resolve(ctx.resume()).then(
        () => {
          if (this.running && ctx.state === 'running') this.wake()
        },
        () => {
          // Refused without a user gesture: the next tap calls unlock() again.
        },
      )
    } catch {
      // Audio unavailable: the lights keep running.
    }
  }

  /** After a background period or a suspended context: re-anchor on the current position. */
  private wake(): void {
    if (!this.running) return
    if (this.ctx && this.ctx.state === 'suspended') {
      this.resumeContext()
      return
    }
    this.rebase(this.clockNow())
    this.tick()
  }

  private clockNow(): number {
    return this.ctx ? this.ctx.currentTime : this.deps.now()
  }

  private posAt(time: number): number {
    return this.anchorPos + (time - this.anchorTime) / secondsPerSixteenth(this.settings.bpm)
  }

  private timeOf(pos: number): number {
    return this.anchorTime + (pos - this.anchorPos) * secondsPerSixteenth(this.settings.bpm)
  }

  /** Re-anchors at `now`, keeps the bar position, and drops everything not yet sounded. */
  private rebase(now: number, mutate?: () => void): void {
    const pos = this.posAt(now)
    mutate?.()
    this.anchorTime = now
    this.anchorPos = pos
    this.cancelFrom(now)
    this.beats = this.beats.filter(beat => beat.time <= now)
    this.nextPos = Math.floor(pos) + 1
  }

  private cancelFrom(now: number): void {
    this.voices = this.voices.filter(voice => {
      if (voice.start > now) {
        voice.handle.stop(now)
        return false
      }
      return true
    })
  }

  private tick(): void {
    if (!this.running) return
    if (this.ctx && this.ctx.state === 'suspended') return
    const now = this.clockNow()
    // A late timer (throttled or suspended) never schedules into the past.
    if (this.timeOf(this.nextPos) < now) this.nextPos = Math.floor(this.posAt(now)) + 1
    const horizon = now + LOOKAHEAD_S
    while (this.timeOf(this.nextPos) < horizon) {
      this.scheduleAt(this.nextPos)
      this.nextPos += 1
    }
    this.voices = this.voices.filter(voice => voice.start + 1 >= now)
    this.flush(now)
  }

  /** Fires beat lights and callbacks whose scheduled time has arrived. */
  private flush(now: number): void {
    let changed = false
    for (let beat = this.beats[0]; beat && beat.time <= now; beat = this.beats[0]) {
      this.beats.shift()
      this.lit = { beat: beat.beat, countingIn: beat.countingIn }
      changed = true
      const detail: BeatDetail = { accent: beat.accent, countingIn: beat.countingIn, timeSignature: beat.timeSignature }
      for (const callback of this.beatListeners) callback(beat.beat, beat.accent === 'accent', detail)
    }
    if (changed) this.emit()
  }

  private scheduleAt(pos: number): void {
    const s = this.settings
    const ts = s.timeSignature
    const offset = mod(pos, sixteenthsPerBar(ts))
    const perCount = sixteenthsPerCount(ts)
    const isCount = offset % perCount === 0
    const index = isCount ? offset / perCount : -1
    const countingIn = pos < 0
    const time = this.timeOf(pos)
    const accent: Accent = isCount ? s.accents[ts][index] : 'normal'
    if (isCount) this.beats.push({ time, beat: index + 1, accent, countingIn, timeSignature: ts })
    if (s.isMuted || !this.ctx) return

    // Simple view and count-in: one click per count, the same for both ears.
    if (countingIn || !s.split) {
      if (isCount && accent !== 'silent') {
        this.click(this.route('center'), s.sound, s.volume * levelFor(accent), accent === 'accent', time)
      }
      return
    }

    // Split view: each ear has its own note value. A silent count drops only its own click;
    // the subdivisions of that count still sound.
    for (const side of EAR_SIDES) {
      const ear = s.ears[side]
      if (ear.muted || pos % sixteenthsPerNote(ear.note) !== 0) continue
      if (isCount) {
        if (accent === 'silent') continue
        this.click(this.route(side), ear.sound, ear.volume * levelFor(accent), accent === 'accent', time)
      } else {
        this.click(this.route(side), ear.sound, ear.volume * SUBDIVISION_LEVEL, false, time)
      }
    }
  }

  private route(side: EarSide | 'center'): AudioNodeLike[] {
    const ctx = this.ctx
    if (!ctx) return []
    if (!this.outputs) return [ctx.destination]
    if (side === 'center') return [this.outputs.left, this.outputs.right]
    return [this.outputs[side]]
  }

  private click(outputs: AudioNodeLike[], sound: SoundId, level: number, high: boolean, time: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const handle = playClick(ctx, outputs, time, sound, level, high)
    if (handle) this.voices.push({ start: time, handle })
  }
}

export const metronome = new MetronomeEngine()
