import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ListMusic, Play, Search, Trash2, X } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { resolveSetlistSongIndexed, songIdIndex } from '../utils/setlistSongs'
import { transposeContext } from '../utils/songKeySemantics'
import { MultiSongSetlistPicker } from './MultiSongSetlistPicker'
import { dangerButton, primaryButton, secondaryButton, sectionCard, sectionLabel } from './backupCenterUi'

/**
 * #312 S2: GTAR1 Setlist Manager, ported from GTAR1 @ da2bdee src/components/SetlistManager.tsx.
 * DEV-only. No folders (B3/S4), no per-entry transpose, no entryId: every write goes through
 * App's guarded setlist handlers, which return false when nothing was saved.
 */
export interface SetlistManagerProps {
  /** Active setlists (deleted ones already removed). */
  setlists: WebSetlist[]
  songs: ActiveSongState[]
  selectedSetlistId: string | number | null
  onSelectSetlist: (setlistId: string | number) => void
  onClose: () => void
  onRenameSetlist: (setlistId: string | number, name: string) => boolean
  onDeleteSetlist: (setlistId: string | number) => boolean
  onMoveSong: (setlistId: string | number, index: number, direction: 'up' | 'down') => boolean
  onRemoveSong: (setlistId: string | number, index: number) => boolean
  /** One guarded add of every song id, in order. */
  onAddSongs: (setlistId: string | number, songIds: Array<string | number>) => boolean | Promise<boolean>
  onPlaySetlist?: (setlistId: string | number, position: number) => void
  /** True while Stage (or another app surface that owns the keyboard) is active. */
  shortcutsBlocked?: boolean
}

