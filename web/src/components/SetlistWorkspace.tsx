import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronRight, ListMusic, MoreHorizontal, Music, PanelRight, Pencil, Play, Search, Share2, Trash2, Upload, X } from 'lucide-react'
import type { ActiveSongState, SetlistFolder, WebSetlist } from '../types/gtar'
import { resolveSetlistSongIndexed, songIdIndex } from '../utils/setlistSongs'
import { transposeContext } from '../utils/songKeySemantics'
import { DropdownPortal } from './DropdownPortal'
import { SetlistsHelp } from './menuHelp'
import { MultiSongSetlistPicker } from './MultiSongSetlistPicker'
import { SwipeableActionCard } from './SwipeableActionCard'
import { WorkspacePreviewPane } from './WorkspacePreviewPane'
import { useIsDesktop } from '../utils/workspacePreview'

/**
 * #290 S1: GTAR1 setlist workspace (collection + single-setlist views), ported from
 * GTAR1 SongbookHomeView "CASE A"/"CASE B" and its breadcrumb/scope bar. DEV-only;
 * rendered when the Music Explorer target is All Setlists or Unfiled Setlists.
 * S4 folder selections reuse this collection view with a folder breadcrumb label.
 */
export type SetlistWorkspaceScope = 'ALL_SETLISTS' | 'UNFILED_SETLISTS'

export interface SetlistWorkspaceProps {
  scope: SetlistWorkspaceScope
  folderName?: string
  folders?: SetlistFolder[]
  onSetlistFolderChange?: (id: string | number, folderId: string | null) => boolean
  /** Active setlists in display order (already searched and sorted by the caller). */
  setlists: WebSetlist[]
  songs: ActiveSongState[]
  openSetlistId?: string | number | null
  onOpenSetlistChange?: (id: string | number | null) => void
  onSelectScope?: (scope: SetlistWorkspaceScope) => void
  /** Stage entry at an exact setlist position (positions map 1:1 to setlist entries). */
  onPlaySetlistPosition?: (setlistId: string | number, position: number) => void
  /** Opens the exact occurrence using the existing setlist queue. */
  onOpenSong?: (setlistId: string | number, position: number) => void
  /** Manage flow: retained as fallback if caller passes it. */
  onManageSetlist?: (setlist: WebSetlist) => void
  onRequestTrashSetlist?: (id: string | number) => void
  onRenameSetlist?: (setlistId: string | number, name: string) => boolean
  onDeleteSetlist?: (setlistId: string | number) => boolean
  onNewSetlist?: () => void
  onMoveSong?: (setlistId: string | number, index: number, direction: 'up' | 'down') => boolean
  onRemoveSong?: (setlistId: string | number, index: number) => boolean
  /** One guarded add of every song id, in order. */
  onAddSongs?: (setlistId: string | number, songIds: Array<string | number>) => boolean | Promise<boolean>
  shortcutsBlocked?: boolean
  /** Scope-bar ⋯ menu: GTAR-only setlist controls, each bound to its existing handler. */
  menu?: SetlistWorkspaceMenu
  isWorkspaceOpen?: boolean
  onToggleWorkspace?: () => void
  workspaceWidth?: number | null
  onWorkspaceWidthChange?: (width: number) => void
}

export interface SetlistWorkspaceMenu {
  sortValue: string
  sortOptions: Array<{ value: string; label: string }>
  onSortChange: (value: string) => void
  /** Collection QR share (existing main share flow / chooser). */
  onShareAll?: () => void
  /** Single-setlist QR share. */
  onShareSetlist?: (setlist: WebSetlist) => void
  onImport?: () => void
  /** #319: per-setlist JSON export (previously on the removed Song Setlists cards). */
  onExportSetlist?: (setlist: WebSetlist) => void
  /** #320: full setlists JSON export / backup. */
  onExportAllSetlists?: () => void
  onNewSetlist?: () => void
  /** @deprecated Retired under GH579 Phase 1 */
  onManageSetlists?: (openSetlist: WebSetlist | null) => void
}

const SCOPE_LABEL: Record<SetlistWorkspaceScope, string> = {
  ALL_SETLISTS: 'All Setlists',
  UNFILED_SETLISTS: 'Unfiled Setlists',
}

const touch = 'min-h-9 min-w-9'
const emptyState = 'text-center py-12 bg-app-surface/40 rounded-2xl border border-dashed border-app-border'

