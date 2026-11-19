/**
 * GH-579 Phase 2: Workspace Preview Pane utilities and persistence.
 */
import { useEffect, useState } from 'react'

export const WORKSPACE_STORAGE_KEY = 'gtar_workspace_preview_enabled'
export const WORKSPACE_WIDTH_STORAGE_KEY = 'gtar_workspace_preview_width'

export const WORKSPACE_MIN_WIDTH = 280
export const WORKSPACE_MAX_WIDTH = 680
export const WORKSPACE_DEFAULT_WIDTH = 440
export const DESKTOP_QUERY = 768

export const clampWorkspaceWidth = (value: number): number =>
  Math.round(Math.min(WORKSPACE_MAX_WIDTH, Math.max(WORKSPACE_MIN_WIDTH, value)))

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
