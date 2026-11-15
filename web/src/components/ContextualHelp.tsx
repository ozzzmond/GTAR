import React, { useState, useRef, useEffect, useCallback } from 'react'
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
}) => {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
      }
    }

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open, handleClose])

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={id}
        data-testid={buttonTestId}
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex w-8 h-8 shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-base text-app-muted hover:text-app-heading hover:border-app-action cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action select-none"
      >
        <CircleHelp className="w-4 h-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={id}
          role="note"
          data-testid={panelTestId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              handleClose()
            }
          }}
          className="mt-2 rounded-xl border border-app-border bg-app-surface shadow-2xl p-3 text-[11px] text-app-text space-y-2.5 animate-scale-in max-h-[72vh] overflow-y-auto select-none"
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
        </div>
      )}
    </div>
  )
}
