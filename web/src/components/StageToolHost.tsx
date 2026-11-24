import React, { useSyncExternalStore } from 'react'
import { STAGE_TOOLS } from '../stageTools/registry'
import {
  closeStageTool,
  isStageToolbarMounted,
  useActiveStageTool,
  STAGE_TOOL_ACTIVE_CHANGED,
} from '../stageTools/settings'
import { StageToolPanel } from './StageToolButtons'

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(STAGE_TOOL_ACTIVE_CHANGED, listener)
  return () => {
    window.removeEventListener(STAGE_TOOL_ACTIVE_CHANGED, listener)
  }
}

/**
 * App-level host for Stage tools.
 * When outside Stage view (or whenever the Stage toolbar is not mounted),
 * this host renders the active tool's panel as a floating card (desktop)
 * or a bottom sheet (mobile).
 */
export const StageToolHost: React.FC = () => {
  const active = useActiveStageTool()
  const toolbarMounted = useSyncExternalStore(subscribe, isStageToolbarMounted, () => false)

  if (toolbarMounted || !active) return null

  const tool = STAGE_TOOLS.find(t => t.id === active.id)
  if (!tool) return null

  return (
    <StageToolPanel
      key={tool.id}
      tool={tool}
      anchor={active.anchor ?? null}
      onClose={returnFocus => closeStageTool(returnFocus)}
    />
  )
}
