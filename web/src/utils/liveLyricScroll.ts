export interface LiveScrollInput {
  enabled: boolean
  session: object
  slideKey: string
  range: readonly number[] | null
  speedScrolling: boolean
  preservePause?: boolean
}

export function liveLyricScrollTarget(scrollTop: number, scrollHeight: number, height: number, top: number, bottom: number): number | null {
  if (height <= 0 || bottom <= top) return null
  // Reserve space for the Stage title and bottom controls, including on short screens.
  const insetTop = Math.min(96, height * 0.2)
  const insetBottom = Math.min(112, height * 0.2)
  const available = height - insetTop - insetBottom
  const oversized = bottom - top > available
  if (top >= scrollTop + insetTop && (oversized ? top <= scrollTop + height * 0.3 : bottom <= scrollTop + height - insetBottom)) return null
  const offset = oversized ? insetTop : Math.min(height * 0.3, Math.max(insetTop, height - insetBottom - (bottom - top)))
  const target = Math.max(0, Math.min(Math.max(0, scrollHeight - height), top - offset))
  return Math.abs(target - scrollTop) > 1 ? target : null
}

// Owns only verified-range scrolling. No sync, persistence, matching, or native smooth motion.
export class LiveLyricScroller {
  private container: HTMLElement | null = null
  private input: LiveScrollInput | null = null
  private frame: number | null = null
  private expectedTop: number | null = null
  private paused = false
  private listeners = new Set<() => void>()
  private request: (fn: FrameRequestCallback) => number
  private cancel: (id: number) => void
  constructor(request = (fn: FrameRequestCallback) => requestAnimationFrame(fn), cancel = (id: number) => cancelAnimationFrame(id)) {
    this.request = request
    this.cancel = cancel
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  getPaused = () => this.paused
  private setPaused(value: boolean) {
    if (value === this.paused) return
    this.paused = value
    for (const fn of this.listeners) fn()
  }
  private cancelPending() {
    if (this.frame !== null) this.cancel(this.frame)
    this.frame = null
  }
  pause = () => {
    if (!this.input?.enabled) return
    this.cancelPending()
    this.setPaused(true)
  }
  resume = () => {
    if (!this.input?.enabled || this.input.speedScrolling || !this.input.range) return
    this.setPaused(false)
    this.schedule()
  }
  update(input: LiveScrollInput) {
    const previous = this.input
    this.input = input
    const changed = !previous || previous.session !== input.session || previous.slideKey !== input.slideKey || previous.enabled !== input.enabled || previous.range !== input.range
    if (changed || input.speedScrolling) this.cancelPending()
    if (!input.enabled) { if (!input.preservePause) this.setPaused(false); return }
    if (previous?.session !== input.session && !input.preservePause) this.setPaused(false)
    if (input.speedScrolling) { this.pause(); return }
    if (changed && !this.paused) this.schedule()
  }
  markProgrammaticPosition = (top: number) => { this.expectedTop = top }
  // Called before Stage's existing scroll handler. Own writes never broadcast or pause.
  handleScroll = () => {
    if (this.expectedTop !== null && this.container && Math.abs(this.container.scrollTop - this.expectedTop) <= 1) return true
    this.expectedTop = null
    return false
  }
  private schedule() {
    this.cancelPending()
    if (!this.container || !this.input?.enabled || !this.input.range || this.paused || this.input.speedScrolling) return
    this.frame = this.request(() => {
      this.frame = null
      const container = this.container, input = this.input
      if (!container || !input?.enabled || !input.range || this.paused || input.speedScrolling) return
      const rects: DOMRect[] = []
      for (const id of input.range) {
        const elements = container.querySelectorAll<HTMLElement>(`[data-line-index="${id}"][data-live-lyric="true"]`)
        if (elements.length !== 1) return
        rects.push(elements[0].getBoundingClientRect())
      }
      if (!rects.length) return
      // A column break can reverse visual order; keep highlights without guessing a position.
      if (rects.some((rect, index) => index > 0 && rect.top < rects[index - 1].top)) return
      const origin = container.getBoundingClientRect().top + container.clientTop
      const top = container.scrollTop + rects[0].top - origin
      const bottom = container.scrollTop + Math.max(...rects.map(rect => rect.bottom)) - origin
      const target = liveLyricScrollTarget(container.scrollTop, container.scrollHeight, container.clientHeight, top, bottom)
      if (target === null) return
      this.expectedTop = target
      // Instant movement also respects reduced motion and cannot continue after user input.
      container.scrollTo({ top: target, behavior: 'instant' })
      this.expectedTop = container.scrollTop
    })
  }
  attach(container: HTMLElement) {
    this.container = container
    let touch: { x: number; y: number } | null = null
    const touchStart = (event: TouchEvent) => {
      const point = event.touches[0]
      touch = point ? { x: point.clientX, y: point.clientY } : null
    }
    const touchMove = (event: TouchEvent) => {
      const point = event.touches[0]
      if (touch && point && Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 6) this.pause()
    }
    const pointer = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (event.pointerType === 'mouse' && event.clientX >= rect.right - Math.max(16, container.offsetWidth - container.clientWidth)) this.pause()
    }
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest?.('input, textarea, select, button, [role="button"], [contenteditable="true"]')) return
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'].includes(event.key)) this.pause()
    }
    container.addEventListener('wheel', this.pause, { passive: true })
    container.addEventListener('touchstart', touchStart, { passive: true })
    container.addEventListener('touchmove', touchMove, { passive: true })
    container.addEventListener('pointerdown', pointer, { passive: true })
    container.ownerDocument.defaultView?.addEventListener('keydown', key, true)
    return () => {
      this.cancelPending()
      container.removeEventListener('wheel', this.pause)
      container.removeEventListener('touchstart', touchStart)
      container.removeEventListener('touchmove', touchMove)
      container.removeEventListener('pointerdown', pointer)
      container.ownerDocument.defaultView?.removeEventListener('keydown', key, true)
      this.container = null
      this.input = null
      this.expectedTop = null
    }
  }
}
