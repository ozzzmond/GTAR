import { estimatePitch, PitchTracker } from './tunerPitch'

/**
 * Tuner microphone. The mic opens only from start(), which the player triggers with a tap.
 * Pitch is read from an AnalyserNode on requestAnimationFrame (no AudioWorklet, so iOS Safari works).
 * stop() releases every track, closes the AudioContext and removes all listeners. Hidden tabs,
 * device changes, ended tracks and interrupted audio all stop it with a short message.
 */

export type TunerMicState = 'off' | 'starting' | 'listening' | 'denied' | 'no-mic' | 'unsupported' | 'error'

export interface TunerMicSnapshot {
  state: TunerMicState
  /** Short line for the player, or null. */
  message: string | null
  /** Smoothed pitch in Hz while sound is heard; null means the calm no-signal state. */
  frequency: number | null
}

/** Browser or test environment the mic runs in. Injected so the lifecycle can be tested without a device. */
export interface TunerEnv {
  mediaDevices: MediaDevices | undefined
  AudioContextClass: (new () => AudioContext) | undefined
  doc: Document | undefined
  requestFrame: (callback: () => void) => number
  cancelFrame: (id: number) => void
  now: () => number
}

export const TUNER_MIC_MESSAGES = {
  unsupported: 'The mic does not work in this browser.',
  denied: 'Mic access is off. Allow the mic in your browser settings.',
  noMic: 'No mic found. Plug one in, then tap Start.',
  error: 'Could not start the mic. Tap Start to try again.',
  trackEnded: 'The mic stopped. Tap Start to listen again.',
  deviceChanged: 'Audio device changed. Tap Start to listen again.',
  interrupted: 'Listening was interrupted. Tap Start to listen again.',
} as const

const FFT_SIZE = 4096
const ANALYSIS_INTERVAL_MS = 50
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
}
const IDLE: TunerMicSnapshot = { state: 'off', message: null, frequency: null }

type WindowWithWebkitAudio = typeof globalThis & { webkitAudioContext?: new () => AudioContext }

function browserEnv(): TunerEnv {
  const win = typeof window === 'undefined' ? undefined : (window as WindowWithWebkitAudio)
  return {
    mediaDevices: typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
    AudioContextClass: win?.AudioContext ?? win?.webkitAudioContext,
    doc: typeof document === 'undefined' ? undefined : document,
    requestFrame: (callback) => globalThis.requestAnimationFrame(() => callback()),
    cancelFrame: (id) => globalThis.cancelAnimationFrame(id),
    now: () => performance.now(),
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try { track.stop() } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
  }
}

function failureFor(error: unknown): TunerMicSnapshot {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { state: 'denied', message: TUNER_MIC_MESSAGES.denied, frequency: null }
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { state: 'no-mic', message: TUNER_MIC_MESSAGES.noMic, frequency: null }
  }
  return { state: 'error', message: TUNER_MIC_MESSAGES.error, frequency: null }
}

export class TunerMic {
  private snapshot: TunerMicSnapshot = IDLE
  private readonly listeners = new Set<() => void>()
  private readonly envFactory: () => TunerEnv
  private env: TunerEnv | null = null
  /** Bumped by every start and stop, so a stale getUserMedia result cannot revive the mic. */
  private session = 0
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private buffer: Float32Array<ArrayBuffer> | null = null
  private frameId: number | null = null
  private lastAnalysis = Number.NEGATIVE_INFINITY
  private tracker = new PitchTracker()
  private teardowns: Array<() => void> = []

  constructor(envFactory: () => TunerEnv = browserEnv) {
    this.envFactory = envFactory
  }

