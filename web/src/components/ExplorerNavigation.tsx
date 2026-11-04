import React, { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { MusicExplorerNav, type MusicExplorerNavProps } from './MusicExplorerNav'
import { EXPLORER_MAX_WIDTH, EXPLORER_MIN_WIDTH, clampExplorerWidth } from '../utils/explorerSidebar'

const COLLAPSED_KEY = 'gtar_explorer_collapsed'
const WIDTH_KEY = 'gtar_explorer_width'
const KEY_STEP = 16
/** GTAR1 shows the aside from md (768px); below that the Explorer is a drawer. */
const DESKTOP_QUERY = 768

const readWidth = (): number | null => {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) && value > 0 ? clampExplorerWidth(value) : null
  } catch { return null }
}
const remember = (key: string, value: string) => {
  try { localStorage.setItem(key, value) } catch { /* Device preference is optional. */ }
}

export function ExplorerNavigation({ isOpen, onClose, isHidden = false, ...nav }: MusicExplorerNavProps & { isOpen: boolean; onClose: () => void; isHidden?: boolean }): React.ReactElement | null {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true' } catch { return false }
  })
  // null = GTAR1 default widths (w-64 lg:w-72) until the user resizes on this device.
  const [width, setWidth] = useState<number | null>(readWidth)
  const asideRef = useRef<HTMLElement>(null)
  const gripRef = useRef<HTMLButtonElement>(null)
  const collapseRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<'grip' | 'collapse' | null>(null)
  const drawer = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  const setCollapsedPersisted = (next: boolean) => {
    restoreFocus.current = next ? 'grip' : 'collapse'
    setCollapsed(next)
    remember(COLLAPSED_KEY, String(next))
  }
  useEffect(() => {
    if (restoreFocus.current === 'grip') gripRef.current?.focus({ preventScroll: true })
    else if (restoreFocus.current === 'collapse') collapseRef.current?.focus({ preventScroll: true })
    restoreFocus.current = null
  }, [collapsed])
  const commitWidth = (value: number) => {
    const next = clampExplorerWidth(value)
    setWidth(next)
    remember(WIDTH_KEY, String(next))
  }
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const left = asideRef.current?.getBoundingClientRect().left ?? 0
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const move = (e: PointerEvent) => setWidth(clampExplorerWidth(e.clientX - left))
    const end = (e: PointerEvent) => {
      commitWidth(e.clientX - left)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  const resizeByKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = width ?? (asideRef.current?.getBoundingClientRect().width || 288)
    const next = event.key === 'ArrowLeft' ? current - KEY_STEP
      : event.key === 'ArrowRight' ? current + KEY_STEP
        : event.key === 'Home' ? EXPLORER_MIN_WIDTH
          : event.key === 'End' ? EXPLORER_MAX_WIDTH : null
    if (next === null) return
    event.preventDefault()
    commitWidth(next)
  }
  useEffect(() => {
    if (!isOpen || isHidden) return
    if (window.innerWidth >= DESKTOP_QUERY) {
      let active = true
      void Promise.resolve().then(() => {
        if (!active) return
        setCollapsed(false)
        remember(COLLAPSED_KEY, 'false')
        close.current()
      })
      return () => { active = false }
    }
    const opener = document.activeElement as HTMLElement | null
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const buttons = [...(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])]
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const resize = () => { if (window.innerWidth >= DESKTOP_QUERY) close.current() }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('resize', resize)
    return () => {
      document.body.style.overflow = priorOverflow
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('resize', resize)
      opener?.focus()
    }
  }, [isOpen, isHidden])
  const drawerNav = {
    ...nav,
    onSelect: (target: Parameters<MusicExplorerNavProps['onSelect']>[0]) => { nav.onSelect(target); onClose() },
    onNewSong: () => { nav.onNewSong?.(); onClose() },
    onNewSetlist: () => { nav.onNewSetlist?.(); onClose() },
    onOpenTrash: () => { nav.onOpenTrash?.(); onClose() },
  }
  const collapseButton = (
    <button ref={collapseRef} type="button" data-testid="explorer-collapse" aria-label="Hide Music Explorer" aria-expanded="true"
      aria-controls="explorer-sidebar" onClick={() => setCollapsedPersisted(true)}
      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-app-muted hover:bg-app-surface hover:text-app-heading transition-colors cursor-pointer">
      <ChevronLeft className="h-4 w-4" />
    </button>
  )
  if (isHidden) return null
  return <>
    {collapsed && (
      <button ref={gripRef} type="button" data-testid="explorer-edge-grip" aria-label="Show Music Explorer" aria-expanded="false"
        aria-controls="explorer-sidebar" onClick={() => setCollapsedPersisted(false)}
        className="group relative z-20 hidden md:flex shrink-0 w-3 self-stretch items-start justify-start overflow-visible border-r border-app-border bg-app-toolbar cursor-pointer transition-opacity duration-200 ease-out motion-reduce:transition-none">
        {/* 44px target: the hit area overhangs the 12px edge strip. */}
        <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-start">
          <span className="flex h-11 w-6 items-center justify-center rounded-r-lg border border-l-0 border-app-border bg-app-surface text-app-muted shadow-md group-hover:text-app-heading group-focus-visible:ring-2 group-focus-visible:ring-app-action">
            <ChevronRight className="h-4 w-4" />
          </span>
        </span>
      </button>
    )}
    <aside ref={asideRef} id="explorer-sidebar" data-testid="explorer-sidebar" data-collapsed={collapsed ? 'true' : 'false'}
      aria-label="Music Explorer sidebar" aria-hidden={collapsed}
      inert={collapsed ? true : undefined}
      style={width && !collapsed ? { width } : undefined}
      className={`relative hidden md:block shrink-0 bg-app-toolbar border-r border-app-border transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none overflow-hidden ${
        collapsed ? 'w-0 border-r-0 opacity-0 pointer-events-none' : (width ? '' : 'w-64 lg:w-72')
      }`}>
      <div style={{ width: width ?? 288 }} className="h-full overflow-y-auto"><MusicExplorerNav {...nav} headerAction={collapseButton} /></div>
      {!collapsed && (
        <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize Music Explorer"
          aria-valuemin={EXPLORER_MIN_WIDTH} aria-valuemax={EXPLORER_MAX_WIDTH}
          aria-valuenow={width ?? 288}
          data-testid="explorer-resize-handle" onPointerDown={startResize} onKeyDown={resizeByKey}
          className="absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none outline-none hover:bg-app-action/30 focus-visible:bg-app-action/50" />
      )}
    </aside>
    {isOpen && <div role="dialog" aria-modal="true" aria-label="Music Explorer drawer"
      className="md:hidden fixed inset-0 z-50 flex" data-testid="music-explorer-drawer">
      <button type="button" tabIndex={-1} aria-label="Dismiss Music Explorer" onClick={onClose}
        className="fixed inset-0 bg-app-base/80" />
      <div ref={drawer} className="relative z-10 flex h-full w-72 max-w-[80vw] flex-col border-r border-app-border bg-app-toolbar shadow-2xl">
        <div className="flex-1 overflow-y-auto"><MusicExplorerNav {...drawerNav} headerAction={
          <button type="button" aria-label="Close Music Explorer" onClick={onClose}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-app-muted hover:bg-app-surface">
            <X className="h-4 w-4" />
          </button>
        } /></div>
      </div>
    </div>}
  </>
}
