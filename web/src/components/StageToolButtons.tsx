import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import {
  closeStageTool,
  openStageTool,
  registerStageToolbar,
  useActiveStageTool,
  useEnabledStageTools,
} from '../stageTools/settings'
import type { StageTool } from '../stageTools/types'

interface StageToolButtonsProps {
  /** Same button style as the other Stage toolbar buttons. */
  buttonClass: string
  /** True while the toolbar is hidden (performance mode): the panel hides with it. */
  hidden?: boolean
}

interface StageToolButtonProps {
  tool: StageTool
  buttonClass: string
  isOpen: boolean
  onToggle: (anchor: HTMLElement) => void
}

const StageToolButton: React.FC<StageToolButtonProps> = ({ tool, buttonClass, isOpen, onToggle }) => {
  const isRunning = tool.useIsRunning ? tool.useIsRunning() : false
  return (
    <button
      type="button"
      onClick={event => onToggle(event.currentTarget)}
      aria-label={tool.name}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      data-testid={`stage-tool-${tool.id}`}
      className={buttonClass}
    >
      <tool.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{tool.name}</span>
      {isRunning && (
        <span
          data-testid={`stage-tool-running-${tool.id}`}
          className="w-2 h-2 rounded-full bg-app-action animate-pulse shrink-0"
          aria-hidden="true"
        />
      )}
    </button>
  )
}

/**
 * Stage toolbar buttons for the tools switched ON in Advanced Tools. Each button opens that tool's
 * compact panel: a bottom sheet on phones, a small card under the toolbar on wider screens. The
 * panel has no backdrop, so the song stays visible and usable behind it.
 */
export const StageToolButtons: React.FC<StageToolButtonsProps> = ({ buttonClass, hidden = false }) => {
  const tools = useEnabledStageTools()
  const activeTool = useActiveStageTool()
  const previous = useRef(tools)

  useEffect(() => {
    return registerStageToolbar()
  }, [])

  // A tool switched OFF anywhere (this tab or another) is stopped along with its button.
  useEffect(() => {
    for (const tool of previous.current) {
      if (!tools.includes(tool)) {
        try { tool.stop() } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
      }
    }
    previous.current = tools
  }, [tools])

  useEffect(() => {
    if (activeTool && !tools.some(t => t.id === activeTool.id)) {
      closeStageTool(false)
    }
  }, [tools, activeTool])

  const open = tools.find(tool => tool.id === activeTool?.id)
  const close = (returnFocus: boolean) => {
    closeStageTool(returnFocus)
  }

  return (
    <>
      {tools.map(tool => (
        <StageToolButton
          key={tool.id}
          tool={tool}
          buttonClass={buttonClass}
          isOpen={activeTool?.id === tool.id}
          onToggle={anchor => {
            if (activeTool?.id === tool.id) {
              closeStageTool(true)
            } else {
              openStageTool(tool.id, anchor)
            }
          }}
        />
      ))}
      {open && activeTool && !hidden && (
        <StageToolPanel key={open.id} tool={open} anchor={activeTool.anchor ?? null} onClose={close} />
      )}
    </>
  )
}

export interface StageToolPanelProps {
  tool: StageTool
  anchor: HTMLElement | null
  onClose: (returnFocus: boolean) => void
}

export const StageToolPanel: React.FC<StageToolPanelProps> = ({ tool, anchor, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null)

  // Wider screens: the card sits just under the toolbar button that opened it.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const place = () => {
      let top = 65
      if (anchor && anchor.isConnected) {
        const rect = anchor.getBoundingClientRect()
        if (rect.bottom > 0) top = Math.round(rect.bottom + 8)
      }
      panel.style.setProperty('--stage-tool-top', `${top}px`)
    }
    place()
    panel.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs sm:hidden"
        onClick={() => onClose(true)}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={tool.name}
        tabIndex={-1}
        data-testid={`stage-tool-panel-${tool.id}`}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(true) } }}
        className="fixed z-50 inset-x-4 top-1/2 -translate-y-1/2 max-h-[90dvh] overflow-y-auto rounded-2xl border border-app-border bg-app-surface shadow-2xl focus:outline-none sm:z-40 sm:inset-x-auto sm:top-[var(--stage-tool-top,65px)] sm:bottom-auto sm:right-4 sm:translate-y-0 sm:w-80 sm:max-h-[calc(100dvh-var(--stage-tool-top,65px)-1rem)]"
      >
        <div className="flex items-center justify-between gap-2 pl-4 pr-1.5 border-b border-app-border">
          <div className="flex min-w-0 items-center gap-2">
            <tool.Icon className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
            <h2 className="text-sm font-bold text-app-heading truncate">{tool.name}</h2>
          </div>
          <div className="flex shrink-0 items-center">
            {tool.Help && <tool.Help prefer="below" />}
            <button
              type="button"
              onClick={() => onClose(true)}
              aria-label={`Close ${tool.name}`}
              className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-app-muted hover:text-app-heading cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="p-4">
          <tool.Panel />
        </div>
      </div>
    </>,
    document.body,
  )
}
