import React, { useEffect, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { ChordVoicing } from '../utils/chordDictionary'
import { ChordSvgDiagram } from './ChordSvgDiagram'

export interface ChordQuickPreviewAnchor {
  rect: DOMRect
  chord: string
}

export interface ChordQuickPreviewProps {
  anchor: ChordQuickPreviewAnchor | null
  voicing: ChordVoicing | null
  onOpenDiagram?: (chord: string, voicing: ChordVoicing | null) => void
  onClose: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export const ChordQuickPreview: React.FC<ChordQuickPreviewProps> = ({
  anchor,
  voicing,
  onOpenDiagram,
  onClose,
  onMouseEnter,
  onMouseLeave,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [, setResizeTick] = useState(0)

  // Listen for window resize to update positioning if anchor is active
  useEffect(() => {
    if (!anchor) return
    const handleResize = () => setResizeTick((t) => t + 1)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [anchor])

  // Global ESC key listener to dismiss quick preview
  useEffect(() => {
    if (!anchor) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [anchor, onClose])

  if (!anchor) return null

  // Calculate coordinates synchronously derived from anchor
  const popoverWidth = 210
  const popoverHeight = voicing ? 280 : 130
  const gap = 8
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768

  const anchorRect = anchor.rect

  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2
  const minPadding = 12
  if (left < minPadding) left = minPadding
  if (left + popoverWidth > viewportWidth - minPadding) {
    left = viewportWidth - minPadding - popoverWidth
  }

  let top = anchorRect.top - popoverHeight - gap
  if (top < minPadding) {
    top = anchorRect.bottom + gap
    if (top + popoverHeight > viewportHeight - minPadding) {
      top = Math.max(minPadding, viewportHeight - minPadding - popoverHeight)
    }
  }

  const displayChord = anchor.chord

  return (
    <div
      ref={popoverRef}
      role="tooltip"
      aria-live="polite"
      className="fixed z-50 rounded-2xl bg-app-surface border border-app-border shadow-2xl p-3 text-app-text select-none animate-in fade-in zoom-in-95 duration-150"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: '210px',
        pointerEvents: 'auto',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header: Chord Name, Close */}
      <div className="flex items-center justify-between pb-1.5 border-b border-app-border">
        <div className="flex items-baseline gap-1.5 overflow-hidden">
          <span className="text-lg font-black text-app-accent tracking-tight truncate">
            {displayChord}
          </span>
          {voicing && (
            <span className="text-[10px] font-mono text-app-muted shrink-0">
              {voicing.baseFret > 1 ? `fr ${voicing.baseFret}` : 'open'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer"
          title="Dismiss Preview"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content: SVG or Compact Unavailable */}
      {voicing ? (
        <div className="mt-2 flex flex-col items-center justify-center bg-app-base rounded-xl p-1.5 border border-app-border">
          <ChordSvgDiagram voicing={voicing} width={175} height={190} compact />
        </div>
      ) : (
        <div className="mt-2 py-4 px-2 rounded-xl bg-app-base flex flex-col items-center justify-center border border-app-border text-center">
          <p className="text-xs font-semibold text-app-text">Chord diagram unavailable</p>
          <p className="text-[10px] text-app-muted mt-0.5 leading-tight">
            No trusted fingering cataloged
          </p>
        </div>
      )}

      {/* Footer Action: Open Full Diagram Modal */}
      {onOpenDiagram && (
        <button
          type="button"
          onClick={() => {
            onOpenDiagram(displayChord, voicing)
            onClose()
          }}
          className="mt-2 w-full py-1.5 px-2 rounded-lg bg-app-base hover:bg-app-border/40 text-[11px] font-medium text-app-action flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-app-border/60"
        >
          <span>Open Full Diagram</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
