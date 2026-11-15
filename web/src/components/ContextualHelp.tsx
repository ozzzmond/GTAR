import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, X, ChevronDown } from 'lucide-react'

export interface HelpTopic {
  title: string
  content: React.ReactNode
  defaultExpanded?: boolean
}

export interface ContextualHelpProps {
  id: string
  title: string
  buttonLabel?: string
  buttonTestId?: string
  panelTestId?: string
  topics: HelpTopic[]
  quickSummary?: string
  className?: string
  /** Side the panel opens on when both fit. 'above' keeps it off the controls under the button. */
  prefer?: 'below' | 'above'
}

export const ContextualHelp: React.FC<ContextualHelpProps> = ({
  id,
  title,
  buttonLabel = `Help for ${title}`,
  buttonTestId,
  panelTestId,
  topics,
  quickSummary,
  className = '',
  prefer = 'below',
}) => {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<React.CSSProperties>({})
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // The panel is portaled to <body> and pinned to the button, so no dialog, popover or scroll
  // container can clip it; it opens on the roomier side and never leaves the viewport.
  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const margin = 12, gap = 8
    const vw = window.innerWidth, vh = window.innerHeight
    const width = Math.min(320, vw - margin * 2)
    const left = Math.max(margin, Math.min(rect.right - width, vw - margin - width))
    const below = vh - rect.bottom - gap - margin, above = rect.top - gap - margin
    const openBelow = prefer === 'above' ? above < 260 && below >= above : below >= 260 || below >= above
    setPlacement(openBelow
      ? { left, width, top: rect.bottom + gap, maxHeight: Math.max(120, below) }
      : { left, width, bottom: vh - rect.top + gap, maxHeight: Math.max(120, above) })
  }, [prefer])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return

    // Capture phase: an open help panel takes Escape before the menu, sheet or dialog hosting it,
    // and focus goes back to the help button.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
        buttonRef.current?.focus({ preventScroll: true })
      }
    }

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (panelRef.current && !panelRef.current.contains(target) && !buttonRef.current?.contains(target)) {
        handleClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', place)
    }
  }, [open, handleClose, place])

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={id}
        data-testid={buttonTestId}
        ref={buttonRef}
        onClick={() => { if (!open) place(); setOpen((prev) => !prev) }}
        className="relative flex w-8 h-8 shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-base text-app-muted hover:text-app-heading hover:border-app-action cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action select-none before:absolute before:-inset-1.5 before:content-['']"
      >
        <CircleHelp className="w-4 h-4" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          id={id}
          role="note"
          data-contextual-help=""
          data-testid={panelTestId}
          style={placement}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              handleClose()
            }
          }}
          className="fixed z-[120] rounded-xl border border-app-border bg-app-surface shadow-2xl p-3 text-[11px] text-app-text space-y-2.5 animate-scale-in overflow-y-auto overscroll-contain select-none"
        >
          <div className="flex items-center justify-between border-b border-app-border/60 pb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <CircleHelp className="w-3.5 h-3.5 text-app-accent shrink-0" aria-hidden="true" />
              <span className="font-bold text-xs text-app-heading truncate">{title} Help</span>
            </div>
            <button
              type="button"
              aria-label="Close help"
              onClick={handleClose}
              className="w-6 h-6 rounded flex items-center justify-center text-app-muted hover:text-app-heading cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {quickSummary && (
            <p className="text-app-muted leading-relaxed">{quickSummary}</p>
          )}

          <div className="space-y-1.5">
            {topics.map((topic, i) => (
              <details
                key={i}
                className="group rounded-lg border border-app-border/60 bg-app-base/70 overflow-hidden"
                open={topic.defaultExpanded !== false}
              >
                <summary className="flex items-center justify-between px-2.5 py-2 font-semibold text-app-heading cursor-pointer hover:bg-app-surface/80 text-[11px] select-none list-none [&::-webkit-details-marker]:hidden">
                  <span>{topic.title}</span>
                  <ChevronDown className="w-3 h-3 text-app-muted group-open:rotate-180 transition-transform shrink-0 ml-1" />
                </summary>
                <div className="px-2.5 pb-2.5 pt-1 text-app-muted space-y-1 leading-normal border-t border-app-border/40 text-[11px]">
                  {topic.content}
                </div>
              </details>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
