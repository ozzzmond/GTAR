/**
 * Browser-history integration for GTAR in-app views (DEV.5a).
 *
 * GTAR views are state-driven (no router). Each user-visible view change is
 * mirrored as a browser history entry so the toolbar Back action and the
 * native browser/PWA Back gesture share the same semantics. Back never
 * targets a hardcoded route; it simply walks the browser history stack.
 */
export type GtarView = 'songbook' | 'editor' | 'stage' | 'trash'

export interface GtarViewHistoryState {
  gtarView: GtarView
  gtarDepth: number
}

type HistoryLike = Pick<History, 'state' | 'back'>

const GTAR_VIEWS: readonly GtarView[] = ['songbook', 'editor', 'stage', 'trash']

export function isGtarViewHistoryState(state: unknown): state is GtarViewHistoryState {
  if (!state || typeof state !== 'object') return false
  const s = state as Record<string, unknown>
  return (
    typeof s.gtarView === 'string' &&
    (GTAR_VIEWS as readonly string[]).includes(s.gtarView) &&
    typeof s.gtarDepth === 'number' &&
    Number.isInteger(s.gtarDepth) &&
    s.gtarDepth >= 0
  )
}

function getHistory(): HistoryLike | undefined {
  return typeof window !== 'undefined' && window.history ? window.history : undefined
}

/** True only when a previous GTAR-owned history entry exists (never exits the app). */
export function canNavigateBack(history: HistoryLike | undefined = getHistory()): boolean {
  if (!history) return false
  const state: unknown = history.state
  return isGtarViewHistoryState(state) && state.gtarDepth > 0
}

/**
 * Browser-style Back. Delegates to history.back(); no-op when no previous
 * in-app entry exists so the PWA is never navigated away unexpectedly.
 */
export function navigateBack(history: HistoryLike | undefined = getHistory()): boolean {
  if (!history || !canNavigateBack(history)) return false
  try {
    history.back()
    return true
  } catch {
    return false
  }
}

/** Builds the next history state, preserving unrelated keys already present. */
export function buildViewHistoryState(
  view: GtarView,
  depth: number,
  current: unknown
): GtarViewHistoryState & Record<string, unknown> {
  const base = current && typeof current === 'object' ? (current as Record<string, unknown>) : {}
  return { ...base, gtarView: view, gtarDepth: depth }
}
