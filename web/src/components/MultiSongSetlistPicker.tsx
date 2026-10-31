import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { matchesSongTags } from '../utils/songTags'
import { isSongInSetlist } from '../utils/setlistSongs'

interface Props {
  songs: ActiveSongState[]
  setlist: WebSetlist
  onAdd: (ids: Array<string | number>, setlistId: string | number) => boolean
  onClose: () => void
}

/** Selection is local until confirmation; Set insertion order is the append order. */
export function MultiSongSetlistPicker({ songs, setlist, onAdd, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const available = useMemo(() => {
    const unique = new Map<string, ActiveSongState>()
    for (const song of songs) if (song.id !== undefined && !song.isDeleted && !unique.has(String(song.id))) unique.set(String(song.id), song)
    return unique
  }, [songs])
  const selectedIds = [...selected].filter(id => available.has(id)).map(id => available.get(id)!.id!)
  const q = query.trim().toLowerCase()
  const results = [...available.values()].filter(song => !q || song.title.toLowerCase().includes(q) || song.artist?.toLowerCase().includes(q) || matchesSongTags(song.tags, q))
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    element.showModal()
    element.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    return () => { element.close(); trigger?.focus() }
  }, [])
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}
    className="m-auto w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-app-border bg-app-surface text-app-text p-4 sm:p-6 shadow-2xl backdrop:bg-black/60">
    <h2 id={titleId} className="font-bold text-app-heading break-words">Search Songs — {setlist.name}</h2>
    <label htmlFor={searchId} className="block text-sm mt-4 mb-1">Title, artist, or tags</label>
    <input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)}
      className="w-full min-h-11 rounded-lg border border-app-border bg-app-base p-2" />
    <div className="flex flex-wrap items-center gap-3 my-3">
      <span role="status">{selectedIds.length} songs selected</span>
      <button type="button" className="min-h-11 px-3 text-app-action disabled:opacity-50" disabled={!selectedIds.length} onClick={() => setSelected(new Set())}>Clear selection</button>
    </div>
    <div aria-label="Song search results" className="max-h-[40dvh] overflow-y-auto space-y-1">
      {!available.size ? <p>Your local songbook is empty.</p> : !results.length ? <p>No songs match your search.</p> : results.map(song => <label key={String(song.id)} className="flex min-h-11 items-center gap-3 p-3 rounded-lg hover:bg-app-hover cursor-pointer">
        <input type="checkbox" checked={selected.has(String(song.id))} onChange={event => {
          const checked = event.target.checked
          setSelected(previous => { const next = new Set(previous); if (checked) next.add(String(song.id)); else next.delete(String(song.id)); return next })
        }} className="w-5 h-5 shrink-0 accent-app-action" />
        <span className="min-w-0 break-words"><span className="font-semibold">{song.title}</span><span className="block text-sm text-app-muted">{song.artist || 'Unknown artist'}{isSongInSetlist(setlist, song.id!) ? ' · In setlist' : ''}</span></span>
      </label>)}
    </div>
    {error && <p role="alert" className="text-status-error mt-3">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2 mt-4">
      <button type="button" className="min-h-11 px-4 rounded-lg border border-app-border" onClick={onClose}>Cancel</button>
      <button type="button" disabled={!selectedIds.length} className="min-h-11 px-4 rounded-lg bg-app-action text-app-on-action disabled:opacity-50" onClick={() => {
        if (submitting.current) return
        submitting.current = true
        try {
          if (onAdd(selectedIds, setlist.id) === true) onClose()
          else setError('Could not save setlist. Please try again.')
        } catch { setError('Could not save setlist. Please try again.') }
        finally { submitting.current = false }
      }}>Add selected songs</button>
    </div>
  </dialog>
}
