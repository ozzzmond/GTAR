import type { BandSyncState } from './bandSyncProtocol'

// Match the effective bounds in StageView.handleAdjustSpeed (the legacy Stage control handler).
export const BAND_SYNC_SCROLL_SPEED = Object.freeze({ min: 10, max: 150 })
export function createBandSyncScroll(viewport: HTMLElement, runtime = {
  frame: (fn: FrameRequestCallback) => requestAnimationFrame(fn), cancel: (id: number) => cancelAnimationFrame(id),
}) {
  let frame: number | null = null, last: number | null = null, speed = 10, max = 0, disposed = false
  const stop = () => {
    if (frame !== null) runtime.cancel(frame)
    frame = null; last = null
  }
  const step: FrameRequestCallback = now => {
    frame = null
    if (disposed) return
    if (last !== null) viewport.scrollTop = Math.min(max, viewport.scrollTop + speed * Math.min(0.1, Math.max(0, (now - last) / 1000)))
    last = now
    frame = runtime.frame(step)
  }
  return {
    apply(state: BandSyncState | null, online: boolean) {
      if (disposed) return
      const previousTime = last, wasScrolling = frame !== null
      stop()
      if (!state || !online) {
        viewport.scrollTo({ top: viewport.scrollTop, behavior: 'auto' })
        return
      }
      // One geometry read batch per STATE; no geometry traversal inside the animation loop.
      max = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      let top = Math.min(max, Math.max(0, state.scrollFraction * max))
      const anchor = viewport.querySelector<HTMLElement>(`[data-line-index="${state.lineIndex}"]`)
      if (anchor) {
        const rect = anchor.getBoundingClientRect(), viewportTop = viewport.getBoundingClientRect().top
        const anchorTop = rect.top - viewportTop + viewport.scrollTop
        const anchorBottom = rect.bottom - viewportTop + viewport.scrollTop
        // Different wrapping/viewport sizes can make fractions diverge by more than a screen.
        if (top < anchorTop - viewport.clientHeight || top > anchorBottom + viewport.clientHeight) top = Math.min(max, Math.max(0, anchorTop))
      }
      speed = Math.min(BAND_SYNC_SCROLL_SPEED.max, Math.max(BAND_SYNC_SCROLL_SPEED.min, state.autoscroll.speed))
      if (state.autoscroll.on) {
        last = wasScrolling ? previousTime : null
        viewport.scrollTo({ top, behavior: 'auto' })
        frame = runtime.frame(step)
      } else viewport.scrollTo({ top, behavior: 'smooth' })
    },
    dispose() { stop(); disposed = true; viewport.scrollTo({ top: viewport.scrollTop, behavior: 'auto' }) },
  }
}
