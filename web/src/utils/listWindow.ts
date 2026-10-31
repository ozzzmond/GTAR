/**
 * #252: windowed rendering for long Songbook lists (10,000+ songs) without a dependency.
 *
 * Only the rows near the viewport are rendered; spacers above and below keep the scroll height
 * and position. Rows follow the responsive grid (1–4 columns), so a window always starts at the
 * first card of a row. Short lists (below `threshold`) render in full, exactly as before.
 */
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export interface ListWindow { active: boolean; start: number; end: number; padTop: number; padBottom: number }
export interface WindowInput {
  count: number; columns: number; rowHeight: number
  /** Viewport top and height, in the same coordinates as `listTop`. */
  viewportTop: number; viewportHeight: number; listTop: number
  overscanRows: number
}

/** Cards [start, end) to render and the spacer heights around them. Pure. */
export function computeWindow({ count, columns, rowHeight, viewportTop, viewportHeight, listTop, overscanRows }: WindowInput): Omit<ListWindow, 'active'> {
  const cols = Math.max(1, Math.floor(columns))
  const height = Math.max(1, rowHeight)
  const rows = Math.ceil(count / cols)
  const firstVisible = Math.floor((viewportTop - listTop) / height)
  const lastVisible = Math.ceil((viewportTop + viewportHeight - listTop) / height)
  const firstRow = Math.min(Math.max(0, firstVisible - overscanRows), Math.max(0, rows - 1))
  const lastRow = Math.min(rows, Math.max(firstRow + 1, lastVisible + overscanRows))
  return {
    start: Math.min(count, firstRow * cols),
    end: Math.min(count, lastRow * cols),
    padTop: firstRow * height,
    padBottom: Math.max(0, rows - lastRow) * height,
  }
}

/** Columns of the Songbook grid at a viewport width (Tailwind: sm 2, lg 3, xl 4). */
export function songGridColumns(width: number): number {
  return width >= 1280 ? 4 : width >= 1024 ? 3 : width >= 640 ? 2 : 1
}

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = window.getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

const ESTIMATED_ROW_HEIGHT = 58
export const WINDOW_THRESHOLD = 200

/**
 * Window for `count` cards in the grid at `gridRef`. Re-renders only when the visible row range
 * changes (scroll, resize, list length), measuring the real row height once cards are rendered.
 * `layoutKey` reattaches measurement/listeners when a tab remounts the grid with the same count.
 */
export function useListWindow(count: number, gridRef: RefObject<HTMLElement | null>, threshold = WINDOW_THRESHOLD, overscanRows = 6, layoutKey = ''): ListWindow {
  const active = count > threshold
  const rowHeightRef = useRef(ESTIMATED_ROW_HEIGHT)
  const [range, setRange] = useState<Omit<ListWindow, 'active'>>(() => ({ start: 0, end: Math.min(count, threshold), padTop: 0, padBottom: 0 }))

  const update = useCallback(() => {
    const grid = gridRef.current
    if (!active || !grid || typeof window === 'undefined') return
    const container = scrollParent(grid)
    const gridTop = grid.getBoundingClientRect().top
    const viewportTop = container ? container.getBoundingClientRect().top : 0
    const viewportHeight = container ? container.clientHeight : window.innerHeight
    const columns = songGridColumns(window.innerWidth)
    const next = computeWindow({
      count, columns, rowHeight: rowHeightRef.current,
      // Grid-relative: the list starts at 0; the viewport starts where it is relative to the grid.
      listTop: 0, viewportTop: viewportTop - gridTop, viewportHeight, overscanRows,
    })
    setRange(previous => previous.start === next.start && previous.end === next.end && previous.padTop === next.padTop && previous.padBottom === next.padBottom ? previous : next)
  }, [active, count, gridRef, overscanRows])

  // Measure the rendered row height (first card + row gap) and recompute when it differs.
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!active || !grid) return
    const first = grid.firstElementChild as HTMLElement | null
    const cardHeight = first?.getBoundingClientRect().height ?? 0
    if (cardHeight > 0) {
      const gap = parseFloat(window.getComputedStyle(grid).rowGap || '0') || 0
      const measured = cardHeight + gap
      if (Math.abs(measured - rowHeightRef.current) > 1) { rowHeightRef.current = measured; update() }
    }
  })

  useLayoutEffect(() => {
    if (!active) return
    update()
    let frame = 0
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 16) as unknown as number
    const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id: number) => clearTimeout(id)
    const schedule = () => { if (!frame) frame = raf(() => { frame = 0; update() }) }
    const target = scrollParent(gridRef.current) ?? window
    target.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => { if (frame) caf(frame); target.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule) }
  }, [active, update, gridRef, layoutKey])

  if (!active) return { active: false, start: 0, end: count, padTop: 0, padBottom: 0 }
  const end = Math.min(count, Math.max(range.end, Math.min(count, range.start + 1)))
  return { active: true, start: Math.min(range.start, end), end, padTop: range.padTop, padBottom: range.padBottom }
}
