/** Latest-value source gate: immediate when a slot is free, otherwise trailing; no more than 4/s. */
export class BandSyncPublicationGate {
  private at = -Infinity
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: (() => void) | null = null
  private clock: { now(): number; later(fn: () => void, ms: number): ReturnType<typeof setTimeout>; cancel(t: ReturnType<typeof setTimeout>): void }
  constructor(clock = { now: () => Date.now(), later: (fn: () => void, ms: number) => setTimeout(fn, ms), cancel: (t: ReturnType<typeof setTimeout>) => clearTimeout(t) }) { this.clock = clock }
  publish(fn: () => void) {
    this.pending = fn
    const delay = Math.max(0, 250 - (this.clock.now() - this.at))
    if (!delay) this.flush()
    else this.timer ??= this.clock.later(() => { this.timer = null; this.flush() }, delay)
  }
  private flush() {
    if (this.timer !== null) this.clock.cancel(this.timer)
    this.timer = null
    const fn = this.pending; this.pending = null; this.at = this.clock.now(); fn?.()
  }
  clear() { if (this.timer !== null) this.clock.cancel(this.timer); this.timer = null; this.pending = null; this.at = -Infinity }
}
