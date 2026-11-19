import React, { useRef } from 'react'
import {
  WORKSPACE_MIN_WIDTH,
  WORKSPACE_MAX_WIDTH,
  WORKSPACE_DEFAULT_WIDTH,
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

const KEY_STEP = 16

export function WorkspacePreviewPane({
  isOpen,
  width,
  onWidthChange,
  children,
  ariaLabel = 'Preview Pane',
  testId = 'workspace-preview-pane',
}: WorkspacePreviewPaneProps): React.ReactElement {
  const asideRef = useRef<HTMLElement>(null)

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const pane = asideRef.current
    if (!pane) return
    const right = pane.getBoundingClientRect().right
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const move = (e: PointerEvent) => {
      onWidthChange(clampWorkspaceWidth(right - e.clientX))
    }
    const end = (e: PointerEvent) => {
      onWidthChange(clampWorkspaceWidth(right - e.clientX))
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const resizeByKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = width ?? (asideRef.current?.getBoundingClientRect().width || WORKSPACE_DEFAULT_WIDTH)
    const next = event.key === 'ArrowLeft' ? current + KEY_STEP
      : event.key === 'ArrowRight' ? current - KEY_STEP
        : event.key === 'Home' ? WORKSPACE_MIN_WIDTH
          : event.key === 'End' ? WORKSPACE_MAX_WIDTH : null
    if (next === null) return
    event.preventDefault()
    onWidthChange(next)
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
      style={width && isOpen ? { width } : undefined}
      className={`relative sticky top-[calc(var(--app-header-height,57px)+57px)] z-10 hidden md:block shrink-0 bg-app-surface border-l border-app-border h-[calc(100vh-var(--app-header-height,57px)-57px)] max-h-[calc(100vh-var(--app-header-height,57px)-57px)] transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none overflow-hidden ${
        isOpen
          ? (width ? '' : 'w-80 lg:w-[420px] xl:w-[480px]') + ' opacity-100'
          : 'w-0 border-l-0 opacity-0 pointer-events-none'
      }`}
    >
      {isOpen && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize Preview Pane"
          aria-valuemin={WORKSPACE_MIN_WIDTH}
          aria-valuemax={WORKSPACE_MAX_WIDTH}
          aria-valuenow={width ?? WORKSPACE_DEFAULT_WIDTH}
          data-testid="workspace-resize-handle"
          onPointerDown={startResize}
          onKeyDown={resizeByKey}
          className="absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none outline-none hover:bg-app-action/30 focus-visible:bg-app-action/50"
        />
      )}
      <div className="h-full w-full overflow-hidden flex flex-col">
        {isOpen ? children : null}
      </div>
    </aside>
  )
}