  getSnapshot = (): TunerMicSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(): Promise<void> {
    if (this.snapshot.state === 'starting' || this.snapshot.state === 'listening') return
    const env = this.envFactory()
    if (!env.mediaDevices?.getUserMedia || !env.AudioContextClass) {
      this.publish({ state: 'unsupported', message: TUNER_MIC_MESSAGES.unsupported, frequency: null })
      return
    }
    const session = ++this.session
    this.env = env

    // Created inside the tap so iOS Safari allows the context to run.
    let ctx: AudioContext
    try {
      ctx = new env.AudioContextClass()
    } catch {
      this.publish({ state: 'unsupported', message: TUNER_MIC_MESSAGES.unsupported, frequency: null })
      return
    }
    this.ctx = ctx
    ctx.resume().catch(() => { /* Resume may be refused; the analyser then reads silence. */ })
    this.publish({ state: 'starting', message: null, frequency: null })

    let stream: MediaStream
    try {
      stream = await env.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
    } catch (error) {
      if (session === this.session) {
        this.teardown()
        this.publish(failureFor(error))
      }
      return
    }
    if (session !== this.session) {
      stopTracks(stream)
      return
    }

    try {
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = FFT_SIZE
      source.connect(analyser)
      this.stream = stream
      this.source = source
      this.analyser = analyser
      this.buffer = new Float32Array(FFT_SIZE)
    } catch {
      stopTracks(stream)
      this.teardown()
      this.publish({ state: 'error', message: TUNER_MIC_MESSAGES.error, frequency: null })
      return
    }

    this.tracker = new PitchTracker()
    this.attach(env, stream, ctx)
    this.publish({ state: 'listening', message: null, frequency: null })
    this.schedule(session)
  }

  /** Releases the mic and audio context. A message explains an interruption. */
  stop(message: string | null = null): void {
    this.session += 1
    this.teardown()
    this.publish({ state: 'off', message, frequency: null })
  }

  private attach(env: TunerEnv, stream: MediaStream, ctx: AudioContext): void {
    const listen = (target: EventTarget | null | undefined, type: string, handler: () => void) => {
      if (!target) return
      target.addEventListener(type, handler)
      this.teardowns.push(() => target.removeEventListener(type, handler))
    }
    for (const track of stream.getTracks()) {
      listen(track, 'ended', () => this.stop(TUNER_MIC_MESSAGES.trackEnded))
    }
    listen(env.mediaDevices, 'devicechange', () => this.stop(TUNER_MIC_MESSAGES.deviceChanged))
    listen(env.doc, 'visibilitychange', () => {
      if (env.doc?.hidden) this.stop(null)
    })
    listen(ctx, 'statechange', () => {
      if ((ctx.state as string) === 'interrupted') this.stop(TUNER_MIC_MESSAGES.interrupted)
    })
  }

  private schedule(session: number): void {
    const env = this.env
    if (!env) return
    this.frameId = env.requestFrame(() => this.tick(session))
  }

  private tick(session: number): void {
    this.frameId = null
    const env = this.env
    if (!env || session !== this.session || !this.analyser || !this.buffer || !this.ctx) return
    const now = env.now()
    if (now - this.lastAnalysis >= ANALYSIS_INTERVAL_MS) {
      this.lastAnalysis = now
      this.analyser.getFloatTimeDomainData(this.buffer)
      const frequency = this.tracker.push(estimatePitch(this.buffer, this.ctx.sampleRate), now)
      if (frequency !== this.snapshot.frequency) this.publish({ ...this.snapshot, frequency })
    }
    this.schedule(session)
  }

  private teardown(): void {
    const env = this.env
    if (this.frameId !== null && env) env.cancelFrame(this.frameId)
    this.frameId = null
    const teardowns = this.teardowns
    this.teardowns = []
    for (const undo of teardowns) undo()
    try { this.source?.disconnect() } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    if (this.stream) stopTracks(this.stream)
    const ctx = this.ctx
    this.stream = null
    this.source = null
    this.analyser = null
    this.buffer = null
    this.ctx = null
    if (ctx) {
      try { ctx.close().catch(() => { /* Already closed. */ }) } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    }
    this.tracker.reset()
  }

  private publish(next: TunerMicSnapshot): void {
    const current = this.snapshot
    if (current.state === next.state && current.message === next.message && current.frequency === next.frequency) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

/** The app's single microphone. Panel close and switch OFF both call stop(). */
export const tunerMic = new TunerMic()
