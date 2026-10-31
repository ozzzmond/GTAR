import { useMemo, useState } from 'react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { resolveSetlistSongIndexed, songIdIndex } from '../utils/setlistSongs'
import { MultiSongSetlistPicker } from './MultiSongSetlistPicker'

interface Props {
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  selected?: WebSetlist
  unfiled: boolean
  onSelect: (id: string | number) => void
  onCollection: () => void
  onPlay?: (id: string | number, index: number) => void
  onEdit: (setlist: WebSetlist) => void
  onNew?: () => void
  onAdd?: (ids: Array<string | number>, id: string | number) => boolean
}

export function SetlistExplorer({ songs, setlists, selected, unfiled, onSelect, onCollection, onPlay, onEdit, onNew, onAdd }: Props) {
  const [pickerFor, setPickerFor] = useState<string | number | null>(null)
  const index = useMemo(() => songIdIndex(songs), [songs])
  const entries = selected?.songs.map(ref => resolveSetlistSongIndexed(ref, songs, index)) ?? []
  const firstPlayable = entries.findIndex(song => song && !song.isDeleted)
  const collectionName = unfiled ? 'Unfiled Setlists' : 'All Setlists'
  const control = 'min-h-11 px-3 py-2 rounded-lg border border-app-border text-app-action disabled:opacity-50'
  return <section aria-label={selected ? 'Selected setlist songs' : collectionName} className="mb-5 text-app-text min-w-0">
    <nav aria-label="Setlist breadcrumbs" className="flex flex-wrap items-center gap-2 mb-3 text-sm">
      <button type="button" className="min-h-11 text-app-action" onClick={onCollection} aria-current={!selected ? 'page' : undefined}>{collectionName}</button>
      {selected && <><span aria-hidden="true">/</span><span aria-current="page" className="break-words min-w-0">{selected.name}</span></>}
    </nav>
    {selected ? <>
      <h2 className="text-xl font-bold text-app-heading break-words">{selected.name}</h2>
      <p className="text-sm text-app-muted my-2">{selected.songs.length} songs</p>
      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" className={control} disabled={firstPlayable < 0 || !onPlay} onClick={() => onPlay?.(selected.id, firstPlayable)}>Play in Stage</button>
        <button type="button" className={control} onClick={() => onEdit(selected)}>Edit in Setlist Manager</button>
        {onAdd && <button type="button" className={control} onClick={() => setPickerFor(selected.id)}>Search Songs</button>}
      </div>
      {!selected.songs.length && <p>This setlist is empty.</p>}
      <ol className="space-y-1 rounded-xl border border-app-border bg-app-surface p-2">
        {selected.songs.map((ref, position) => {
          const song = entries[position]
          return <li key={position}><button type="button" className="explorer-item rounded-lg hover:bg-app-hover disabled:opacity-60" disabled={!song || song.isDeleted || !onPlay} onClick={() => onPlay?.(selected.id, position)}>
            <span className="text-app-muted">{position + 1}.</span>
            <span className="min-w-0 text-left break-words">{song?.title || ref.title || 'Untitled Song'}{!song || song.isDeleted ? ' — Unavailable song' : ''}</span>
            {ref.transposeOffset !== undefined && <span className="ml-auto text-sm shrink-0">Transpose {ref.transposeOffset > 0 ? '+' : ''}{ref.transposeOffset}</span>}
          </button></li>
        })}
      </ol>
      {onAdd && pickerFor !== null && String(pickerFor) === String(selected.id) && <MultiSongSetlistPicker key={selected.id} songs={songs} setlist={selected} onAdd={onAdd} onClose={() => setPickerFor(null)} />}
    </> : <>
      <div className="flex flex-wrap justify-between gap-2 mb-4"><h2 className="text-xl font-bold text-app-heading">{collectionName}</h2>{onNew && <button type="button" className={control} onClick={onNew}>New Setlist</button>}</div>
      {!setlists.length && <p>No setlists found.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="setlist-collection">
        {setlists.map(setlist => <button type="button" key={setlist.id} data-testid={`setlist-card-${setlist.id}`} onClick={() => onSelect(setlist.id)} className="min-w-0 text-left rounded-xl border border-app-border bg-app-surface hover:bg-app-hover p-4 min-h-24">
          <span className="block font-bold text-app-heading break-words">{setlist.name}</span>
          <span className="block text-sm text-app-muted mt-2">{setlist.songs.length} songs</span>
          {setlist.updatedAt !== undefined && Number.isFinite(setlist.updatedAt) && <span className="block text-xs text-app-muted mt-1">Updated {new Date(setlist.updatedAt).toLocaleDateString()}</span>}
        </button>)}
      </div>
    </>}
  </section>
}
