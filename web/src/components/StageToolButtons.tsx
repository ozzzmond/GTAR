import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useEnabledStageTools } from '../stageTools/settings'
import type { StageTool } from '../stageTools/types'

interface StageToolButtonsProps {
  /** Same button style as the other Stage toolbar buttons. */
  buttonClass: string
  /** True while the toolbar is hidden (performance mode): the panel hides with it. */
  hidden?: boolean
}

/**
 * Stage toolbar buttons for the tools switched ON in Advanced Tools. Each button opens that tool's
 * compact panel: a bottom sheet on phones, a small card under the toolbar on wider screens. The
 * panel has no backdrop, so the song stays visible and usable behind it.
 */
export const StageToolButtons: React.FC<StageToolButtonsProps> = ({ buttonClass, hidden = false }) => {
  const tools = useEnabledStageTools()
  const [opened, setOpened] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const previous = useRef(tools)

  // A tool switched OFF anywhere (this tab or another) is stopped along with its button.
  useEffect(() => {
    for (const tool of previous.current) {
      if (!tools.includes(tool)) {
        try { tool.stop() } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
      }
    }
    previous.current = tools
  }, [tools])

  const open = tools.find(tool => tool.id === opened?.id)
  const close = (returnFocus: boolean) => {
    if (returnFocus) opened?.anchor.focus({ preventScroll: true })
    setOpened(null)
  }

  return (
    <>
      {tools.map(tool => (
        <button
          key={tool.id}
          type="button"
          onClick={event => {
            const anchor = event.currentTarget
            setOpened(current => (current?.id === tool.id ? null : { id: tool.id, anchor }))
          }}
          aria-label={tool.name}
          aria-haspopup="dialog"
          aria-expanded={open === tool}
          data-testid={`stage-tool-${tool.id}`}
          className={buttonClass}
        >
          <tool.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{tool.name}</span>
        </button>
      ))}
      {open && opened && !hidden && (
        <StageToolPanel key={open.id} tool={open} anchor={opened.anchor} onClose={close} />
      )}
    </>
  )
}

interface StageToolPanelProps {
  tool: StageTool
  anchor: HTMLElement
  onClose: (returnFocus: boolean) => void
}

const StageToolPanel: React.FC<StageToolPanelProps> = ({ tool, anchor, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null)

  // Wider screens: the card sits just under the toolbar button that opened it.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const place = () => panel.style.setProperty('--stage-tool-top', `${Math.round(anchor.getBoundingClientRect().bottom + 8)}px`)
    place()
    panel.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={tool.name}
      tabIndex={-1}
      data-testid={`stage-tool-panel-${tool.id}`}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(true) } }}
      className="fixed z-40 inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-app-border bg-app-surface shadow-2xl pb-[env(safe-area-inset-bottom)] focus:outline-none sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[var(--stage-tool-top)] sm:w-80 sm:max-h-[calc(100dvh-var(--stage-tool-top)-1rem)] sm:rounded-2xl sm:pb-0"
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
    </div>,
    document.body,
  )
}
