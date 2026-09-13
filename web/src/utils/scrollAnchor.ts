/**
 * Visual reading position anchor and scroll drift compensation for GTAR StageView / Songbook.
 * Anchors visual reading position against the closest visible content line rather than raw pixel offsets,
 * preventing viewport jumping and layout thrashing during font resizing and font-family switches.
 */

export interface ScrollAnchorSnapshot {
  songId: string | number
  selector: string
  offsetFromViewportTop: number
  isTop: boolean
  timestamp: number
}

/**
 * Identifies the best content element near the top of the container's viewport
 * to use as a stable visual anchor.
 */
export function findBestAnchorElement(container: HTMLElement): {
  element: HTMLElement
  selector: string
  offsetFromViewportTop: number
  isTop: boolean
} | null {
  // Top-of-page pin: If the user is at the top of the document (scrollTop <= 2),
  // lock to top so font changes do not push the top header out of view.
  if (container.scrollTop <= 2) {
    const firstLine = container.querySelector<HTMLElement>('[data-song-line]')
    return {
      element: firstLine || container,
      selector: firstLine
        ? `[data-song-line="${firstLine.getAttribute('data-song-line')}"]`
        : '[data-song-line="0"]',
      offsetFromViewportTop: 0,
      isTop: true,
    }
  }

  const containerRect = container.getBoundingClientRect()
  const candidateElements = Array.from(
    container.querySelectorAll<HTMLElement>('[data-song-line]')
  )
  if (!candidateElements.length) return null

  let bestEl: HTMLElement | null = null
  let bestOffset = 0
  let minPositiveDist = Infinity

  for (const el of candidateElements) {
    const rect = el.getBoundingClientRect()
    // Skip unrendered or zero-height elements
    if (rect.height === 0 && rect.width === 0) continue

    const relTop = rect.top - containerRect.top
    const relBottom = rect.bottom - containerRect.top

    // Priority 1: Content line intersecting the reading band near top of viewport (e.g. 0px to 35px)
    if (relTop <= 35 && relBottom > 10) {
      bestEl = el
      bestOffset = relTop
      break
    }

    // Priority 2: Closest visible content line below the top edge
    if (relTop >= 0 && relTop < minPositiveDist) {
      minPositiveDist = relTop
      bestEl = el
      bestOffset = relTop
    }
  }

  // Fallback: first candidate element
  if (!bestEl && candidateElements.length > 0) {
    bestEl = candidateElements[0]
    bestOffset = bestEl.getBoundingClientRect().top - containerRect.top
  }

  if (!bestEl) return null

  const lineIndex = bestEl.getAttribute('data-song-line')
  return {
    element: bestEl,
    selector: `[data-song-line="${lineIndex}"]`,
    offsetFromViewportTop: bestOffset,
    isTop: false,
  }
}

/**
 * Measures the anchor element's new position relative to the container and adjusts
 * container.scrollTop to maintain the exact same offsetFromViewportTop.
 * Returns the drift delta applied.
 */
export function restoreScrollAnchor(
  container: HTMLElement,
  snapshot: ScrollAnchorSnapshot
): number {
  if (snapshot.isTop) {
    if (container.scrollTop !== 0) {
      const prev = container.scrollTop
      container.scrollTop = 0
      return -prev
    }
    return 0
  }

  const targetEl = container.querySelector<HTMLElement>(snapshot.selector)
  if (!targetEl) return 0

  const containerRect = container.getBoundingClientRect()
  const targetRect = targetEl.getBoundingClientRect()
  const currentOffset = targetRect.top - containerRect.top
  const drift = currentOffset - snapshot.offsetFromViewportTop

  // Only apply adjustment if drift exceeds sub-pixel threshold
  if (Math.abs(drift) > 0.5) {
    container.scrollTop += drift
    return drift
  }
  return 0
}

/**
 * Controller to manage anchor locking during high-frequency adjustments
 * (e.g. rapid taps or continuous hold on A- / A+).
 */
export class ScrollAnchorController {
  private activeAnchor: ScrollAnchorSnapshot | null = null
  private lockTimeout: ReturnType<typeof setTimeout> | null = null
  private readonly lockDurationMs: number

  constructor(lockDurationMs: number = 450) {
    this.lockDurationMs = lockDurationMs
  }

  /**
   * Captures the current scroll anchor. If an anchor is already locked for the current song
   * and the target element still exists, reuses it to prevent compound drift.
   */
  capture(container: HTMLElement | null, songId: string | number): ScrollAnchorSnapshot | null {
    if (!container) return null

    // Refresh lock expiration timer
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout)
    }
    this.lockTimeout = setTimeout(() => {
      this.activeAnchor = null
      this.lockTimeout = null
    }, this.lockDurationMs)

    // Reuse active locked anchor for current song to prevent compound drift across rapid steps
    if (this.activeAnchor && this.activeAnchor.songId === songId) {
      if (
        this.activeAnchor.isTop ||
        container.querySelector(this.activeAnchor.selector)
      ) {
        return this.activeAnchor
      }
    }

    const found = findBestAnchorElement(container)
    if (!found) return null

    this.activeAnchor = {
      songId,
      selector: found.selector,
      offsetFromViewportTop: found.offsetFromViewportTop,
      isTop: found.isTop,
      timestamp: Date.now(),
    }
    return this.activeAnchor
  }

  /**
   * Restores the visual reading position for the container based on the active anchor.
   */
  restore(container: HTMLElement | null, songId: string | number): number {
    if (!container || !this.activeAnchor || this.activeAnchor.songId !== songId) {
      return 0
    }
    return restoreScrollAnchor(container, this.activeAnchor)
  }

  getActiveAnchor(): ScrollAnchorSnapshot | null {
    return this.activeAnchor
  }

  clear(): void {
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout)
      this.lockTimeout = null
    }
    this.activeAnchor = null
  }
}
