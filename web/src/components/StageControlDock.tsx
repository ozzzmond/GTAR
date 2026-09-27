import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, ChevronUp, ChevronDown, GripVertical } from 'lucide-react'
import { STAGE_DOCK_POSITION_KEY } from '../utils/syncJournal'

export interface DockPosition {
  x: number
  y: number
}

export interface ViewportSize {
  width: number
  height: number
}

export const DOCK_SIZE = {
  width: 56,
  height: 168,
}

export const DOCK_DEFAULT_MARGINS = {
  right: 16,
  bottom: 88,
  min: 12,
}

export const DRAG_THRESHOLD_PX = 8
export const LONG_PRESS_MS = 500

/**
 * Calculates safe default dock position in bottom-right corner.
 */
export function getDefaultDockPosition(
  viewport: ViewportSize,
  dockSize: { width: number; height: number } = DOCK_SIZE,
  marginRight = DOCK_DEFAULT_MARGINS.right,
  marginBottom = DOCK_DEFAULT_MARGINS.bottom
): DockPosition {
  const safeW = typeof viewport.width === 'number' && !isNaN(viewport.width) && viewport.width > 0 ? viewport.width : 1024
  const safeH = typeof viewport.height === 'number' && !isNaN(viewport.height) && viewport.height > 0 ? viewport.height : 768
  return {
    x: Math.max(DOCK_DEFAULT_MARGINS.min, safeW - dockSize.width - marginRight),
    y: Math.max(DOCK_DEFAULT_MARGINS.min, safeH - dockSize.height - marginBottom),
  }
}

/**
 * Clamps coordinates to reachable stage viewport bounds.
 */
export function clampDockPosition(
  pos: DockPosition,
  viewport: ViewportSize,
  dockSize: { width: number; height: number } = DOCK_SIZE,
  minMargin = DOCK_DEFAULT_MARGINS.min
): DockPosition {
  const safeW = typeof viewport.width === 'number' && !isNaN(viewport.width) && viewport.width > 0 ? viewport.width : 1024
  const safeH = typeof viewport.height === 'number' && !isNaN(viewport.height) && viewport.height > 0 ? viewport.height : 768

  const minX = minMargin
  const maxX = Math.max(minMargin, safeW - dockSize.width - minMargin)
  const minY = minMargin
  const maxY = Math.max(minMargin, safeH - dockSize.height - minMargin)

  const rawX = typeof pos.x === 'number' && !isNaN(pos.x) ? pos.x : maxX
  const rawY = typeof pos.y === 'number' && !isNaN(pos.y) ? pos.y : maxY

  return {
    x: Math.min(Math.max(rawX, minX), maxX),
    y: Math.min(Math.max(rawY, minY), maxY),
  }
}

/**
 * Reads locally persisted dock position from localStorage.
 */
export function readPersistedDockPosition(
  storage: Pick<Storage, 'getItem'> = localStorage,
  viewport: ViewportSize = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  }
): DockPosition {
  try {
    const raw = storage.getItem(STAGE_DOCK_POSITION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DockPosition>
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number' && !isNaN(parsed.x) && !isNaN(parsed.y)) {
        return clampDockPosition({ x: parsed.x, y: parsed.y }, viewport)
      }
    }
  } catch {
    // Ignore JSON parse errors and fallback to safe default
  }
  return getDefaultDockPosition(viewport)
}

/**
 * Writes locally persisted dock position to localStorage.
 */
export function persistDockPosition(
  pos: DockPosition,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  try {
    storage.setItem(STAGE_DOCK_POSITION_KEY, JSON.stringify(pos))
  } catch {
    // Storage quota or sandboxed failure handled silently
  }
}

export interface StageControlDockProps {
  isAutoScrolling: boolean
  onToggleAutoScroll: () => void
  onOpenStageOptions: () => void
  onPrevSection: () => void
  onNextSection: () => void
  canPrevSection?: boolean
  canNextSection?: boolean
  visible?: boolean
  onUserInteraction?: () => void
}

