import React, { useEffect, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { MusicExplorerNav, type MusicExplorerNavProps } from './MusicExplorerNav'

const COLLAPSED_KEY = 'gtar_explorer_collapsed'

export function ExplorerNavigation({ isOpen, onClose, ...nav }: MusicExplorerNavProps & { isOpen: boolean; onClose: () => void }): React.ReactElement {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true' } catch { return false }
  })
  const drawer = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  const toggle = () => setCollapsed(value => {
    const next = !value
    try { localStorage.setItem(COLLAPSED_KEY, String(next)) } catch { /* Device preference is optional. */ }
    return next
  })
  useEffect(() => {
    if (!isOpen) return
    if (window.innerWidth >= 1024) {
      let active = true
      void Promise.resolve().then(() => {
        if (!active) return
        setCollapsed(false)
        try { localStorage.setItem(COLLAPSED_KEY, 'false') } catch { /* Device preference is optional. */ }
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
      const buttons = [...(drawer.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const resize = () => { if (window.innerWidth >= 1024) close.current() }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('resize', resize)
    return () => {
      document.body.style.overflow = priorOverflow
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('resize', resize)
      opener?.focus()
    }
  }, [isOpen])
  const drawerNav = {
    ...nav,
    onSelect: (target: Parameters<MusicExplorerNavProps['onSelect']>[0]) => { nav.onSelect(target); onClose() },
    onNewSong: () => { nav.onNewSong(); onClose() },
    onNewSetlist: () => { nav.onNewSetlist(); onClose() },
    onOpenSources: nav.onOpenSources ? () => { nav.onOpenSources?.(); onClose() } : undefined,
  }
  return <>
    <aside data-testid="explorer-sidebar" data-collapsed={collapsed} aria-label="Music Explorer sidebar"
      className={`hidden lg:flex shrink-0 flex-col border-r border-app-border bg-app-toolbar ${collapsed ? 'w-14' : 'w-64 xl:w-72'}`}>
      <div className="flex min-h-12 items-center justify-between px-1">
        {!collapsed && <span className="pl-3 text-xs font-semibold text-app-heading">Music Explorer</span>}
        <button type="button" aria-label={collapsed ? 'Expand Music Explorer' : 'Collapse Music Explorer'} aria-expanded={!collapsed}
          onClick={toggle} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-app-muted hover:bg-app-surface hover:text-app-heading">
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
      </div>
      {!collapsed && <div className="overflow-y-auto"><MusicExplorerNav {...nav} /></div>}
    </aside>
    {isOpen && <div role="dialog" aria-modal="true" aria-label="Music Explorer drawer"
      className="lg:hidden fixed inset-0 z-50 flex" data-testid="music-explorer-drawer">
      <button type="button" tabIndex={-1} aria-label="Dismiss Music Explorer" onClick={onClose}
        className="fixed inset-0 bg-app-base/80" />
      <div ref={drawer} className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-app-border bg-app-toolbar shadow-xl">
        <div className="flex min-h-12 items-center justify-between pl-4 pr-1">
          <span className="text-xs font-semibold text-app-heading">Music Explorer</span>
          <button type="button" aria-label="Close Music Explorer" onClick={onClose}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-app-muted hover:bg-app-surface">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto"><MusicExplorerNav {...drawerNav} /></div>
      </div>
    </div>}
  </>
}
