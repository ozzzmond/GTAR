import { useEffect, useRef, useState } from 'react'
import { X, ListPlus } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { isSongInSetlist } from '../utils/setlistSongs'

interface Props {
  song: ActiveSongState
  setlists: WebSetlist[]
  onMembershipChange: (songId: string | number, setlistId: string | number, included: boolean) => void
  onCreate: (songId: string | number, name: string) => void
  onClose: () => void
}

export function SongSetlistDialog({ song, setlists, onMembershipChange, onCreate, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => setFeedback(''), 3000)
    return () => clearTimeout(timer)
  }, [feedback])
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="song-setlists-title"
    onClick={event => { if (event.target === event.currentTarget) onClose() }}
    className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60">
    <div className="p-5" onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="song-setlists-title" className="font-bold flex items-center gap-2"><ListPlus className="w-5 h-5 text-app-action" />Add to Setlist</h2>
        <button type="button" onClick={onClose} aria-label="Close setlist selector" className="p-2 rounded-lg hover:bg-app-base"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-sm text-app-muted mt-1 mb-4 break-words">{song.title}</p>
      <div className="max-h-[40vh] overflow-y-auto space-y-1">
        {setlists.length === 0 && <p className="text-sm text-app-muted py-3">No setlists yet. Create one below.</p>}
        {setlists.map(setlist => <label key={setlist.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-app-base cursor-pointer">
          <input type="checkbox" className="accent-app-action w-4 h-4 shrink-0"
            checked={song.id !== undefined && isSongInSetlist(setlist, song.id)}
            onChange={event => {
              if (song.id === undefined) return
              onMembershipChange(song.id, setlist.id, event.target.checked)
              setFeedback(`${event.target.checked ? 'Added to' : 'Removed from'} ${setlist.name}`)
            }} />
          <span className="text-sm break-words min-w-0">{setlist.name}</span>
        </label>)}
      </div>
      <form className="border-t border-app-border mt-4 pt-4" onSubmit={event => {
        event.preventDefault()
        if (!name.trim() || song.id === undefined) return
        onCreate(song.id, name.trim())
        setFeedback(`Added to ${name.trim()}`)
        setName('')
      }}>
        <label htmlFor="quick-setlist-name" className="text-xs font-semibold">Create New Setlist</label>
        <div className="flex gap-2 mt-2">
          <input id="quick-setlist-name" value={name} onChange={event => setName(event.target.value)} maxLength={120}
            placeholder="Setlist name" className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-base p-2 text-sm" />
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-app-action text-app-on-action px-3 text-xs font-bold disabled:opacity-40">Create &amp; Add</button>
        </div>
      </form>
      <p role="status" className="min-h-5 text-xs text-app-action mt-3">{feedback}</p>
    </div>
  </dialog>
}
