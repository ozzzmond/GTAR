/**
 * GH-579 Phase 2: Workspace Preview Pane utilities and persistence.
 */
import { useEffect, useState } from 'react'

export const WORKSPACE_STORAGE_KEY = 'gtar_workspace_preview_enabled'
export const WORKSPACE_WIDTH_STORAGE_KEY = 'gtar_workspace_preview_width'

export const WORKSPACE_MIN_PERCENT = 30
export const WORKSPACE_MAX_PERCENT = 70
export const WORKSPACE_DEFAULT_PERCENT = 40

export const BROWSE_MIN_WIDTH_PX = 280
export const PREVIEW_MIN_WIDTH_PX = 280
export const DESKTOP_QUERY = 768

export const clampWorkspaceWidth = (value: number, containerWidth?: number): number => {
  let minPct = WORKSPACE_MIN_PERCENT
  let maxPct = WORKSPACE_MAX_PERCENT

  if (containerWidth && containerWidth > 0) {
    const minFromPx = (PREVIEW_MIN_WIDTH_PX / containerWidth) * 100
    if (minFromPx > minPct && minFromPx <= maxPct) {
      minPct = minFromPx
    }
    const maxFromBrowse = ((containerWidth - BROWSE_MIN_WIDTH_PX) / containerWidth) * 100
    if (maxFromBrowse < maxPct && maxFromBrowse >= minPct) {
      maxPct = maxFromBrowse
    }
  }

  // Handle legacy pixel values (> 100) by converting against container or typical 1200px desktop
  if (value > 100) {
    const estimated = containerWidth && containerWidth > 0
      ? (value / containerWidth) * 100
      : (value / 1200) * 100
    return Math.round(Math.min(maxPct, Math.max(minPct, estimated)))
  }

  return Math.round(Math.min(maxPct, Math.max(minPct, value)))
}

export const readWorkspaceEnabled = (): boolean => {
  try {
    return localStorage.getItem(WORKSPACE_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export const readWorkspaceWidth = (): number | null => {
  try {
    const raw = Number(localStorage.getItem(WORKSPACE_WIDTH_STORAGE_KEY))
    return Number.isFinite(raw) && raw > 0 ? clampWorkspaceWidth(raw) : null
  } catch {
    return null
  }
}

export const rememberWorkspaceEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, String(enabled))
  } catch {
    // Storage preference is optional
  }
}

export const rememberWorkspaceWidth = (width: number): void => {
  try {
    localStorage.setItem(WORKSPACE_WIDTH_STORAGE_KEY, String(clampWorkspaceWidth(width)))
  } catch {
    // Storage preference is optional
  }
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_QUERY : true
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setIsDesktop(window.innerWidth >= DESKTOP_QUERY)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isDesktop
}
