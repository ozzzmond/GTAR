import { centsBetween } from './tunerMath'

/** Pure pitch detection (YIN difference function) for the Tuner. No dependencies, no AudioWorklet. */

export const PITCH_MIN_HZ = 25
export const PITCH_MAX_HZ = 2000
/** RMS below this is treated as silence (about -40 dBFS). */
export const SILENCE_RMS = 0.01
const YIN_THRESHOLD = 0.15
/** Reject when the best dip leaves less than this clarity (1 - YIN value). */
const CLARITY_FLOOR = 0.6

export interface PitchEstimate {
  frequency: number
  /** 0 to 1; higher means a cleaner periodic signal. */
  clarity: number
}

/**
 * YIN pitch estimate over a time-domain buffer. The integration window is half the buffer, so the
 * buffer must hold the window plus the longest lag (sampleRate / minHz). A 4096-sample buffer covers
 * 25 Hz at 44.1 or 48 kHz, which includes the 5-string bass B0 (about 30.9 Hz).
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  minHz: number = PITCH_MIN_HZ,
  maxHz: number = PITCH_MAX_HZ,
): PitchEstimate | null {
  const n = samples.length
  const window = Math.floor(n / 2)
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz))
  const tauMax = Math.min(Math.floor(sampleRate / minHz), n - window - 1)
  if (tauMax <= tauMin + 2) return null

  const difference = new Float64Array(tauMax + 1)
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0
    for (let j = 0; j < window; j++) {
      const delta = samples[j] - samples[j + tau]
      sum += delta * delta
    }
    difference[tau] = sum
  }

  // Cumulative mean normalized difference: flat at 1 for noise, near 0 at the period.
  const normalized = new Float64Array(tauMax + 1)
  normalized[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    running += difference[tau]
    normalized[tau] = running > 0 ? (difference[tau] * tau) / running : 1
  }

  // First dip under the threshold, walked down to its local minimum.
  let best = -1
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (normalized[tau] < YIN_THRESHOLD) {
      while (tau + 1 < tauMax && normalized[tau + 1] < normalized[tau]) tau++
      best = tau
      break
    }
  }
  if (best < 0) {
    let lowest = Number.POSITIVE_INFINITY
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (normalized[tau] < lowest) { lowest = normalized[tau]; best = tau }
    }
  }
  if (best < 0 || normalized[best] > 1 - CLARITY_FLOOR) return null

  // Parabolic interpolation around the minimum for sub-sample lag.
  const before = normalized[best - 1]
  const at = normalized[best]
  const after = normalized[best + 1]
  const curvature = before - 2 * at + after
  const offset = curvature > 0 ? Math.max(-1, Math.min(1, (before - after) / (2 * curvature))) : 0
  const frequency = sampleRate / (best + offset)
  if (!Number.isFinite(frequency) || frequency < minHz || frequency > maxHz) return null
  return { frequency, clarity: 1 - at }
}

export function rmsOf(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return samples.length ? Math.sqrt(sum / samples.length) : 0
}

/** Silence gate plus detection: the frequency in Hz, or null when quiet or unclear. */
export function estimatePitch(samples: Float32Array, sampleRate: number): number | null {
  if (rmsOf(samples) < SILENCE_RMS) return null
  return detectPitch(samples, sampleRate)?.frequency ?? null
}

/**
 * Smooths raw readings for a steady needle: median of the last five, then a log-frequency glide.
 * A jump larger than 100 cents restarts the glide. Holds the last value for a short time when a
 * frame is unclear, so the readout does not flicker, then reports no signal.
 */
export class PitchTracker {
  private recent: number[] = []
  private smoothed: number | null = null
  private lastHeardAt = Number.NEGATIVE_INFINITY
  private readonly holdMs: number
  private readonly glide: number

  constructor(holdMs = 400, glide = 0.35) {
    this.holdMs = holdMs
    this.glide = glide
  }

  push(frequency: number | null, now: number): number | null {
    if (frequency === null) {
      if (this.smoothed !== null && now - this.lastHeardAt > this.holdMs) this.reset()
      return this.smoothed
    }
    this.lastHeardAt = now
    this.recent = [...this.recent.slice(-4), frequency]
    const median = medianOf(this.recent)
    if (this.smoothed === null || Math.abs(centsBetween(median, this.smoothed)) > 100) {
      this.smoothed = median
    } else {
      const from = Math.log(this.smoothed)
      this.smoothed = Math.exp(from + this.glide * (Math.log(median) - from))
    }
    return this.smoothed
  }

  reset(): void {
    this.recent = []
    this.smoothed = null
  }
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