const iconButton = 'w-11 h-11 shrink-0 rounded-lg flex items-center justify-center text-app-muted hover:text-app-heading hover:bg-app-base border border-app-border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed'
const inlineButton = secondaryButton.replace('flex items-center', 'inline-flex items-center')
const field = 'min-h-11 bg-app-base border border-app-border rounded-lg px-3 text-sm text-app-text focus:outline-none focus:border-app-action'
const plural = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`

const isTyping = (el: EventTarget | null) => {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false
  const node = el as HTMLElement
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || node.isContentEditable
}

export const SetlistManager: React.FC<SetlistManagerProps> = ({
  setlists,
  songs,
  selectedSetlistId,
  onSelectSetlist,
  onClose,
  onRenameSetlist,
  onDeleteSetlist,
  onMoveSong,
  onRemoveSong,
  onAddSongs,
  onPlaySetlist,
  shortcutsBlocked = false,
}) => {
  const current = useMemo(
    () => setlists.find(sl => String(sl.id) === String(selectedSetlistId)) || setlists[0] || null,
    [setlists, selectedSetlistId]
  )
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [shortcutSongId, setShortcutSongId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const songIndex = useMemo(() => songIdIndex(songs), [songs])
  const activeSongs = useMemo(() => songs.filter(song => song.id !== undefined && !song.isDeleted), [songs])
  const entries = useMemo(() => (current?.songs || []).map(ref => {
    const song = resolveSetlistSongIndexed(ref, songs, songIndex)
    const available = song && !song.isDeleted ? song : undefined
    return {
      title: available?.title || ref.title || 'Untitled Song',
      artist: available?.artist || ref.artist || '',
      available: Boolean(available),
      performanceKey: available ? transposeContext(available, available.transposeOffset || 0).performanceKey : '',
    }
  }), [current, songs, songIndex])
  const firstPlayable = entries.findIndex(entry => entry.available)
  const memberIds = useMemo(() => new Set((current?.songs || []).filter(ref => ref.id !== undefined).map(ref => String(ref.id))), [current])
  const shortcutOptions = useMemo(() => activeSongs.filter(song => !memberIds.has(String(song.id))), [activeSongs, memberIds])

  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current) }, [])
  const report = (ok: boolean, success: string) => {
    if (statusTimer.current) clearTimeout(statusTimer.current)
    setStatus(ok ? { tone: 'success', text: success } : { tone: 'error', text: 'Not saved. Nothing was changed.' })
    statusTimer.current = setTimeout(() => setStatus(null), 3000)
    return ok
  }

  // Scoped shortcut: Ctrl+K / Alt+S toggles the picker. Ignored while typing elsewhere, while
  // Stage is active (shortcutsBlocked), and while any other dialog is open.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && key === 'k'
      const altS = e.altKey && !e.ctrlKey && !e.metaKey && key === 's'
      if ((!ctrlK && !altS) || !current || shortcutsBlocked || confirmDelete) return
      const target = e.target as HTMLElement | null
      if (isTyping(target) && target?.id !== 'multi-song-search-input') return
      const otherDialog = [...document.querySelectorAll('[aria-modal="true"]')].some(el =>
        el !== dialogRef.current && el.getAttribute('aria-label') !== 'Multi-song search picker')
      if (otherDialog) return
      e.preventDefault()
      setIsPickerOpen(open => !open)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [current, shortcutsBlocked, confirmDelete])

  const handleRename = () => {
    if (!current) return
    const name = nameInput.trim()
    if (!name || name === current.name) { setEditingName(false); return }
    if (report(onRenameSetlist(current.id, name), `Renamed to "${name}"`)) setEditingName(false)
  }
  const handleAddShortcut = async () => {
    if (!current || !shortcutSongId) return
    const song = activeSongs.find(s => String(s.id) === shortcutSongId)
    if (!song || song.id === undefined) return
    if (report(await onAddSongs(current.id, [song.id]), `Added "${song.title}" to setlist`)) setShortcutSongId('')
  }
  const handlePickerAdd = async (picked: ActiveSongState[]) => {
    if (!current) return false
    const ids = picked.map(s => s.id).filter((id): id is string | number => id !== undefined)
    const ok = await onAddSongs(current.id, ids)
    if (ok) report(true, `Added ${plural(ids.length)} to setlist`)
    return ok
  }
  const handleDelete = () => {
    if (!current) return
    setConfirmDelete(false)
    report(onDeleteSetlist(current.id), `Deleted "${current.name}"`)
  }

  return (
    <div
      data-testid="setlist-manager-backdrop"
      className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Setlist Manager"
        data-testid="setlist-manager"
        className="w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-2xl border-app-border sm:border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col"
      >
        <div data-testid="setlist-manager-header" className="px-4 sm:px-5 py-2 border-b border-app-border/80 flex items-center justify-between gap-2 bg-app-base/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
              <ListMusic className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 className="font-extrabold text-sm sm:text-base tracking-wide">Setlist Manager</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Setlist Manager"
            className="w-11 h-11 -mr-2 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {!current ? (
            <div data-testid="setlist-manager-no-setlists" className={`${sectionCard} text-center text-xs text-app-muted py-10`}>
              No setlists yet. Create one from the Music Explorer.
            </div>
          ) : (
            <>
              <div className={sectionCard}>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="setlist-manager-select" className={sectionLabel}>Setlist</label>
                  <span className="text-[11px] text-app-muted">{plural(entries.length)}</span>
                </div>
                {setlists.length > 1 && (
                  <select
                    id="setlist-manager-select"
                    data-testid="setlist-manager-select"
                    value={String(current.id)}
                    onChange={e => {
                      const next = setlists.find(sl => String(sl.id) === e.target.value)
                      if (next) { setEditingName(false); setConfirmDelete(false); setStatus(null); onSelectSetlist(next.id) }
                    }}
                    className={`${field} w-full`}
                  >
                    {setlists.map(sl => <option key={sl.id} value={String(sl.id)}>{sl.name}</option>)}
                  </select>
                )}
                {editingName ? (
                  <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); handleRename() }}>
                    <input
                      data-testid="setlist-manager-rename-input"
                      aria-label="Setlist name"
                      value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditingName(false) } }}
                      autoFocus
                      className={`${field} flex-1 min-w-[180px] font-bold text-app-heading`}
                    />
                    <button type="submit" className={`${inlineButton} bg-app-action text-app-on-action border-app-action hover:bg-app-action`}>Save</button>
                    <button type="button" onClick={() => setEditingName(false)} className={inlineButton}>Cancel</button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 data-testid="setlist-manager-name" className="ui-primary-text text-lg font-bold text-app-heading break-words min-w-0">{current.name}</h3>
                    <button type="button" onClick={() => { setNameInput(current.name); setEditingName(true) }} className={inlineButton}>Rename</button>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {onPlaySetlist && entries.length > 0 && (
                    <button type="button" disabled={firstPlayable < 0} onClick={() => onPlaySetlist(current.id, firstPlayable)} className={primaryButton}>
                      <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                      <span>Play Setlist in Stage</span>
                    </button>
                  )}
                  <button type="button" onClick={() => setConfirmDelete(true)} className={dangerButton}>
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Delete Setlist</span>
                  </button>
                </div>
              </div>

              <div className={sectionCard}>
                <span className={sectionLabel}>Add songs</span>
                <button
                  ref={searchTriggerRef}
                  type="button"
                  onClick={() => setIsPickerOpen(open => !open)}
                  aria-expanded={isPickerOpen}
                  aria-keyshortcuts="Control+K Alt+S"
                  className={primaryButton}
                >
                  <Search className="w-4 h-4" aria-hidden="true" />
                  <span>Search Songs (Outlook-style Picker)</span>
                  <kbd className="hidden sm:inline-block font-mono text-[10px] bg-app-base/20 px-1.5 py-0.5 rounded">Ctrl+K</kbd>
                </button>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    data-testid="setlist-manager-shortcut-select"
                    aria-label="Song to add"
                    value={shortcutSongId}
                    onChange={e => setShortcutSongId(e.target.value)}
                    className={`${field} flex-1 min-w-0`}
                  >
                    <option value="">Select a song to add…</option>
                    {shortcutOptions.map(song => (
                      <option key={String(song.id)} value={String(song.id)}>
                        {song.title}{song.artist ? ` — ${song.artist}` : ''}{song.key ? ` (${song.key})` : ''}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={!shortcutSongId} onClick={() => void handleAddShortcut()} className={secondaryButton}>
                    + Add Shortcut
                  </button>
                </div>
                {status && (
                  <p data-testid="setlist-manager-status" role={status.tone === 'error' ? 'alert' : 'status'}
                    className={`text-xs font-medium ${status.tone === 'error' ? 'text-status-error' : 'text-status-success'}`}>
                    {status.text}
                  </p>
                )}
              </div>

              <div className={sectionCard}>
                <span className={sectionLabel}>Order</span>
                {entries.length === 0 ? (
                  <div data-testid="setlist-manager-empty" className="py-8 text-center text-xs text-app-muted rounded-xl border border-dashed border-app-border">
                    This setlist has no songs yet. Search songs above to add some.
                  </div>
                ) : (
                  <ol className="space-y-2">
                    {entries.map((entry, index) => (
                      <li
                        key={`${current.id}_${index}`}
                        data-testid={`setlist-manager-entry-${index}`}
                        className={`ui-song-card p-2 pl-3 rounded-xl border flex items-center justify-between gap-2 ${
                          entry.available ? 'bg-app-song border-app-border' : 'bg-status-error/10 border-status-error/30'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-6 shrink-0 text-center text-xs font-mono font-bold text-app-muted">{index + 1}</span>
                          <div className="min-w-0">
                            <div className="ui-primary-text text-sm font-bold text-app-heading line-clamp-2 break-words">{entry.title}</div>
                            <div className="ui-secondary-text text-[11px] text-app-muted flex items-center gap-2 min-w-0">
                              {entry.available
                                ? <span className="truncate">{entry.artist || 'Unknown Artist'}</span>
                                : <span className="text-status-error font-semibold truncate">Unavailable{entry.artist ? ` · ${entry.artist}` : ''}</span>}
                              {entry.performanceKey && <span className="font-mono text-app-accent font-semibold shrink-0">{entry.performanceKey}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" data-testid={`setlist-manager-entry-${index}-up`} disabled={index === 0}
                            onClick={() => report(onMoveSong(current.id, index, 'up'), 'Moved up')}
                            aria-label={`Move ${entry.title} up`} className={iconButton}>
                            <ArrowUp className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button type="button" data-testid={`setlist-manager-entry-${index}-down`} disabled={index === entries.length - 1}
                            onClick={() => report(onMoveSong(current.id, index, 'down'), 'Moved down')}
                            aria-label={`Move ${entry.title} down`} className={iconButton}>
                            <ArrowDown className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button type="button" data-testid={`setlist-manager-entry-${index}-remove`}
                            onClick={() => report(onRemoveSong(current.id, index), `Removed "${entry.title}"`)}
                            aria-label={`Remove ${entry.title} from setlist`} className={`${iconButton} hover:text-status-error`}>
                            <X className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </div>

        {confirmDelete && current && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60">
            <div role="alertdialog" aria-modal="true" aria-label="Delete setlist"
              className="w-full max-w-sm rounded-2xl border border-app-border bg-app-surface p-5 space-y-4 shadow-2xl">
              <p className="text-sm text-app-heading">Delete setlist <strong>{current.name}</strong>? Songs stay in your Songbook.</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" autoFocus onClick={() => setConfirmDelete(false)} className={secondaryButton}>Cancel</button>
                <button type="button" onClick={handleDelete} className={dangerButton}>Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {current && isPickerOpen && (
        <MultiSongSetlistPicker
          isOpen={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          currentSetlist={current}
          allSongs={activeSongs}
          onAddSongs={handlePickerAdd}
          triggerRef={searchTriggerRef}
        />
      )}
    </div>
  )
}
