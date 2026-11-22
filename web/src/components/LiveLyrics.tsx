import React, { useEffect, useRef, useCallback, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ProPresenterHelp } from './ProPresenterHelp'
import { conciseProPresenterStatus } from '../utils/proPresenterStorage'
import type { useLiveLyrics } from '../utils/useLiveLyrics'
import type { ProPresenterStatusLevel } from '../utils/proPresenterStorage'

export interface LiveLyricsControlProps {
  live: ReturnType<typeof useLiveLyrics> & { automaticMode?: boolean }
  songTitle: string
  onConfirmed?: () => void
  children?: ReactNode
  isOpen?: boolean
  onToggleOpen?: (open: boolean) => void
  onClose?: () => void
  statusLevel?: ProPresenterStatusLevel
  statusLabel?: string
  dockMode?: 'horizontal' | 'vertical'
  dockPosition?: { x: number; y: number }
  liveScrollPaused?: boolean
  onResumeScroll?: () => void
  canResumeScroll?: boolean
}

export function LiveLyricsControl({
  live,
  songTitle,
  onConfirmed,
  children,
  isOpen = false,
  onToggleOpen,
  onClose,
  statusLevel = 'green',
  dockMode = 'horizontal',
  dockPosition,
  liveScrollPaused = false,
  onResumeScroll,
  canResumeScroll = true,
}: LiveLyricsControlProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Sync open state when controlled via prop
  useEffect(() => {
    if (detailsRef.current && detailsRef.current.open !== isOpen) {
      detailsRef.current.open = isOpen
    }
  }, [isOpen])

  const handleClose = useCallback(() => {
    if (detailsRef.current) {
      detailsRef.current.open = false
    }
    onClose?.()
    onToggleOpen?.(false)
  }, [onClose, onToggleOpen])

  // Dismiss on outside click and Escape
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null
      if (
        detailsRef.current?.open &&
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        !target?.closest('[data-contextual-help]') &&
        !target?.closest('[data-testid="stage-bottom-propresenter-btn"]') &&
        !target?.closest('[data-testid="stage-vertical-propresenter-btn"]')
      ) {
        handleClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // An open help panel takes Escape first.
      if (e.key === 'Escape' && detailsRef.current?.open && !document.querySelector('[data-contextual-help]')) {
        handleClose()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleClose])

  const dotColor =
    statusLevel === 'green'
      ? 'bg-emerald-500'
      : statusLevel === 'yellow'
      ? 'bg-amber-400'
      : 'bg-rose-500'

  const badgeColor =
    statusLevel === 'green'
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      : statusLevel === 'yellow'
      ? 'bg-amber-400/15 text-amber-400 border-amber-400/30'
      : 'bg-rose-500/15 text-rose-400 border-rose-500/30'

  const statusText =
    statusLevel === 'green'
      ? 'Following'
      : statusLevel === 'yellow'
      ? 'Paused'
      : 'Offline'

  const popoverStyle: React.CSSProperties =
    dockMode === 'vertical' && dockPosition && typeof window !== 'undefined'
      ? {
          position: 'fixed',
          left: `${Math.max(12, Math.min(window.innerWidth - 300, dockPosition.x - 280))}px`,
          top: `${Math.max(12, Math.min(window.innerHeight - 380, dockPosition.y - 40))}px`,
          width: '280px',
          maxWidth: 'calc(100vw - 24px)',
        }
      : {
          position: 'fixed',
          bottom: '5.25rem',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '320px',
          maxWidth: 'calc(100vw - 24px)',
        }

  return (
    <details
      ref={detailsRef}
      data-testid="live-lyrics-control"
      open={isOpen}
      onToggle={(e) => {
        onToggleOpen?.(e.currentTarget.open)
      }}
      className="fixed inset-0 z-50 pointer-events-none"
    >
      <summary className="sr-only cursor-pointer select-none pointer-events-auto">
        ProPresenter · {live.status}
      </summary>

      <div
        ref={popoverRef}
        role="dialog"
        aria-label="ProPresenter controls"
        style={popoverStyle}
        className="rounded-2xl border border-app-border bg-app-surface/95 backdrop-blur-md shadow-2xl p-3 text-app-text space-y-2 max-h-[82vh] overflow-y-auto text-xs select-none pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !document.querySelector('[data-contextual-help]')) {
            e.stopPropagation()
            handleClose()
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-app-border/50 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />
            <span className="font-bold text-sm text-app-heading truncate">ProPresenter</span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${badgeColor}`}>
              {statusText}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ProPresenterHelp id="propresenter-stage-help" prefer="above" />
            <span
              role="button"
              tabIndex={0}
              aria-label="Close ProPresenter controls"
              data-testid="propresenter-close-button"
              onClick={handleClose}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleClose()
                }
              }}
              className="flex w-8 h-8 items-center justify-center rounded-lg border border-app-border bg-app-base text-app-muted hover:text-app-heading hover:border-app-action cursor-pointer select-none"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
          </div>
        </div>

        {/* Current presentation & slide info */}
        {live.snapshot && (
          <div className="rounded-xl bg-app-base/60 border border-app-border/40 px-2.5 py-1.5 space-y-0.5">
            <div className="font-semibold text-app-heading truncate text-xs">
              {live.snapshot.presentation?.title ?? 'No presentation detected'}
            </div>
            {live.snapshot.current?.text && (
              <div className="text-[11px] text-app-muted line-clamp-2 italic whitespace-pre-wrap">
                “{live.snapshot.current.text}”
              </div>
            )}
          </div>
        )}

        {/* Mode-specific actions */}
        {live.automaticMode ? (
          <div className="space-y-1">
            {children}
          </div>
        ) : live.confirmed ? (
          <div className="space-y-1.5">
            <button
              type="button"
              className="ui-button min-h-11 px-3 w-full font-medium"
              onClick={live.stop}
            >
              Stop live lyrics
            </button>
            {liveScrollPaused && onResumeScroll && (
              <button
                type="button"
                className="ui-button min-h-11 px-3 w-full font-medium"
                disabled={!canResumeScroll}
                onClick={onResumeScroll}
              >
                Resume auto-scroll
              </button>
            )}
            {children}
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              className="ui-button min-h-11 px-3 w-full font-medium disabled:opacity-50"
              disabled={!live.canConfirm}
              aria-label={`Confirm same song: ${songTitle}`}
              onClick={() => {
                if (live.confirm()) {
                  onConfirmed?.()
                  handleClose()
                }
              }}
            >
              Confirm same song
            </button>
            {children}
          </div>
        )}

        {/* Status text */}
        <p role="status" className="text-[11px] text-app-muted">
          {conciseProPresenterStatus(live.status)}
        </p>
      </div>
    </details>
  )
}
