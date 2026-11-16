import { clampBpm } from './metronomeModel'

export interface TapTempoOptions {
  /** A pause longer than this starts a new tap sequence. */
  gapMs?: number
  /** Taps kept for the estimate. */
  maxTaps?: number
  /** Intervals used for the smoothed average. */
  smoothing?: number
}

export interface TapTempo {
  /** Records a tap at `timeMs` and returns the smoothed BPM, or null until two usable taps exist. */
  tap(timeMs: number): number | null
  reset(): void
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Tap tempo: intervals outside 60%..160% of the typical interval are ignored as misses, the
 * rest are averaged over the most recent taps, and a long pause restarts the sequence.
 */
export function createTapTempo(options: TapTempoOptions = {}): TapTempo {
  const gapMs = options.gapMs ?? 2500
  const maxTaps = options.maxTaps ?? 8
  const smoothing = options.smoothing ?? 4
  let taps: number[] = []

  return {
    tap(timeMs: number): number | null {
      if (!Number.isFinite(timeMs)) return null
      const last = taps[taps.length - 1]
      if (last !== undefined && (timeMs - last > gapMs || timeMs <= last)) taps = []
      taps.push(timeMs)
      if (taps.length > maxTaps) taps = taps.slice(-maxTaps)
      if (taps.length < 2) return null

      const intervals = taps.slice(1).map((time, index) => time - taps[index])
      const typical = median(intervals)
      const usable = intervals.filter(interval => interval >= typical * 0.6 && interval <= typical * 1.6)
      const recent = usable.slice(-smoothing)
      if (recent.length === 0) return null
      const average = recent.reduce((sum, value) => sum + value, 0) / recent.length
      return clampBpm(60000 / average)
    },
    reset(): void {
      taps = []
    },
  }
}
