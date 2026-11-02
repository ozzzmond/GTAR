import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Music, Plus, Search, X } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { parseSearchPhrases, songMatchesPhrase } from '../utils/setlistPickerSearch'
import { trapTab } from '../utils/focusTrap'

/**
 * #312 S2: GTAR1 "Search Songs (Outlook-style Picker)", ported from GTAR1 @ da2bdee
 * src/components/MultiSongSetlistPicker.tsx. Search logic lives in utils/setlistPickerSearch.ts; GTAR keeps its
 * no-duplicate membership rule, so songs already in the setlist are marked and not selectable.
 */
export interface MultiSongSetlistPickerProps {
  isOpen: boolean
  onClose: () => void
  currentSetlist: WebSetlist
  allSongs: ActiveSongState[]
  /** One add for every selected song, in selection order. Resolves false (or throws) when nothing was saved. */
  onAddSongs: (songsToAdd: ActiveSongState[]) => Promise<boolean | void> | boolean | void
  triggerRef?: React.RefObject<HTMLButtonElement | null>
}

const songKey = (song: ActiveSongState) => String(song.id)

const touch = 'min-h-11'
const iconButton = 'w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer'
const plural = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`

export const MultiSongSetlistPicker: React.FC<MultiSongSetlistPickerProps> = ({
  isOpen,
  onClose,
  currentSetlist,
  allSongs,
  onAddSongs,
  triggerRef,
}) => {
  const [inputValue, setInputValue] = useState('')
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeHighlightIndex, setActiveHighlightIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const songs = useMemo(() => allSongs.filter(song => song.id !== undefined && !song.isDeleted), [allSongs])
  const songMap = useMemo(() => new Map(songs.map(song => [songKey(song), song])), [songs])
  const inSetlist = useMemo(() => new Set(
    (currentSetlist?.songs || []).filter(ref => ref.id !== undefined).map(ref => String(ref.id))
  ), [currentSetlist])

  const activeSearchPhrases = useMemo(() => parseSearchPhrases(inputValue, songs), [inputValue, songs])
  const filteredSongs = useMemo(() => {
    if (activeSearchPhrases.length === 0) return songs
    const matched: ActiveSongState[] = []
    const seen = new Set<string>()
    for (const phrase of activeSearchPhrases) {
      for (const song of songs) {
        if (!seen.has(songKey(song)) && songMatchesPhrase(song, phrase)) {
          seen.add(songKey(song))
          matched.push(song)
        }
      }
    }
    return matched
  }, [songs, activeSearchPhrases])
  const selectedSongsInOrder = useMemo(
    () => selectedSongIds.map(id => songMap.get(id)).filter((s): s is ActiveSongState => Boolean(s)),
    [selectedSongIds, songMap]
  )

  // The manager mounts the picker on open, so state starts fresh each time.
  useEffect(() => { if (isOpen) inputRef.current?.focus() }, [isOpen])

  const close = () => {
    if (isSubmitting) return
    onClose()
    triggerRef?.current?.focus()
  }
  const toggle = (id: string) => {
    if (inSetlist.has(id)) return
    setSelectedSongIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }
  const selectAllMatching = () => setSelectedSongIds(prev => {
    const next = [...prev]
    for (const song of filteredSongs) if (!inSetlist.has(songKey(song)) && !next.includes(songKey(song))) next.push(songKey(song))
    return next
  })

  const addSelected = async () => {
    if (selectedSongsInOrder.length === 0 || isSubmitting) return
    setIsSubmitting(true)
    setErrorMessage(null)
    let saved: boolean
    try {
      saved = (await onAddSongs(selectedSongsInOrder)) !== false
    } catch {
      saved = false
    }
    setIsSubmitting(false)
    if (!saved) {
      setErrorMessage('Songs were not added. Nothing was changed; try again.')
      return
    }
    setSelectedSongIds([])
    setInputValue('')
    onClose()
    triggerRef?.current?.focus()
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (activeHighlightIndex >= 0 && activeHighlightIndex < filteredSongs.length) toggle(songKey(filteredSongs[activeHighlightIndex]))
      else if (selectedSongIds.length > 0) void addSelected()
      else if (filteredSongs.length === 1) toggle(songKey(filteredSongs[0]))
    } else if (e.key === 'Backspace' && inputValue === '' && selectedSongIds.length > 0) {
      setSelectedSongIds(prev => prev.slice(0, -1))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveHighlightIndex(prev => (prev + 1 < filteredSongs.length ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveHighlightIndex(prev => Math.max(-1, prev - 1))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  if (!isOpen) return null
  const count = selectedSongIds.length
  const addLabel = count === 0 ? 'Add Selected to Setlist' : count === 1 ? 'Add 1 Selected Song' : `Add ${count} Selected Songs`

  return (
    <div
      data-testid="multi-song-picker-backdrop"
      onClick={e => { if (e.target === e.currentTarget) close() }}
      className="fixed inset-0 z-[110] flex items-stretch sm:items-center justify-center sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        onKeyDown={e => {
          if (trapTab(e, dialogRef.current)) return
          if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close() }
        }}
        aria-modal="true"
        aria-label="Multi-song search picker"
        className="w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl border-app-border sm:border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-4 sm:px-5 py-2 border-b border-app-border/80 flex items-center justify-between gap-2 bg-app-base/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
              <Search className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-extrabold text-sm sm:text-base tracking-wide">Search Songs to Add</h2>
              <p className="text-[11px] text-app-muted truncate">
                Add songs to <strong className="text-app-text">{currentSetlist.name}</strong> in one action
              </p>
            </div>
          </div>
          <button type="button" onClick={close} className={`${iconButton} -mr-2`} aria-label="Close search picker (Esc)">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3 flex flex-col flex-1 min-h-0">
          <div className="space-y-1.5">
            <label htmlFor="multi-song-search-input" className="block text-xs font-semibold text-app-heading">
              Search title, artist, key or tag
            </label>
            <div
              onClick={() => inputRef.current?.focus()}
              className="min-h-11 w-full bg-app-base border border-app-border rounded-xl px-2 py-1 flex flex-wrap items-center gap-1.5 focus-within:border-app-action cursor-text"
            >
              {selectedSongsInOrder.map(song => (
                <span key={songKey(song)} className="inline-flex items-center gap-1 bg-app-action/15 border border-app-action/40 text-app-action text-xs pl-2 rounded-lg font-semibold">
                  <Music className="w-3 h-3" aria-hidden="true" />
                  <span className="max-w-[140px] truncate">{song.title}</span>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); toggle(songKey(song)) }}
                    className="min-h-11 min-w-8 flex items-center justify-center text-app-action/70 hover:text-status-error cursor-pointer"
                    aria-label={`Deselect ${song.title}`}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                id="multi-song-search-input"
                ref={inputRef}
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                value={inputValue}
                onChange={e => { setInputValue(e.target.value); setActiveHighlightIndex(-1) }}
                onKeyDown={handleInputKeyDown}
                placeholder="e.g. Goodness of God, key:G, artist:Bethel"
                className="flex-1 min-w-[160px] min-h-9 bg-transparent text-sm text-app-text placeholder:text-app-muted/70 focus:outline-none px-1"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span aria-live="polite" data-testid="picker-selected-count" className="font-semibold text-app-heading">
              {plural(count)} selected <span className="text-app-muted font-normal">({filteredSongs.length} matching)</span>
            </span>
            {filteredSongs.length > 0 && (
              <button type="button" onClick={selectAllMatching} className={`${touch} px-2 text-app-link hover:underline font-semibold cursor-pointer`}>
                Select all matching
              </button>
            )}
            {count > 0 && (
              <button type="button" onClick={() => setSelectedSongIds([])} className={`${touch} px-2 text-app-muted hover:text-status-error cursor-pointer`}>
                Clear
              </button>
            )}
          </div>

          {errorMessage && (
            <div role="alert" className="text-xs text-status-error bg-status-error/10 p-2.5 rounded-lg border border-status-error/20 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div role="listbox" aria-multiselectable="true" aria-label="Available songs"
            className="flex-1 min-h-0 sm:max-h-80 overflow-y-auto space-y-1.5 rounded-xl border border-app-border/60 bg-app-base/60 p-2">
            {songs.length === 0 ? (
              <div className="py-8 text-center text-app-muted text-xs">
                <Music className="w-6 h-6 mx-auto mb-2 opacity-50" aria-hidden="true" />
                <p className="font-semibold">Your songbook is empty.</p>
                <p className="mt-1">Import or create songs first.</p>
              </div>
            ) : filteredSongs.length === 0 ? (
              <div className="py-8 text-center text-app-muted text-xs">
                <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-50" aria-hidden="true" />
                <p className="font-semibold">No songs match your search.</p>
                <p className="mt-1">Separate several titles with commas, or use key:, artist: or title:.</p>
              </div>
            ) : filteredSongs.map((song, idx) => {
              const id = songKey(song)
              const isSelected = selectedSongIds.includes(id)
              const already = inSetlist.has(id)
              const highlighted = idx === activeHighlightIndex
              return (
                <div
                  key={id}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={already ? 'true' : undefined}
                  tabIndex={already ? -1 : 0}
                  onClick={() => toggle(id)}
                  onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(id) } }}
                  className={`min-h-11 px-3 py-2 rounded-xl border flex items-center gap-3 select-none transition-colors ${
                    already ? 'opacity-60 cursor-not-allowed bg-app-base border-app-border/60'
                      : isSelected ? 'bg-app-action/15 border-app-action/60 cursor-pointer'
                        : highlighted ? 'bg-app-surface border-app-action/40 cursor-pointer'
                          : 'bg-app-base hover:bg-app-surface border-app-border/60 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    readOnly
                    checked={isSelected || already}
                    disabled={already}
                    aria-hidden="true"
                    className="w-5 h-5 shrink-0 accent-app-action pointer-events-none"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span data-testid="picker-option-title" className="font-bold text-app-heading text-sm truncate">{song.title}</span>
                      {already && (
                        <span className="shrink-0 text-[10px] bg-app-accent/15 text-app-accent border border-app-accent/30 rounded px-1.5 font-medium">
                          In setlist
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-app-muted flex items-center gap-2 mt-0.5 min-w-0">
                      <span className="truncate">{song.artist || 'Unknown Artist'}</span>
                      {song.key && <span className="font-mono text-app-accent shrink-0 font-semibold">Key: {song.key}</span>}
                      {song.bpm && String(song.bpm).trim() && <span className="shrink-0">{String(song.bpm).replace(/\s*bpm$/i, '')} BPM</span>}
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />}
                </div>
              )
            })}
          </div>
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-app-border/80 bg-app-base/60 flex items-center justify-end gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={close} disabled={isSubmitting}
            className="min-h-11 py-2 px-4 rounded-lg bg-app-base hover:bg-app-border text-app-heading border border-app-border text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            Cancel
          </button>
          <button type="button" onClick={() => void addSelected()} disabled={count === 0 || isSubmitting}
            className="min-h-11 py-2 px-4 rounded-xl bg-app-action hover:brightness-110 text-app-on-action font-extrabold text-xs flex items-center gap-2 shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {isSubmitting ? <span>Adding to setlist...</span> : <><Plus className="w-4 h-4" aria-hidden="true" /><span>{addLabel}</span></>}
          </button>
        </div>
      </div>
    </div>
  )
}
