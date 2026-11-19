import React, { useRef, useState, useEffect, useMemo } from 'react'
import {
  WORKSPACE_MIN_PERCENT,
  WORKSPACE_MAX_PERCENT,
  WORKSPACE_DEFAULT_PERCENT,
  BROWSE_MIN_WIDTH_PX,
  PREVIEW_MIN_WIDTH_PX,
  clampWorkspaceWidth,
} from '../utils/workspacePreview'

export interface WorkspacePreviewPaneProps {
  isOpen: boolean
  width: number | null
  onWidthChange: (width: number) => void
  children: React.ReactNode
  ariaLabel?: string
  testId?: string
}

const KEY_STEP_PERCENT = 2

export function WorkspacePreviewPane({
  isOpen,
  width,
  onWidthChange,
  children,
  ariaLabel = 'Preview Pane',
  testId = 'workspace-preview-pane',
}: WorkspacePreviewPaneProps): React.ReactElement {
  const asideRef = useRef<HTMLElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const updateContainerWidth = () => {
      const pane = asideRef.current
      const parent = pane?.parentElement
      if (parent) {
        setContainerWidth(parent.getBoundingClientRect().width)
      } else {
        setContainerWidth(window.innerWidth)
      }
    }
    updateContainerWidth()
    window.addEventListener('resize', updateContainerWidth)
    return () => window.removeEventListener('resize', updateContainerWidth)
  }, [isOpen])

  const { minPercent, maxPercent } = useMemo(() => {
    let min = WORKSPACE_MIN_PERCENT
    let max = WORKSPACE_MAX_PERCENT
    if (containerWidth && containerWidth > 0) {
      const minFromPx = (PREVIEW_MIN_WIDTH_PX / containerWidth) * 100
      if (minFromPx > min && minFromPx <= max) {
        min = minFromPx
      }
      const maxFromBrowse = ((containerWidth - BROWSE_MIN_WIDTH_PX) / containerWidth) * 100
      if (maxFromBrowse < max && maxFromBrowse >= min) {
        max = maxFromBrowse
      }
    }
    return { minPercent: Math.round(min), maxPercent: Math.round(max) }
  }, [containerWidth])

  const effectivePercent = useMemo(() => {
    const raw = width ?? WORKSPACE_DEFAULT_PERCENT
    const clamped = clampWorkspaceWidth(raw, containerWidth ?? undefined)
    return Math.min(maxPercent, Math.max(minPercent, clamped))
  }, [width, containerWidth, minPercent, maxPercent])

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const pane = asideRef.current
    if (!pane) return
    const parent = pane.parentElement
    const parentRect = parent?.getBoundingClientRect() || pane.getBoundingClientRect()
    const parentWidth = parentRect.width
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    setIsDragging(true)

    const computePercent = (clientX: number): number => {
      if (parentWidth <= 0) return effectivePercent
      const rawPx = parentRect.right - clientX
      const rawPct = (rawPx / parentWidth) * 100
      return clampWorkspaceWidth(rawPct, parentWidth)
    }

    const move = (e: PointerEvent) => {
      onWidthChange(computePercent(e.clientX))
    }

    const end = (e: PointerEvent) => {
      setIsDragging(false)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      onWidthChange(computePercent(e.clientX))
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const resizeByKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? effectivePercent + KEY_STEP_PERCENT
      : event.key === 'ArrowRight' ? effectivePercent - KEY_STEP_PERCENT
        : event.key === 'Home' ? minPercent
          : event.key === 'End' ? maxPercent : null
    if (next === null) return
    event.preventDefault()
    onWidthChange(Math.min(maxPercent, Math.max(minPercent, next)))
  }

  return (
    <aside
      ref={asideRef}
      id={testId}
      data-testid={testId}
      data-open={isOpen ? 'true' : 'false'}
      aria-label={ariaLabel}
      aria-hidden={!isOpen}
      inert={!isOpen ? true : undefined}
      style={isOpen ? { width: `${effectivePercent}%` } : { width: '0%' }}
      className={`relative sticky top-[calc(var(--app-header-height,57px)+57px)] z-10 hidden md:block shrink-0 bg-app-surface border-l border-app-border h-[calc(100vh-var(--app-header-height,57px)-57px)] max-h-[calc(100vh-var(--app-header-height,57px)-57px)] overflow-hidden ${
        isDragging
          ? 'transition-none select-none'
          : 'transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none'
      } ${
        isOpen
          ? 'opacity-100'
          : 'w-0 border-l-0 opacity-0 pointer-events-none'
      }`}
    >
      {isOpen && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize Preview Pane"
          aria-valuemin={minPercent}
          aria-valuemax={maxPercent}
          aria-valuenow={Math.round(effectivePercent)}
          data-testid="workspace-resize-handle"
          onPointerDown={startResize}
          onKeyDown={resizeByKey}
          className="absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none outline-none hover:bg-app-action/30 focus-visible:bg-app-action/50 focus-visible:ring-2 focus-visible:ring-app-action"
        />
      )}
      <div className="h-full w-full overflow-hidden flex flex-col">
        {isOpen ? children : null}
      </div>
    </aside>
  )
}
