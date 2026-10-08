export const EDGE_SWIPE_STORAGE_KEY = 'gtar_edge_swipe_panel'

/**
 * Evaluates whether movement intention is horizontal, vertical, or still undecided.
 * Vertical intent dominates to allow natural mobile scrolling.
 */
export function evaluateEdgeSwipeIntent(
  deltaX: number,
  deltaY: number,
  slop = 8
): 'undecided' | 'vertical' | 'horizontal' {
  const absX = Math.abs(deltaX)
  const absY = Math.abs(deltaY)
  if (absX < slop && absY < slop) return 'undecided'
  if (absY >= absX) return 'vertical'
  return 'horizontal'
}