export const StageControlDock: React.FC<StageControlDockProps> = ({
  isAutoScrolling,
  onToggleAutoScroll,
  onOpenStageOptions,
  onPrevSection,
  onNextSection,
  canPrevSection = true,
  canNextSection = true,
  visible = true,
  onUserInteraction,
}) => {
  const [position, setPosition] = useState<DockPosition>(() => {
    return readPersistedDockPosition()
  })

  // Pointer drag and long-press state tracking
  const activePointerRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    dockStartX: number
    dockStartY: number
    isDragging: boolean
    isLongPress: boolean
    timer: ReturnType<typeof setTimeout> | null
    target: 'autoscroll' | 'prev' | 'next' | 'dock'
  } | null>(null)

  const dockRef = useRef<HTMLDivElement>(null)

  // Re-clamp position on window resize or device orientation change
  useEffect(() => {
    const handleResize = () => {
      const currentViewport: ViewportSize = {
        width: window.innerWidth,
        height: window.innerHeight,
      }
      setPosition((prev) => clampDockPosition(prev, currentViewport))
    }

    window.addEventListener('resize', handleResize, { passive: true })
    window.addEventListener('orientationchange', handleResize, { passive: true })
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  // Universal pointer start handler for buttons and drag cluster
  const handlePointerStart = useCallback((
    e: React.PointerEvent,
    target: 'autoscroll' | 'prev' | 'next' | 'dock'
  ) => {
    // Only primary button initiates drag/gestures
    if (e.button !== 0) return

    e.stopPropagation()
    onUserInteraction?.()

    const pointerId = e.pointerId
    const startX = e.clientX
    const startY = e.clientY
    const dockStartX = position.x
    const dockStartY = position.y

    try {
      e.currentTarget.setPointerCapture(pointerId)
    } catch {
      // Ignore if setPointerCapture unsupported in test environment
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    if (target === 'autoscroll') {
      timer = setTimeout(() => {
        if (activePointerRef.current && !activePointerRef.current.isDragging) {
          activePointerRef.current.isLongPress = true
          onOpenStageOptions()
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
            try {
              navigator.vibrate(40)
            } catch {
              // Ignore haptic failures
            }
          }
        }
      }, LONG_PRESS_MS)
    }

    activePointerRef.current = {
      pointerId,
      startX,
      startY,
      dockStartX,
      dockStartY,
      isDragging: false,
      isLongPress: false,
      timer,
      target,
    }
  }, [position, onOpenStageOptions, onUserInteraction])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const state = activePointerRef.current
    if (!state || state.pointerId !== e.pointerId) return

    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    const dist = Math.hypot(dx, dy)

    if (!state.isDragging && dist > DRAG_THRESHOLD_PX) {
      state.isDragging = true
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = null
      }
    }

    if (state.isDragging) {
      e.stopPropagation()
      const viewport: ViewportSize = {
        width: window.innerWidth,
        height: window.innerHeight,
      }
      const rawPos: DockPosition = {
        x: state.dockStartX + dx,
        y: state.dockStartY + dy,
      }
      const clamped = clampDockPosition(rawPos, viewport)
      setPosition(clamped)
    }
  }, [])

  const handlePointerEnd = useCallback((e: React.PointerEvent) => {
    const state = activePointerRef.current
    if (!state || state.pointerId !== e.pointerId) return

    e.stopPropagation()
    onUserInteraction?.()

    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Ignore releasePointerCapture in test environments
    }

    const wasDragging = state.isDragging
    const wasLongPress = state.isLongPress
    const target = state.target

    activePointerRef.current = null

    if (wasDragging) {
      // Commit clamped position to device storage
      const viewport: ViewportSize = {
        width: window.innerWidth,
        height: window.innerHeight,
      }
      const finalPos = clampDockPosition(position, viewport)
      persistDockPosition(finalPos)
      return
    }

    if (wasLongPress) {
      // Long press already opened stage options; do NOT toggle autoscroll
      return
    }

    // Short tap execution
    if (target === 'autoscroll') {
      onToggleAutoScroll()
    } else if (target === 'prev' && canPrevSection) {
      onPrevSection()
    } else if (target === 'next' && canNextSection) {
      onNextSection()
    }
  }, [position, canPrevSection, canNextSection, onToggleAutoScroll, onPrevSection, onNextSection, onUserInteraction])

  // Double-tap or double-click to reset to safe default position
  const handleResetDefaultPosition = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const viewport: ViewportSize = {
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const def = getDefaultDockPosition(viewport)
    setPosition(def)
    persistDockPosition(def)
  }, [])

  return (
    <div
      ref={dockRef}
      role="toolbar"
      aria-label="Stage Control Dock"
      data-stage-dock="true"
      onPointerMove={handlePointerMove}
      className={`fixed z-40 select-none touch-none flex flex-col items-center gap-1.5 p-1.5 rounded-full
                 bg-[#073642]/90 backdrop-blur-md border border-[#1A4A55] shadow-2xl transition-opacity duration-300 ${
                   visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                 }`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${DOCK_SIZE.width}px`,
      }}
    >
      {/* Top Drag Grip & Reset Target */}
      <div
        onPointerDown={(e) => handlePointerStart(e, 'dock')}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={handleResetDefaultPosition}
        title="Drag dock to reposition. Double-click to reset."
        aria-label="Reposition stage control dock"
        className="w-full flex items-center justify-center py-1 cursor-grab active:cursor-grabbing text-[#93A1A1]/60 hover:text-[#2AA198] transition-colors"
      >
        <GripVertical className="w-3.5 h-3.5 rotate-90" />
      </div>

      {/* Previous Section Button */}
      <button
        type="button"
        disabled={!canPrevSection}
        onPointerDown={(e) => handlePointerStart(e, 'prev')}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer select-none active:scale-90 ${
          canPrevSection
            ? 'bg-[#002B36]/90 border border-[#1A4A55] text-[#EEE8D5] hover:text-[#2AA198] hover:border-[#2AA198]/60 shadow-md'
            : 'bg-[#002B36]/40 border border-[#1A4A55]/30 text-[#93A1A1]/30 cursor-not-allowed'
        }`}
        title={canPrevSection ? 'Previous Section' : 'No previous section'}
        aria-label="Jump to previous section"
      >
        <ChevronUp className="w-5 h-5 stroke-[2.5]" />
      </button>

      {/* Center Autoscroll FAB Button with Long-Press Stage Options */}
      <button
        type="button"
        onPointerDown={(e) => handlePointerStart(e, 'autoscroll')}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className={`w-12 h-12 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-95 cursor-pointer select-none border-2 ${
          isAutoScrolling
            ? 'bg-[#EF4444] border-[#EF4444]/70 text-white hover:bg-[#DC2626] shadow-red-900/50'
            : 'bg-[#B58900] border-[#B58900]/70 text-black hover:bg-[#C89600] shadow-amber-900/40'
        }`}
        title={
          isAutoScrolling
            ? 'Pause autoscroll (Space) • Hold for stage options'
            : 'Start autoscroll (Space) • Hold for stage options'
        }
        aria-label={
          isAutoScrolling
            ? 'Pause autoscroll. Long press to open stage options'
            : 'Start autoscroll. Long press to open stage options'
        }
      >
        {isAutoScrolling ? (
          <Pause className="w-5 h-5 fill-current" />
        ) : (
          <Play className="w-5 h-5 fill-current ml-0.5" />
        )}
      </button>

      {/* Next Section Button */}
      <button
        type="button"
        disabled={!canNextSection}
        onPointerDown={(e) => handlePointerStart(e, 'next')}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer select-none active:scale-90 ${
          canNextSection
            ? 'bg-[#002B36]/90 border border-[#1A4A55] text-[#EEE8D5] hover:text-[#2AA198] hover:border-[#2AA198]/60 shadow-md'
            : 'bg-[#002B36]/40 border border-[#1A4A55]/30 text-[#93A1A1]/30 cursor-not-allowed'
        }`}
        title={canNextSection ? 'Next Section' : 'No next section'}
        aria-label="Jump to next section"
      >
        <ChevronDown className="w-5 h-5 stroke-[2.5]" />
      </button>
    </div>
  )
}
