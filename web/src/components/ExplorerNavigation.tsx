import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Layers, Menu, Music, PanelLeftClose, Tag, X } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { normalizeTags } from '../utils/songTags'

export type ExplorerTarget =
  | { type: 'all' }
  | { type: 'tag'; tag: string }
  | { type: 'setlists' }
  | { type: 'unfiled' }
  | { type: 'setlist'; id: string | number }

interface Props {
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  selection: ExplorerTarget | null
  onSelect: (target: ExplorerTarget) => void
}

function Navigation({ songs, setlists, selection, onSelect }: Props) {
  const id = useId()
  const [tagsExpanded, setTagsExpanded] = useState(true)
  const [setlistsExpanded, setSetlistsExpanded] = useState(true)
  const tags = useMemo(() => {
    const counts = new Map<string, { tag: string; count: number }>()
    for (const song of songs) for (const tag of normalizeTags(song.tags)) {
      const key = tag.toLowerCase()
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { tag, count: 1 })
    }
    return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag))
  }, [songs])
  const itemClass = 'explorer-item rounded-lg text-app-text hover:bg-app-hover'
  return <nav aria-label="Music Explorer" className="p-3 text-sm space-y-2">
    <button type="button" className={itemClass} aria-current={selection?.type === 'all' ? 'page' : undefined} onClick={() => onSelect({ type: 'all' })}>
      <Music size={18} aria-hidden="true" /><span>All Songs</span><span className="ml-auto text-app-muted">{songs.length}</span>
    </button>
    <button type="button" className={itemClass} aria-expanded={tagsExpanded} aria-controls={`${id}-tags`} onClick={() => setTagsExpanded(!tagsExpanded)}>
      {tagsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<Tag size={16} aria-hidden="true" /><span>Tags / Songbooks</span>
    </button>
    <div id={`${id}-tags`} hidden={!tagsExpanded}>
      {tags.length === 0 && <p className="px-3 py-2 text-xs text-app-muted">No tags yet</p>}
      {tags.map(({ tag, count }) => <button type="button" key={tag} className={`${itemClass} pl-7`} aria-current={selection?.type === 'tag' && selection.tag.toLowerCase() === tag.toLowerCase() ? 'page' : undefined} onClick={() => onSelect({ type: 'tag', tag })}>
        <span className="truncate">{tag}</span><span className="ml-auto text-app-muted">{count}</span>
      </button>)}
    </div>
    <button type="button" className={itemClass} aria-expanded={setlistsExpanded} aria-controls={`${id}-setlists`} onClick={() => setSetlistsExpanded(!setlistsExpanded)}>
      {setlistsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<Layers size={16} aria-hidden="true" /><span>Setlists</span>
    </button>
    <div id={`${id}-setlists`} hidden={!setlistsExpanded}>
      <button type="button" className={`${itemClass} pl-7`} aria-current={selection?.type === 'setlists' ? 'page' : undefined} onClick={() => onSelect({ type: 'setlists' })}>All Setlists<span className="ml-auto text-app-muted">{setlists.length}</span></button>
      <button type="button" className={`${itemClass} pl-7`} aria-current={selection?.type === 'unfiled' ? 'page' : undefined} onClick={() => onSelect({ type: 'unfiled' })}>Unfiled Setlists<span className="ml-auto text-app-muted">{setlists.filter(sl => !sl.folderId).length}</span></button>
      {setlists.map(setlist => <button type="button" key={setlist.id} className={`${itemClass} pl-7`} aria-current={selection?.type === 'setlist' && String(selection.id) === String(setlist.id) ? 'page' : undefined} onClick={() => onSelect({ type: 'setlist', id: setlist.id })}>
        <span className="truncate">{setlist.name}</span><span className="ml-auto text-app-muted">{setlist.songs.length}</span>
      </button>)}
    </div>
  </nav>
}

/** View-only navigation. The only stored value is a device UI preference. */
export function ExplorerNavigation(props: Props) {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem('gtar_explorer_sidebar_visible') !== 'false' } catch { return true }
  })
  const drawer = useRef<HTMLDialogElement>(null)
  const drawerTrigger = useRef<HTMLButtonElement>(null)
  const sidebarId = useId()
  const drawerId = useId()
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => { if (desktop.matches && drawer.current?.open) drawer.current.close() }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])
  const toggle = (next: boolean) => {
    setVisible(next)
    try { localStorage.setItem('gtar_explorer_sidebar_visible', String(next)) } catch { /* Keep the session preference. */ }
  }
  return <>
    <aside id={sidebarId} aria-label="Explorer sidebar" className={`explorer-sidebar bg-app-toolbar border-r border-app-border ${visible ? '' : 'explorer-sidebar-hidden'}`}>
      <div className="flex items-center justify-between p-3 text-app-heading font-semibold">
        <span>Music Explorer</span>
        <button type="button" className="explorer-control" aria-label="Hide Explorer sidebar" aria-controls={sidebarId} aria-expanded={visible} onClick={() => toggle(false)}><PanelLeftClose size={20} /></button>
      </div>
      <Navigation {...props} />
    </aside>
    {!visible && <button type="button" className="explorer-reopen explorer-control bg-app-toolbar text-app-text" aria-label="Show Explorer sidebar" aria-controls={sidebarId} aria-expanded={false} onClick={() => toggle(true)}><Menu size={20} /></button>}
    <button ref={drawerTrigger} type="button" className="explorer-mobile-trigger explorer-control bg-app-toolbar text-app-text" aria-label="Open Music Explorer" aria-haspopup="dialog" aria-controls={drawerId} onClick={() => drawer.current?.showModal()}><Menu size={20} /></button>
    <dialog ref={drawer} id={drawerId} aria-label="Music Explorer drawer" className="explorer-drawer bg-app-toolbar text-app-text border-r border-app-border" onClose={() => drawerTrigger.current?.focus()} onClick={event => { if (event.target === event.currentTarget) drawer.current?.close() }} onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(button => button.getClientRects().length > 0)
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <div className="min-h-full" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between p-3 text-app-heading font-semibold">
          <span>Music Explorer</span>
          <button type="button" autoFocus className="explorer-control" aria-label="Close Music Explorer" onClick={() => drawer.current?.close()}><X size={20} /></button>
        </div>
        <Navigation {...props} onSelect={target => { props.onSelect(target); drawer.current?.close() }} />
      </div>
    </dialog>
  </>
}
