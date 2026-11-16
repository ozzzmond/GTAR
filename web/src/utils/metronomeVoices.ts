import type { SoundId } from './metronomeModel'

/** The Web Audio surface the metronome uses. Tests pass a fake that implements only this. */
export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike, output?: number, input?: number): unknown
  disconnect(): unknown
}

export interface GainLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface SourceLike extends AudioNodeLike {
  start(when?: number): void
  stop(when?: number): void
}

export interface OscillatorLike extends SourceLike {
  type: string
  frequency: AudioParamLike
}

export interface AudioContextLike {
  state: string
  currentTime: number
  sampleRate: number
  destination: AudioNodeLike
  resume(): Promise<void> | void
  createOscillator(): OscillatorLike
  createGain(): GainLike
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(channel: number): Float32Array }
  createBufferSource(): SourceLike & { buffer: unknown }
  createBiquadFilter(): AudioNodeLike & { type: string; frequency: AudioParamLike }
  createChannelMerger(inputs: number): AudioNodeLike
}

export interface VoiceHandle {
  /** Stops the click at `when` (now, to cut it). A click that has not started yet never sounds. */
  stop(when: number): void
}

interface Tone {
  type: OscillatorType
  high: number
  low: number
  duration: number
  /** Pitch drop by the end of the click, as a fraction of the start pitch. */
  drop: number
}

const TONES: Record<Exclude<SoundId, 'snap'>, Tone> = {
  beep: { type: 'sine', high: 1320, low: 880, duration: 0.05, drop: 1 },
  wood: { type: 'triangle', high: 1200, low: 800, duration: 0.05, drop: 0.55 },
  tick: { type: 'square', high: 3200, low: 2400, duration: 0.02, drop: 1 },
}

const SNAP_DURATION = 0.025

/**
 * Plays one synthesized click into every output, starting at `when` on the audio clock.
 * Returns null when the click could not be built, so one bad node never stops the scheduler.
 */
export function playClick(
  ctx: AudioContextLike,
  outputs: AudioNodeLike[],
  when: number,
  sound: SoundId,
  level: number,
  high: boolean,
): VoiceHandle | null {
  if (!(level > 0)) return null
  try {
    const gain = ctx.createGain()
    const peak = Math.max(0.0002, Math.min(1, level))
    gain.gain.setValueAtTime(0.0001, when)
    for (const output of outputs) gain.connect(output)

    if (sound === 'snap') {
      const duration = SNAP_DURATION
      const length = Math.max(1, Math.round(ctx.sampleRate * duration))
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = high ? 3000 : 2000
      source.connect(filter)
      filter.connect(gain)
      gain.gain.exponentialRampToValueAtTime(peak, when + 0.002)
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
      source.start(when)
      source.stop(when + duration + 0.01)
      return { stop: at => stopSource(source, gain, at) }
    }

    const tone = TONES[sound]
    const osc = ctx.createOscillator()
    osc.type = tone.type
    const start = high ? tone.high : tone.low
    osc.frequency.setValueAtTime(start, when)
    osc.frequency.exponentialRampToValueAtTime(start * tone.drop, when + tone.duration)
    osc.connect(gain)
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.003)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + tone.duration)
    osc.start(when)
    osc.stop(when + tone.duration + 0.01)
    return { stop: at => stopSource(osc, gain, at) }
  } catch {
    return null
  }
}

function stopSource(source: SourceLike, gain: GainLike, at: number): void {
  try { source.stop(at) } catch { /* Already stopped or never started. */ }
  try { gain.disconnect() } catch { /* Already disconnected. */ }
}
