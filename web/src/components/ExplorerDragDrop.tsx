import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ActiveSongState, SetlistFolder, WebSetlist } from '../types/gtar'
import { songHasTag } from '../utils/songTags'

type Id = string | number
interface Props {
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  folders: SetlistFolder[]
  onTag: (ids: Id[], tag: string) => unknown
  onSetlist: (setlistId: Id, ids: Id[]) => unknown
  onFolder: (id: Id, folderId: string | null) => unknown
  onTrash: (ids: Id[]) => void
  onTouchDrag: () => void
}
type Payload = { kind: 'songs'; ids: Id[] } | { kind: 'setlist'; id: Id }
const sourceSelector = '[data-explorer-drag-songs], [data-explorer-drag-setlist]'
const targetSelector = '[data-explorer-drop-tag], [data-explorer-drop-setlist], [data-explorer-drop-folder], [data-explorer-drop-trash]'
const closest = (target: EventTarget | null, selector: string) => target instanceof window.Element ? target.closest<HTMLElement>(selector) : null

/** Transient gestures only. All writes remain owned by the existing application handlers. */
export function ExplorerDragDrop(props: Props) {
  const current = useRef(props)
  useLayoutEffect(() => { current.current = props }, [props])
  useEffect(() => {
    let payload: Payload | null = null
    let source: HTMLElement | null = null
    let highlighted: HTMLElement | null = null
    const highlight = (target: HTMLElement | null) => {
      highlighted?.removeAttribute('data-explorer-drop-active')
      highlighted = target
      highlighted?.setAttribute('data-explorer-drop-active', 'true')
    }
    let hold: ReturnType<typeof setTimeout> | undefined
    let touchOrigin: { id: number; x: number; y: number; element: HTMLElement } | null = null
    let ghost: HTMLElement | null = null
    let suppressClickUntil = 0
    const reset = () => {
      clearTimeout(hold)
      hold = undefined
      touchOrigin = null
      ghost?.remove()
      ghost = null
      highlight(null)
      source?.removeAttribute('data-explorer-drag-active')
      document.body.removeAttribute('data-explorer-drag-kind')
      source = null
      payload = null
    }
    const start = (element: HTMLElement) => {
      reset()
      try {
        if (element.dataset.explorerDragSongs) {
          const ids: unknown = JSON.parse(element.dataset.explorerDragSongs)
          if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string' || typeof id === 'number')) return false
          payload = { kind: 'songs', ids }
        } else if (element.dataset.explorerDragSetlist) payload = { kind: 'setlist', id: element.dataset.explorerDragSetlist }
        if (!payload) return false
        source = element
        element.dataset.explorerDragActive = 'true'
        document.body.dataset.explorerDragKind = payload.kind
        return true
      } catch { return false }
    }
    const validTarget = (element: HTMLElement | null) => {
      if (!payload || !element) return null
      const { setlists, folders } = current.current
      if (payload.kind === 'songs') {
        if (element.dataset.explorerDropTag !== undefined) return element
        if (element.dataset.explorerDropTrash !== undefined) return element
        if (setlists.some(sl => !sl.isDeleted && String(sl.id) === element.dataset.explorerDropSetlist)) return element
      } else if (element.dataset.explorerDropFolder !== undefined) {
        const folderId = element.dataset.explorerDropFolder
        if (!folderId || folders.some(folder => folder.id === folderId)) return element
      }
      return null
    }
    const drop = (target: HTMLElement | null) => {
      const accepted = validTarget(target)
      const data = payload
      reset()
      if (!accepted || !data) return
      const handlers = current.current
      if (data.kind === 'songs') {
        const ids = data.ids.filter(id => handlers.songs.some(song => !song.isDeleted && String(song.id) === String(id)))
        if (!ids.length) return
        const tag = accepted.dataset.explorerDropTag
        if (tag !== undefined) {
          const missing = ids.filter(id => !songHasTag(handlers.songs.find(song => String(song.id) === String(id))?.tags, tag))
          if (missing.length) handlers.onTag(missing, tag)
        } else if (accepted.dataset.explorerDropSetlist !== undefined) handlers.onSetlist(accepted.dataset.explorerDropSetlist, ids)
        else handlers.onTrash(ids)
      } else {
        const setlist = handlers.setlists.find(sl => !sl.isDeleted && String(sl.id) === String(data.id))
        const folderId = accepted.dataset.explorerDropFolder || null
        if (setlist && (setlist.folderId ?? null) !== folderId) handlers.onFolder(setlist.id, folderId)
      }
    }
    const dragstart = (event: DragEvent) => {
      reset()
      const element = closest(event.target, sourceSelector)
      if (!element || closest(event.target, 'button, input, select, textarea, a')) return
      if (start(element) && event.dataTransfer) {
        event.dataTransfer.effectAllowed = payload?.kind === 'setlist' ? 'move' : 'copyMove'
        // Firefox requires data. Never read external drag payloads on drop.
        event.dataTransfer.setData('text/plain', 'GTAR Explorer')
      }
    }
    const dragover = (event: DragEvent) => {
      const target = validTarget(closest(event.target, targetSelector))
      highlight(target)
      if (target) {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = payload?.kind === 'setlist' || target.dataset.explorerDropTrash !== undefined ? 'move' : 'copy'
      }
    }
    const dragleave = (event: DragEvent) => {
      if (!highlighted?.contains(event.relatedTarget as Node | null)) highlight(null)
    }
    const onDrop = (event: DragEvent) => {
      if (!payload) return
      event.preventDefault()
      drop(closest(event.target, targetSelector))
    }
    const touchstart = (event: TouchEvent) => {
      reset()
      const element = closest(event.target, sourceSelector)
      if (!element || event.touches.length !== 1 || closest(event.target, 'button, input, select, textarea, a')) return
      const touch = event.touches[0]
      touchOrigin = { id: touch.identifier, x: touch.clientX, y: touch.clientY, element }
      hold = setTimeout(() => {
        const origin = touchOrigin
        if (!origin || !origin.element.isConnected || !start(origin.element)) return
        touchOrigin = origin
        ghost = document.createElement('div')
        ghost.className = 'explorer-drag-ghost'
        ghost.setAttribute('aria-hidden', 'true')
        ghost.textContent = payload?.kind === 'songs' ? `${payload.ids.length} ${payload.ids.length === 1 ? 'song' : 'songs'}` : 'Move setlist'
        ghost.style.left = `${origin.x}px`
        ghost.style.top = `${origin.y}px`
        document.body.append(ghost)
        current.current.onTouchDrag()
      }, 400)
    }
    const touchmove = (event: TouchEvent) => {
      if (!touchOrigin) return
      if (event.touches.length !== 1) { reset(); return }
      const touch = event.touches[0]
      if (touch.identifier !== touchOrigin.id) { reset(); return }
      if (!ghost) {
        if (Math.hypot(touch.clientX - touchOrigin.x, touch.clientY - touchOrigin.y) > 8) reset()
        return
      }
      if (!event.cancelable) { reset(); return }
      event.preventDefault()
      event.stopPropagation() // The held gesture must not also arm the existing swipe action.
      ghost.style.left = `${touch.clientX}px`
      ghost.style.top = `${touch.clientY}px`
      highlight(validTarget(closest(document.elementFromPoint(touch.clientX, touch.clientY), targetSelector)))
    }
    const touchend = (event: TouchEvent) => {
      if (!ghost) { reset(); return }
      event.preventDefault()
      event.stopPropagation()
      suppressClickUntil = Date.now() + 500
      const touch = Array.from(event.changedTouches).find(t => t.identifier === touchOrigin?.id)
      drop(touch ? closest(document.elementFromPoint(touch.clientX, touch.clientY), targetSelector) : null)
    }
    const touchcancel = () => {
      if (ghost) suppressClickUntil = Date.now() + 500
      reset()
    }
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation() }
    }
    const contextmenu = (event: Event) => { if (touchOrigin || ghost) event.preventDefault() }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') reset() }
    document.addEventListener('touchstart', touchstart, { capture: true, passive: true })
    document.addEventListener('touchmove', touchmove, { capture: true, passive: false })
    document.addEventListener('touchend', touchend, { capture: true, passive: false })
    document.addEventListener('touchcancel', touchcancel, true)
    document.addEventListener('click', click, true)
    document.addEventListener('contextmenu', contextmenu, true)
    document.addEventListener('dragstart', dragstart)
    document.addEventListener('dragover', dragover)
    document.addEventListener('dragleave', dragleave)
    document.addEventListener('drop', onDrop)
    document.addEventListener('dragend', reset)
    document.addEventListener('keydown', keydown)
    window.addEventListener('blur', reset)
    return () => {
      reset()
      document.removeEventListener('touchstart', touchstart, true)
      document.removeEventListener('touchmove', touchmove, true)
      document.removeEventListener('touchend', touchend, true)
      document.removeEventListener('touchcancel', touchcancel, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('contextmenu', contextmenu, true)
      document.removeEventListener('dragstart', dragstart)
      document.removeEventListener('dragover', dragover)
      document.removeEventListener('dragleave', dragleave)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('dragend', reset)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('blur', reset)
    }
  }, [])
  return null
}