const formatCreated = (createdAt: unknown) =>
  typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt > 0
    ? new Date(createdAt).toLocaleDateString()
    : null

interface EntryView {
  title: string
  artist: string
  libraryIndex: number | null
  performanceKey: string
}

export const SetlistWorkspace: React.FC<SetlistWorkspaceProps> = ({
  scope, folderName, folders, onSetlistFolderChange,
  setlists,
  songs,
  openSetlistId: controlledOpenSetlistId,
  onOpenSetlistChange,
  onSelectScope,
  onPlaySetlistPosition,
  onOpenSong,
  onRenameSetlist,
  onDeleteSetlist,
  onRequestTrashSetlist,
  onNewSetlist,
  onMoveSong,
  onRemoveSong,
  onAddSongs,
  shortcutsBlocked = false,
  menu,
  isWorkspaceOpen = false,
  onToggleWorkspace,
  workspaceWidth,
  onWorkspaceWidthChange,
}) => {
  const isDesktop = useIsDesktop()
  const isEffectiveWorkspace = Boolean(isWorkspaceOpen && isDesktop)
  const handleNewSetlist = onNewSetlist ?? menu?.onNewSetlist
  const [localOpenSetlistId, setLocalOpenSetlistId] = useState<string | number | null>(null)
  const openSetlistId = controlledOpenSetlistId === undefined ? localOpenSetlistId : controlledOpenSetlistId
  const setOpenSetlistId = (id: string | number | null) => {
    setLocalOpenSetlistId(id)
    onOpenSetlistChange?.(id)
  }
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | number | null>(null)
  const [editingSetlistId, setEditingSetlistId] = useState<string | number | null>(null)
  const [setlistNameInput, setSetlistNameInput] = useState('')
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  const [editingOpenSetlistName, setEditingOpenSetlistName] = useState(false)
  const [openSetlistNameInput, setOpenSetlistNameInput] = useState('')

  const handleSaveSetlistName = (setlistId: string | number) => {
    const trimmed = setlistNameInput.trim()
    if (trimmed && onRenameSetlist) {
      onRenameSetlist(setlistId, trimmed)
    }
    setEditingSetlistId(null)
  }
  const openSetlist = useMemo(
    () => (openSetlistId === null ? null : setlists.find(sl => !sl.isDeleted && String(sl.id) === String(openSetlistId)) || null),
    [openSetlistId, setlists]
  )
  if (controlledOpenSetlistId === undefined && localOpenSetlistId !== null && !openSetlist) {
    setLocalOpenSetlistId(null)
  }
  useEffect(() => {
    if (controlledOpenSetlistId != null && !openSetlist) onOpenSetlistChange?.(null)
  }, [controlledOpenSetlistId, openSetlist, onOpenSetlistChange])
  const [prevOpenSetlistId, setPrevOpenSetlistId] = useState(openSetlistId)
  if (prevOpenSetlistId !== openSetlistId) {
    setPrevOpenSetlistId(openSetlistId)
    setEditingOpenSetlistName(false)
  }

  const handleSaveOpenSetlistName = () => {
    if (!openSetlist) return
    const trimmed = openSetlistNameInput.trim()
    if (trimmed && onRenameSetlist) {
      onRenameSetlist(openSetlist.id, trimmed)
    }
    setEditingOpenSetlistName(false)
  }

  const handlePickerAdd = async (picked: ActiveSongState[]) => {
    if (!openSetlist || !onAddSongs) return false
    const ids = picked.map(s => s.id).filter((id): id is string | number => id !== undefined)
    const ok = await onAddSongs(openSetlist.id, ids)
    return ok
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && key === 'k'
      if (!ctrlK || !openSetlist || shortcutsBlocked) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.id !== 'multi-song-search-input') return
      e.preventDefault()
      setIsPickerOpen(open => !open)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openSetlist, shortcutsBlocked])
  const songIndex = useMemo(() => songIdIndex(songs), [songs])

  // Missing or trashed songs stay visible for context but cannot be played or opened.
  const entries = useMemo<EntryView[]>(() => {
    if (!openSetlist) return []
    return (openSetlist.songs || []).map(ref => {
      const song = resolveSetlistSongIndexed(ref, songs, songIndex)
      const available = song && !song.isDeleted ? song : undefined
      return {
        title: available?.title || ref.title || 'Untitled Song',
        artist: available ? available.artist : ref.artist || '',
        libraryIndex: available ? songs.indexOf(available) : null,
        performanceKey: available ? transposeContext(available, available.transposeOffset || 0).performanceKey : '',
      }
    })
  }, [openSetlist, songs, songIndex])
  const firstPlayable = entries.findIndex(entry => entry.libraryIndex !== null)

  const crumbButton = 'min-h-[42px] h-[42px] flex items-center px-1 rounded-md text-app-muted hover:text-app-link font-medium transition-colors cursor-pointer'
  const crumbCurrent = 'ui-primary-text text-app-heading font-semibold truncate'


  const renderSingleSetlist = (targetSetlist: WebSetlist) => (
        <div className="space-y-3">
          <div
            data-testid="workspace-setlist-header"
            className="ui-setlist-card flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3.5 bg-app-setlist border border-app-border rounded-2xl"
          >
            <div className="flex items-center gap-3 min-w-0 w-full md:w-auto md:flex-1">
              <div className="w-10 h-10 rounded-xl bg-app-section/15 text-app-section flex items-center justify-center shrink-0">
                <ListMusic className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                {editingOpenSetlistName ? (
                  <form
                    onSubmit={e => { e.preventDefault(); handleSaveOpenSetlistName() }}
                    className="flex items-center gap-1.5 min-w-0"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={openSetlistNameInput}
                      onChange={e => setOpenSetlistNameInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          e.stopPropagation()
                          setEditingOpenSetlistName(false)
                        }
                      }}
                      data-testid="workspace-rename-input"
                      className="px-2 py-0.5 rounded border border-app-border bg-app-base text-sm font-bold text-app-heading min-w-0 flex-1 max-w-xs focus:outline-none focus:border-app-action"
                    />
                    <button
                      type="submit"
                      data-testid="workspace-rename-save"
                      className="min-h-9 px-2.5 py-0.5 rounded bg-app-action text-app-on-action text-xs font-semibold cursor-pointer hover:brightness-110"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      data-testid="workspace-rename-cancel"
                      onClick={() => setEditingOpenSetlistName(false)}
                      className="min-h-9 px-2 py-0.5 rounded bg-app-base text-app-muted hover:text-app-heading text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <h1 data-testid="workspace-setlist-name" className="ui-primary-text text-base sm:text-lg font-bold text-app-heading truncate">
                      {targetSetlist.name}
                    </h1>
                    <button
                      type="button"
                      aria-label={`Rename setlist ${targetSetlist.name}`}
                      data-testid="workspace-rename-setlist"
                      onClick={() => {
                        setOpenSetlistNameInput(targetSetlist.name)
                        setEditingOpenSetlistName(true)
                      }}
                      className="p-1 rounded hover:bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                  <p data-testid="workspace-setlist-count" className="text-xs text-app-muted">
                    {entries.length} {entries.length === 1 ? 'performance entry' : 'performance entries'}
                  </p>
                  {onSetlistFolderChange && (
                    <label className="flex items-center gap-1.5 text-xs text-app-muted min-w-0">
                      <span>Folder</span>
                      <select
                        aria-label="Setlist folder"
                        data-testid="workspace-setlist-folder-select"
                        value={targetSetlist.folderId ?? ''}
                        onChange={e => onSetlistFolderChange(targetSetlist.id, e.target.value || null)}
                        className="bg-app-base border border-app-border rounded px-1.5 py-0.5 text-xs text-app-text outline-none focus:border-app-action cursor-pointer"
                      >
                        <option value="">Unfiled</option>
                        {folders?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 border-t border-app-border/40 md:border-t-0 md:pt-0">
              {entries.length > 0 && (
                <button
                  type="button"
                  data-testid="workspace-play-setlist"
                  disabled={firstPlayable < 0}
                  onClick={() => { if (firstPlayable >= 0) onPlaySetlistPosition?.(targetSetlist.id, firstPlayable) }}
                  className={`${touch} px-3.5 rounded-xl bg-app-action hover:brightness-110 text-app-on-action text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                  <span>Play in Stage</span>
                </button>
              )}
              <button
                ref={searchTriggerRef}
                type="button"
                data-testid="workspace-search-songs"
                aria-label="Search Songs"
                aria-keyshortcuts="Control+K"
                onClick={() => setIsPickerOpen(open => !open)}
                className={`ui-button ${touch} px-3.5 rounded-xl bg-app-button hover:brightness-110 text-app-button-text text-xs font-semibold border border-app-border transition-colors flex items-center gap-1.5 cursor-pointer`}
              >
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Search Songs</span>
              </button>
              {menu?.onShareSetlist && (
                <button
                  type="button"
                  data-testid="workspace-share-setlist"
                  aria-label="Share Setlist"
                  onClick={() => menu.onShareSetlist?.(targetSetlist)}
                  className="ui-button min-h-11 min-w-11 rounded-xl border border-app-border bg-app-button text-app-accent hover:brightness-110 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <Share2 className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              {(onRequestTrashSetlist || onDeleteSetlist) && (
                <button
                  type="button"
                  data-testid="workspace-delete-setlist"
                  aria-label={`Move setlist ${targetSetlist.name} to Trash`}
                  onClick={() => {
                    if (onRequestTrashSetlist) onRequestTrashSetlist(targetSetlist.id)
                    else onDeleteSetlist?.(targetSetlist.id)
                  }}
                  className="ui-button min-h-11 min-w-11 rounded-xl border border-app-border bg-app-button text-status-error hover:brightness-110 hover:bg-status-error/10 hover:border-status-error/40 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {entries.length === 0 ? (
            <div data-testid="workspace-empty-setlist" className={emptyState}>
              <Music className="w-8 h-8 text-app-muted mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-app-heading">This setlist has no songs yet</h3>
              <p className="text-xs text-app-muted mt-1">Use Search Songs to add some.</p>
              <button
                type="button"
                data-testid="workspace-empty-search-songs"
                onClick={() => setIsPickerOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-app-action text-app-on-action text-xs font-bold hover:brightness-110 cursor-pointer shadow-sm"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search Songs</span>
              </button>
            </div>
          ) : (
            <div className="space-y-1.5 sm:space-y-2">
              {entries.map((entry, idx) => {
                const unavailable = entry.libraryIndex === null
                const open = () => { if (!unavailable) onOpenSong?.(targetSetlist.id, idx) }
                return (
                  <div
                    key={targetSetlist.songs[idx].entryId ?? `${targetSetlist.id}_${idx}`}
                    data-testid={`workspace-entry-${idx}`}
                    aria-disabled={unavailable ? 'true' : undefined}
                    onClick={open}
                    className={`ui-song-card group flex items-center justify-between gap-2 sm:gap-3 py-1.5 px-2.5 sm:p-3 rounded-xl bg-app-song border border-app-border transition-all shadow-sm ${
                      unavailable ? 'opacity-60 cursor-not-allowed' : 'hover:brightness-95 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="w-5 sm:w-6 shrink-0 text-center text-xs font-mono font-bold text-app-muted group-hover:text-app-link">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="ui-primary-text text-sm font-bold text-app-heading group-hover:text-app-link transition-colors truncate">
                          {entry.title}
                        </div>
                        <div className="ui-secondary-text text-[11px] sm:text-xs text-app-muted flex flex-wrap items-center gap-x-2 truncate">
                          {unavailable ? (
                            <span className="text-app-muted font-semibold">Song missing{entry.artist ? ` · ${entry.artist}` : ''}</span>
                          ) : (
                            <span>{entry.artist || 'Unknown Artist'}</span>
                          )}
                          {entry.performanceKey && (
                            <span
                              data-testid={`workspace-entry-key-${idx}`}
                              className="px-1.5 py-0.2 rounded bg-app-base border border-app-border text-app-accent font-mono font-bold text-[10px] sm:text-xs"
                            >
                              {entry.performanceKey}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                      {onMoveSong && (
                        <>
                          <button
                            type="button"
                            data-testid={`workspace-entry-${idx}-up`}
                            disabled={idx === 0}
                            onClick={e => { e.stopPropagation(); onMoveSong(targetSetlist.id, idx, 'up') }}
                            aria-label={`Move ${entry.title} up`}
                            className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-app-muted hover:text-app-heading hover:bg-app-base border border-app-border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            data-testid={`workspace-entry-${idx}-down`}
                            disabled={idx === entries.length - 1}
                            onClick={e => { e.stopPropagation(); onMoveSong(targetSetlist.id, idx, 'down') }}
                            aria-label={`Move ${entry.title} down`}
                            className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-app-muted hover:text-app-heading hover:bg-app-base border border-app-border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        data-testid={`workspace-entry-play-${idx}`}
                        disabled={unavailable}
                        onClick={e => { e.stopPropagation(); if (!unavailable) onPlaySetlistPosition?.(targetSetlist.id, idx) }}
                        aria-label={`Play ${entry.title} in Stage`}
                        className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg bg-app-action hover:brightness-110 text-app-on-action transition-colors flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        data-testid={`workspace-entry-open-${idx}`}
                        disabled={unavailable}
                        onClick={e => { e.stopPropagation(); open() }}
                        aria-label={`Open ${entry.title}`}
                        className="ui-button w-9 h-9 sm:w-8 sm:h-8 rounded-lg bg-app-button hover:brightness-110 text-app-button-text border border-app-border transition-colors flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Music className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      {onRemoveSong && (
                        <button
                          type="button"
                          data-testid={`workspace-entry-${idx}-remove`}
                          onClick={e => { e.stopPropagation(); onRemoveSong(targetSetlist.id, idx) }}
                          aria-label={`Remove ${entry.title} from setlist`}
                          className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-app-muted hover:text-status-error hover:bg-status-error/10 border border-app-border transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
  )

  const renderSetlistGrid = () => (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 data-testid="setlist-workspace-heading" className="ui-primary-text text-base font-bold text-app-heading flex items-center gap-2 min-w-0">
              <ListMusic className="ui-section-icon w-4 h-4 text-app-section shrink-0" />
              <span className="truncate">{folderName ?? SCOPE_LABEL[scope]}</span>
              <span className="shrink-0 text-xs font-normal text-app-muted">({setlists.length})</span>
            </h2>
            {handleNewSetlist && (
              <button
                type="button"
                data-testid="setlists-add-new"
                aria-label="Add new setlist"
                onClick={handleNewSetlist}
                className="min-h-11 px-3 rounded-xl bg-app-action hover:brightness-110 text-app-on-action font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
              >
                <span>Add new setlist</span>
              </button>
            )}
          </div>

          {setlists.length === 0 ? (
            <div data-testid="workspace-empty-collection" className={emptyState}>
              <ListMusic className="w-8 h-8 text-app-muted mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-app-heading">No setlists in this scope</h3>
              <p className="text-xs text-app-muted mt-1">Create a new setlist from the Music Explorer.</p>
            </div>
          ) : (
            <div className={isEffectiveWorkspace ? "grid grid-cols-1 gap-3 sm:gap-3.5" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3.5"}>
              {setlists.map(sl => {
                const count = sl.songs?.length || 0
                const created = formatCreated(sl.createdAt)
                const isSelected = isEffectiveWorkspace && openSetlist?.id === sl.id
                return (
                  <SwipeableActionCard
                    key={sl.id}
                    id={`setlist-${sl.id}`}
                    dataTestId={`workspace-setlist-card-${sl.id}`}
                    dragSetlistId={sl.id}
                    disabled={confirmDeleteId === sl.id}
                    ariaLabel={`Open setlist ${sl.name}`}
                    onClick={() => { if (confirmDeleteId !== sl.id) setOpenSetlistId(sl.id) }}
                    leftAction={menu?.onShareSetlist ? {
                      icon: <Share2 className="w-4 h-4" />,
                      label: 'Share Setlist',
                      onAction: () => menu.onShareSetlist?.(sl),
                    } : undefined}
                    secondaryRightAction={onRenameSetlist ? {
                      icon: <Pencil className="w-4 h-4" />,
                      label: 'Rename',
                      testId: `swipe-action-rename-${sl.id}`,
                      onAction: () => {
                        setEditingSetlistId(sl.id)
                        setSetlistNameInput(sl.name)
                      },
                    } : undefined}
                    rightAction={onDeleteSetlist ? {
                      icon: <Trash2 className="w-4 h-4" />,
                      label: 'Delete',
                      isDestructive: true,
                      onAction: () => setConfirmDeleteId(sl.id),
                    } : undefined}
                    className="rounded-2xl"
                    cardClassName={`ui-setlist-card group h-full p-3 sm:p-3.5 rounded-xl border cursor-pointer transition-all shadow-sm flex flex-col justify-between outline-none focus-visible:ring-2 focus-visible:ring-app-action/60 ${isSelected ? "ui-selection-card bg-app-selected border-app-selected-border ring-2 ring-app-action/40" : "bg-app-setlist hover:brightness-95 border-app-border"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <ListMusic className="ui-section-icon w-4 h-4 text-app-section shrink-0" />
                        {editingSetlistId === sl.id ? (
                          <form
                            onSubmit={e => { e.preventDefault(); handleSaveSetlistName(sl.id) }}
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1.5 min-w-0 flex-1"
                          >
                            <input
                              type="text"
                              autoFocus
                              value={setlistNameInput}
                              onChange={e => setSetlistNameInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setEditingSetlistId(null)
                                }
                              }}
                              data-testid={`setlist-rename-input-${sl.id}`}
                              className="px-1.5 py-0.5 rounded border border-app-border bg-app-base text-xs font-bold text-app-heading min-w-0 flex-1"
                            />
                            <button
                              type="submit"
                              data-testid={`setlist-rename-save-${sl.id}`}
                              className="min-h-9 px-2 py-0.5 rounded bg-app-action text-app-on-action text-xs font-semibold cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSetlistId(null)}
                              data-testid={`setlist-rename-cancel-${sl.id}`}
                              className="min-h-9 px-1.5 py-0.5 rounded bg-app-base text-app-muted hover:text-app-heading text-xs cursor-pointer"
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <>
                            <h3 className="ui-primary-text text-sm font-bold text-app-heading group-hover:text-app-link transition-colors truncate">
                              {sl.name}
                            </h3>
                            {onRenameSetlist && (
                              <button
                                type="button"
                                aria-label={`Rename setlist ${sl.name}`}
                                data-testid={`desktop-rename-setlist-${sl.id}`}
                                onClick={e => {
                                  e.stopPropagation()
                                  setEditingSetlistId(sl.id)
                                  setSetlistNameInput(sl.name)
                                }}
                                className="setlist-hover-rename opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded hover:bg-app-base text-app-muted hover:text-app-heading transition-opacity shrink-0 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {menu?.onShareSetlist && (
                          <button
                            type="button"
                            aria-label={`Share setlist ${sl.name}`}
                            data-testid={`desktop-share-setlist-${sl.id}`}
                            onClick={e => { e.stopPropagation(); menu.onShareSetlist?.(sl) }}
                            className={`${touch} setlist-hover-share opacity-0 group-hover:opacity-100 focus-visible:opacity-100 px-1.5 rounded-lg text-app-action hover:bg-app-action/10 transition-opacity flex items-center justify-center cursor-pointer`}
                          >
                            <Share2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                        {(onRequestTrashSetlist || onDeleteSetlist) && (
                          <button
                            type="button"
                            aria-label={`Move setlist ${sl.name} to Trash`}
                            data-testid={`desktop-delete-setlist-${sl.id}`}
                            onClick={e => {
                              e.stopPropagation()
                              if (onRequestTrashSetlist) onRequestTrashSetlist(sl.id)
                              else onDeleteSetlist?.(sl.id)
                            }}
                            className={`${touch} setlist-hover-delete opacity-0 group-hover:opacity-100 focus-visible:opacity-100 px-1.5 rounded-lg text-status-error hover:bg-status-error/10 transition-colors flex items-center justify-center cursor-pointer`}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2.5 pt-1 border-t border-app-border flex items-center justify-between gap-2 text-xs text-app-muted">
                      {created ? <span data-testid={`workspace-setlist-date-${sl.id}`}>Created {created}</span> : <span />}
                      <span
                        data-testid={`workspace-setlist-count-${sl.id}`}
                        className="shrink-0 text-[10px] text-app-muted px-2 py-0.5 rounded-full bg-app-base border border-app-border"
                      >
                        {count} {count === 1 ? 'song' : 'songs'}
                      </span>
                    </div>
                    {confirmDeleteId === sl.id && (
                      <div onClick={e => e.stopPropagation()}
                        className="absolute inset-0 bg-app-surface border border-status-error rounded-2xl p-3 flex items-center justify-between z-20 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center gap-2 text-xs text-status-error font-semibold">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Delete this setlist?</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-bold">
                          <button type="button" data-testid={`confirm-delete-setlist-${sl.id}`}
                            onClick={e => { e.stopPropagation(); onDeleteSetlist?.(sl.id); setConfirmDeleteId(null) }}
                            className="min-h-11 px-3 rounded-lg bg-status-error text-app-base hover:brightness-110 transition-colors cursor-pointer">
                            Delete
                          </button>
                          <button type="button" data-testid={`cancel-delete-setlist-${sl.id}`}
                            onClick={e => { e.stopPropagation(); setConfirmDeleteId(null) }}
                            className="min-h-11 px-2.5 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </SwipeableActionCard>
                )
              })}
            </div>
          )}
        </div>
  )

  return (
    <div data-testid="setlist-workspace" className="mb-4">
      {/* Breadcrumbs & scope bar: full-bleed like the Songbook filter bar. Compact: row 1 crumbs | Manage, row 2 Sort | QR ⋯ */}
      <div data-testid="setlist-filter-bar" className="ui-filter-bar sticky top-[var(--app-header-height,57px)] z-30 bg-app-filter border-b border-app-border px-4 sm:px-6 py-1 mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:flex sm:justify-between">
        <nav aria-label="Breadcrumb" data-testid="workspace-breadcrumbs" className="col-start-1 row-start-1 flex items-center gap-1.5 text-xs text-app-muted min-w-0 min-h-[42px] h-[42px] overflow-hidden whitespace-nowrap">
          <button
            type="button"
            data-crumb
            data-testid="workspace-crumb-root"
            onClick={() => { setOpenSetlistId(null); onSelectScope?.('ALL_SETLISTS') }}
            className={crumbButton}
          >
            Setlists
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-app-muted shrink-0" aria-hidden="true" />
          {openSetlist && !isEffectiveWorkspace ? (
            <>
              <button
                type="button"
                data-crumb
                data-testid="workspace-crumb-scope"
                onClick={() => setOpenSetlistId(null)}
                className={crumbButton}
              >
                {folderName ?? SCOPE_LABEL[scope]}
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-app-muted shrink-0" aria-hidden="true" />
              <span data-crumb aria-current="page" className={crumbCurrent}>{openSetlist.name}</span>
            </>
          ) : (
            <span data-crumb aria-current="page" className={crumbCurrent}>{folderName ?? SCOPE_LABEL[scope]}</span>
          )}
        </nav>
        {menu && (
          <div data-testid="setlist-toolbar" className="contents">
            {(!openSetlist || isEffectiveWorkspace) && (
              <>
                <select
                  data-testid="setlist-sort-select"
                  aria-label="Sort setlists"
                  value={menu.sortValue}
                  onChange={(e) => menu.onSortChange(e.target.value)}
                  className="col-start-1 row-start-2 justify-self-start sm:ml-auto min-w-0 max-w-full min-h-[42px] h-[42px] bg-app-surface border border-app-border text-app-text text-xs rounded-xl px-2.5 outline-none cursor-pointer"
                >
                  {menu.sortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className={`${openSetlist && !isEffectiveWorkspace ? 'row-start-1' : 'row-start-2'} col-start-2 justify-self-end flex items-center gap-1.5`}>
                <SetlistsHelp className="mr-0.5" />
                {(!openSetlist || isEffectiveWorkspace) && menu.onShareAll && (
                  <button
                    type="button"
                    data-testid="main-share-setlist-btn"
                    aria-label="Share Setlist"
                    onClick={menu.onShareAll}
                    className="ui-button min-h-11 min-w-11 rounded-xl border border-app-border bg-app-button text-app-accent hover:brightness-110 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                )}
                {onToggleWorkspace && (
                  <button
                    type="button"
                    data-testid="workspace-toggle"
                    aria-label={isWorkspaceOpen ? "Hide Preview Pane" : "Show Preview Pane"}
                    aria-pressed={isWorkspaceOpen}
                    onClick={onToggleWorkspace}
                    className={`hidden md:flex items-center gap-1.5 shrink-0 min-h-11 sm:min-h-9 px-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      isWorkspaceOpen
                        ? 'bg-app-action/15 border-app-action text-app-action'
                        : 'ui-button bg-app-button border-app-border text-app-button-text hover:brightness-110'
                    }`}
                  >
                    <PanelRight className="w-4 h-4" />
                    <span className="hidden xl:inline">Preview</span>
                  </button>
                )}
            <button
              type="button"
              data-testid="workspace-scope-menu-btn"
              aria-label="Setlist actions"
              aria-haspopup="menu"
              aria-expanded={!!menuAnchor}
              onClick={e => { e.stopPropagation(); setMenuAnchor(menuAnchor ? null : e.currentTarget) }}
              className="ui-button min-h-11 min-w-11 shrink-0 rounded-xl border border-app-border bg-app-button text-app-button-text hover:brightness-110 flex items-center justify-center transition-colors cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            </div>
            <DropdownPortal anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)} align="right">
              <ScopeMenu menu={menu} openSetlist={openSetlist} onDone={() => setMenuAnchor(null)} />
            </DropdownPortal>
          </div>
        )}
      </div>

      <div className="w-full">
        {isEffectiveWorkspace ? (
          <div className="flex-1 min-w-0 flex flex-row items-start">
            <div className="flex-1 min-w-0 px-4 py-3 sm:px-6 sm:py-4">
              {renderSetlistGrid()}
            </div>
            <WorkspacePreviewPane
              isOpen={isEffectiveWorkspace}
              width={workspaceWidth ?? null}
              onWidthChange={onWorkspaceWidthChange ?? (() => {})}
              ariaLabel="Setlist Detail Pane"
              testId="setlist-workspace-preview-pane"
            >
              {openSetlist ? (
                <div key={openSetlist.id} className="h-full overflow-y-auto p-4 space-y-3 animate-in fade-in duration-150 motion-reduce:animate-none">
                  {renderSingleSetlist(openSetlist)}
                </div>
              ) : (
                <div
                  data-testid="workspace-setlist-preview-empty"
                  className="h-full flex flex-col items-center justify-center p-6 text-center text-app-muted select-none"
                >
                  <ListMusic className="w-10 h-10 mb-2 opacity-30 text-app-muted" />
                  <h3 className="text-sm font-semibold text-app-heading">Select a setlist to view details</h3>
                  <p className="text-xs text-app-muted max-w-xs mt-1">
                    Songs and management options for the selected setlist will appear here.
                  </p>
                </div>
              )}
            </WorkspacePreviewPane>
          </div>
        ) : (
          <div className="px-4 py-3 sm:px-6 sm:py-4 w-full">
            {openSetlist ? renderSingleSetlist(openSetlist) : renderSetlistGrid()}
          </div>
        )}
      </div>
      {openSetlist && isPickerOpen && (
        <MultiSongSetlistPicker
          isOpen={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          currentSetlist={openSetlist}
          allSongs={songs}
          onAddSongs={handlePickerAdd}
          triggerRef={searchTriggerRef}
        />
      )}
    </div>
  )
}

const menuItem = 'w-full text-left px-3 min-h-11 text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors'
const menuIcon = 'w-3.5 h-3.5 text-app-action shrink-0'

const ScopeMenu: React.FC<{ menu: SetlistWorkspaceMenu; openSetlist: WebSetlist | null; onDone: () => void }> = ({ menu, openSetlist, onDone }) => {
  const run = (action?: () => void) => () => { onDone(); action?.() }
  return (
    <div
      role="menu"
      data-testid="workspace-scope-menu"
      aria-label="Setlist actions"
      onClick={e => e.stopPropagation()}
      className="w-60 bg-app-base border border-app-border rounded-xl shadow-xl py-1 text-xs"
    >
      {!openSetlist && (
        <div role="group" aria-label="Sort setlists" className="pb-1 mb-1 border-b border-app-border/50">
          <div className="px-3 pt-1.5 pb-1 text-[11px] font-bold text-app-muted">Sort</div>
          {menu.sortOptions.map(option => {
            const checked = option.value === menu.sortValue
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                data-testid={`workspace-sort-${option.value}`}
                onClick={run(() => menu.onSortChange(option.value))}
                className={menuItem}
              >
                <span className="w-3.5 shrink-0">{checked && <Check className="w-3.5 h-3.5 text-app-action" />}</span>
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
      {menu.onImport && (
        <button type="button" role="menuitem" data-testid="workspace-menu-import" onClick={run(menu.onImport)} className={menuItem}>
          <Upload className={menuIcon} />
          <span>Import Setlist</span>
        </button>
      )}
      {openSetlist && menu.onExportSetlist && (
        <button type="button" role="menuitem" data-testid="workspace-menu-export-json"
          onClick={run(() => menu.onExportSetlist!(openSetlist))} className={menuItem}>
          <Upload className={`${menuIcon} rotate-180`} />
          <span>Export Setlist</span>
        </button>
      )}
    </div>
  )
}
