/**
 * Reference tones for the Tuner: one string sounds at a time until it is tapped again or stopped.
 * Frequencies come from the preset data (tunerPresets.ts, tunerMath.ts), never hardcoded here.
 */
class TunerTone {
  private audioCtx: AudioContext | null = null
  private osc: OscillatorNode | null = null
  private active: string | null = null
  private listeners = new Set<() => void>()

  getActive = () => this.active
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private setActive(name: string | null) {
    if (this.active === name) return
    this.active = name
    for (const listener of this.listeners) listener()
  }

  private silence() {
    const osc = this.osc
    this.osc = null
    if (!osc) return
    try {
      osc.stop()
      osc.disconnect()
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
  }

  /** Plays the string's tone; tapping the sounding string stops it. */
  toggle(name: string, freq: number) {
    const wasActive = this.active === name
    this.silence()
    if (wasActive) { this.setActive(null); return }

    type AudioContextConstructor = typeof AudioContext
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
    if (!AudioContextClass) { this.setActive(null); return }
    const ctx = this.audioCtx ?? (this.audioCtx = new AudioContextClass())
    if (ctx.state === 'suspended') void ctx.resume()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, ctx.currentTime)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    this.osc = osc
    this.setActive(name)
  }

  /** Stops the tone; the audio output stays ready for the next tap. */
  stop() {
    this.silence()
    this.setActive(null)
  }

  /** Stops the tone and lets go of the audio output. */
  release() {
    this.stop()
    const ctx = this.audioCtx
    this.audioCtx = null
    try { void ctx?.close()?.catch(() => {}) } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
  }
}

export const tunerTone = new TunerTone()
