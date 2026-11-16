import { useMemo, useSyncExternalStore } from 'react'
import { STAGE_TOOLS } from './registry'
import type { StageTool } from './types'

/** Stage tools are off by default; the choice is saved on this device only. */
export const stageToolKey = (id: string) => `gtar_stage_tool_${id}_v1`
export const STAGE_TOOLS_CHANGED = 'gtar-stage-tools-changed'

export function isStageToolEnabled(id: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try { return storage?.getItem(stageToolKey(id)) === '1' } catch { return false }
}

/** Switching a tool OFF also stops it, so no sound or microphone outlives its toolbar button. */
export function setStageToolEnabled(tool: StageTool, enabled: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (enabled) storage?.setItem(stageToolKey(tool.id), '1')
    else storage?.removeItem(stageToolKey(tool.id))
  } catch { /* Storage can be unavailable; the choice then applies to this page view only. */ }
  if (!enabled) {
    try { tool.stop() } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STAGE_TOOLS_CHANGED))
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(STAGE_TOOLS_CHANGED, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(STAGE_TOOLS_CHANGED, listener)
    window.removeEventListener('storage', listener)
  }
}

const enabledIds = () => STAGE_TOOLS.filter(tool => isStageToolEnabled(tool.id)).map(tool => tool.id).join(',')

/** The tools that are switched ON, in registry order. */
export function useEnabledStageTools(): readonly StageTool[] {
  const ids = useSyncExternalStore(subscribe, enabledIds, () => '')
  return useMemo(() => { const on = ids.split(','); return STAGE_TOOLS.filter(tool => on.includes(tool.id)) }, [ids])
}
