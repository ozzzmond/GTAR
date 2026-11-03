import React, { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Edit2, Layers, ListMusic, MoreHorizontal, Music, Play, Plus, QrCode, Trash2, Upload, UploadCloud } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { resolveSetlistSongIndexed, songIdIndex } from '../utils/setlistSongs'
import { transposeContext } from '../utils/songKeySemantics'
import { DropdownPortal } from './DropdownPortal'
import { SwipeableActionCard } from './SwipeableActionCard'

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
  /** Active setlists in display order (already searched and sorted by the caller). */
  setlists: WebSetlist[]
  songs: ActiveSongState[]
  onSelectScope?: (scope: SetlistWorkspaceScope) => void
  /** Stage entry at an exact setlist position (positions map 1:1 to setlist entries). */
  onPlaySetlistPosition?: (setlistId: string | number, position: number) => void
  /** Opens the resolved song by its library index. */
  onOpenSong?: (libraryIndex: number) => void
  /** Manage flow: the #312 S2 Setlist Manager in DEV. */
  onManageSetlist?: (setlist: WebSetlist) => void
  onRequestTrashSetlist?: (id: string | number) => void
  onDeleteSetlist?: (setlistId: string | number) => boolean
  onNewSetlist?: () => void
  /** Scope-bar ⋯ menu: GTAR-only setlist controls, each bound to its existing handler. */
  menu?: SetlistWorkspaceMenu
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
  /** Present only when the existing publishing gate allows it. */
  onPublishSetlist?: (setlist: WebSetlist) => void
  /** #319: per-setlist JSON export (previously on the removed Song Setlists cards). */
  onExportSetlist?: (setlist: WebSetlist) => void
  /** #320: full setlists JSON export / backup. */
  onExportAllSetlists?: () => void
  onNewSetlist?: () => void
  publishLabel?: (setlist: WebSetlist) => string
  /** Receives the open setlist (null in the collection view). */
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
  scope, folderName,
  setlists,
  songs,
  onSelectScope,
  onPlaySetlistPosition,
  onOpenSong,
  onManageSetlist,
  onDeleteSetlist,
  onRequestTrashSetlist,
  onNewSetlist,
  menu,
}) => {
  const handleNewSetlist = onNewSetlist ?? menu?.onNewSetlist
  const [openSetlistId, setOpenSetlistId] = useState<string | number | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | number | null>(null)
  const openSetlist = useMemo(
    () => (openSetlistId === null ? null : setlists.find(sl => String(sl.id) === String(openSetlistId)) || null),
    [openSetlistId, setlists]
  )
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

  const crumbButton = `${touch} px-1 rounded-md text-app-muted hover:text-app-link font-medium transition-colors cursor-pointer`
  const crumbCurrent = 'ui-primary-text text-app-heading font-semibold truncate'

  return (
    <div data-testid="setlist-workspace" className="mb-4">
      {/* Breadcrumbs & scope bar: full-bleed like the Songbook filter bar. Compact: row 1 crumbs | Manage, row 2 Sort | QR ⋯ */}
      <div data-testid="setlist-filter-bar" className="ui-filter-bar bg-app-filter border-b border-app-border -mx-4 -mt-3 sm:-mx-6 sm:-mt-4 px-4 py-1 mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:flex sm:justify-between">
        <nav aria-label="Breadcrumb" data-testid="workspace-breadcrumbs" className="col-start-1 row-start-1 flex items-center gap-1 text-xs text-app-muted min-w-0 min-h-11 overflow-hidden whitespace-nowrap">
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
          {openSetlist ? (
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
            {!openSetlist && (
              <>
                <select
                  data-testid="setlist-sort-select"
                  aria-label="Sort setlists"
                  value={menu.sortValue}
                  onChange={(e) => menu.onSortChange(e.target.value)}
                  className="col-start-1 row-start-2 justify-self-start sm:ml-auto min-w-0 max-w-full min-h-11 bg-app-surface border border-app-border text-app-text text-xs rounded-xl px-2.5 outline-none cursor-pointer"
                >
                  {menu.sortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {menu.onManageSetlists && (
                  <button
                    type="button"
                    data-testid="toggle-setlist-selection-mode"
                    onClick={() => menu.onManageSetlists?.(null)}
                    className="col-start-2 row-start-1 justify-self-end ui-button min-h-11 px-3 bg-app-button hover:brightness-110 border border-app-border rounded-xl text-xs text-app-button-text font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                  >
                    <Layers className="w-3.5 h-3.5 text-app-section" />
                    <span>Manage</span>
                  </button>
                )}
              </>
            )}
            <div className={`${openSetlist ? 'row-start-1' : 'row-start-2'} col-start-2 justify-self-end flex items-center gap-1.5`}>
                {!openSetlist && menu.onShareAll && (
                  <button
                    type="button"
                    data-testid="main-share-setlist-btn"
                    aria-label="Share Setlist"
                    onClick={menu.onShareAll}
                    className="ui-button min-h-11 min-w-11 rounded-xl border border-app-border bg-app-button text-app-accent hover:brightness-110 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <QrCode className="w-4 h-4" />
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

      {openSetlist ? (
        /* Single setlist view (GTAR1 CASE A) */
        <div className="space-y-3">
          <div
            data-testid="workspace-setlist-header"
            className="ui-setlist-card flex flex-wrap items-center justify-between gap-3 p-3.5 bg-app-setlist border border-app-border rounded-2xl"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-app-section/15 text-app-section flex items-center justify-center shrink-0">
                <ListMusic className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h1 className="ui-primary-text text-lg font-bold text-app-heading truncate">{openSetlist.name}</h1>
                <p className="text-xs text-app-muted">{entries.length} performance entries</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {entries.length > 0 && (
                <button
                  type="button"
                  data-testid="workspace-play-setlist"
                  disabled={firstPlayable < 0}
                  onClick={() => { if (firstPlayable >= 0) onPlaySetlistPosition?.(openSetlist.id, firstPlayable) }}
                  className={`${touch} px-3.5 rounded-xl bg-app-action hover:brightness-110 text-app-on-action text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play in Stage</span>
                </button>
              )}
              <button
                type="button"
                data-testid="workspace-edit-setlist"
                onClick={() => onManageSetlist?.(openSetlist)}
                className={`ui-button ${touch} px-3.5 rounded-xl bg-app-button hover:brightness-110 text-app-button-text text-xs font-semibold border border-app-border transition-colors flex items-center gap-1.5 cursor-pointer`}
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit in Setlist Manager</span>
              </button>
              {menu?.onShareSetlist && (
                <button
                  type="button"
                  aria-label="Share Setlist"
                  onClick={() => menu.onShareSetlist?.(openSetlist)}
                  className="ui-button min-h-11 min-w-11 rounded-xl border border-app-border bg-app-button text-app-accent hover:brightness-110 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <QrCode className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {entries.length === 0 ? (
            <div data-testid="workspace-empty-setlist" className={emptyState}>
              <Music className="w-8 h-8 text-app-muted mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-app-heading">This setlist has no songs yet</h3>
              <p className="text-xs text-app-muted mt-1">Add songs from the Songbook using the setlist membership menu.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, idx) => {
                const unavailable = entry.libraryIndex === null
                const open = () => { if (entry.libraryIndex !== null) onOpenSong?.(entry.libraryIndex) }
                return (
                  <div
                    key={openSetlist.songs[idx].entryId ?? `${openSetlist.id}_${idx}`}
                    data-testid={`workspace-entry-${idx}`}
                    aria-disabled={unavailable ? 'true' : undefined}
                    onClick={open}
                    className={`ui-song-card group flex items-center justify-between gap-3 p-3 rounded-xl bg-app-song border border-app-border transition-all shadow-sm ${
                      unavailable ? 'opacity-60 cursor-not-allowed' : 'hover:brightness-95 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 shrink-0 text-center text-xs font-bold text-app-muted group-hover:text-app-link">{idx + 1}</span>
                      <div className="min-w-0">
                        <div className="ui-primary-text text-sm font-bold text-app-heading group-hover:text-app-link transition-colors truncate">
                          {entry.title}
                        </div>
                        <div className="ui-secondary-text text-xs text-app-muted truncate">
                          {unavailable ? (
                            <span className="text-app-muted font-semibold">Song missing{entry.artist ? ` · ${entry.artist}` : ''}</span>
                          ) : (
                            entry.artist || 'Unknown Artist'
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {entry.performanceKey && (
                        <span
                          data-testid={`workspace-entry-key-${idx}`}
                          className="px-2 py-0.5 rounded-md bg-app-base border border-app-border text-app-accent text-xs font-mono font-bold"
                        >
                          {entry.performanceKey}
                        </span>
                      )}
                      <button
                        type="button"
                        data-testid={`workspace-entry-play-${idx}`}
                        disabled={unavailable}
                        onClick={e => { e.stopPropagation(); if (!unavailable) onPlaySetlistPosition?.(openSetlist.id, idx) }}
                        aria-label={`Play ${entry.title} in Stage`}
                        className={`${touch} rounded-lg bg-app-action hover:brightness-110 text-app-on-action transition-colors flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                      <button
                        type="button"
                        data-testid={`workspace-entry-open-${idx}`}
                        disabled={unavailable}
                        onClick={e => { e.stopPropagation(); open() }}
                        aria-label={`Open ${entry.title}`}
                        className={`ui-button ${touch} rounded-lg bg-app-button hover:brightness-110 text-app-button-text border border-app-border transition-colors flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        <Music className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Setlist collection view (GTAR1 CASE B, including folder scope) */
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
                <Plus className="w-3.5 h-3.5" />
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {setlists.map(sl => {
                const count = sl.songs?.length || 0
                const created = formatCreated(sl.createdAt)
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
                      icon: <QrCode className="w-4 h-4" />,
                      label: 'Share Setlist',
                      onAction: () => menu.onShareSetlist?.(sl),
                    } : undefined}
                    rightAction={onDeleteSetlist ? {
                      icon: <Trash2 className="w-4 h-4" />,
                      label: 'Delete',
                      isDestructive: true,
                      onAction: () => setConfirmDeleteId(sl.id),
                    } : undefined}
                    className="rounded-2xl"
                    cardClassName="ui-setlist-card group h-full p-3.5 rounded-2xl bg-app-setlist hover:brightness-95 border border-app-border cursor-pointer transition-all shadow-sm flex flex-col justify-between outline-none focus-visible:ring-2 focus-visible:ring-app-action/60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <ListMusic className="ui-section-icon w-4 h-4 text-app-section shrink-0" />
                        <h3 className="ui-primary-text text-sm font-bold text-app-heading group-hover:text-app-link transition-colors truncate">
                          {sl.name}
                        </h3>
                      </div>
                      <span
                        data-testid={`workspace-setlist-count-${sl.id}`}
                        className="shrink-0 text-[10px] text-app-muted px-2 py-0.5 rounded-full bg-app-base border border-app-border"
                      >
                        {count} {count === 1 ? 'song' : 'songs'}
                      </span>
                    </div>
                    {onRequestTrashSetlist && <button type="button"
                      aria-label={`Move setlist ${sl.name} to Trash`}
                      data-testid={`desktop-delete-setlist-${sl.id}`}
                      onClick={e => { e.stopPropagation(); onRequestTrashSetlist(sl.id) }}
                      className="setlist-hover-delete absolute right-3 bottom-3 min-h-11 px-3 rounded-lg bg-app-base text-status-error z-10">
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>}
                    <div className="mt-2.5 pt-1 border-t border-app-border flex items-center justify-between gap-2 text-xs text-app-muted">
                      {created ? <span data-testid={`workspace-setlist-date-${sl.id}`}>Created {created}</span> : <span />}
                      <button
                        type="button"
                        data-testid={`workspace-manage-${sl.id}`}
                        onClick={e => { e.stopPropagation(); onManageSetlist?.(sl) }}
                        className={`${touch} setlist-manage-action px-2 rounded-lg text-app-link hover:underline font-semibold cursor-pointer`}
                      >
                        Manage →
                      </button>
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
      )}
    </div>
  )
}

const menuItem = 'w-full text-left px-3 min-h-11 text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors'
const menuIcon = 'w-3.5 h-3.5 text-app-action shrink-0'

const ScopeMenu: React.FC<{ menu: SetlistWorkspaceMenu; openSetlist: WebSetlist | null; onDone: () => void }> = ({ menu, openSetlist, onDone }) => {
  const run = (action?: () => void) => () => { onDone(); action?.() }
  const share = openSetlist
    ? (menu.onShareSetlist ? () => menu.onShareSetlist!(openSetlist) : undefined)
    : menu.onShareAll
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
      {share && (
        <button type="button" role="menuitem" data-testid="workspace-menu-share" onClick={run(share)} className={menuItem}>
          <QrCode className="w-3.5 h-3.5 text-app-accent shrink-0" />
          <span>{openSetlist ? 'Share setlist (QR)' : 'Share a setlist (QR)'}</span>
        </button>
      )}
      {menu.onImport && (
        <button type="button" role="menuitem" data-testid="workspace-menu-import" onClick={run(menu.onImport)} className={menuItem}>
          <Upload className={menuIcon} />
          <span>Import setlist…</span>
        </button>
      )}
      {openSetlist && menu.onPublishSetlist && (
        <button
          type="button"
          role="menuitem"
          data-testid="workspace-menu-publish"
          onClick={run(() => menu.onPublishSetlist!(openSetlist))}
          className={menuItem}
        >
          <UploadCloud className={menuIcon} />
          <span>{menu.publishLabel?.(openSetlist) || 'Publish to Shared Catalog'}</span>
        </button>
      )}
      {openSetlist && menu.onExportSetlist && (
        <button type="button" role="menuitem" data-testid="workspace-menu-export-json"
          onClick={run(() => menu.onExportSetlist!(openSetlist))} className={menuItem}>
          <Upload className={`${menuIcon} rotate-180`} />
          <span>Export JSON</span>
        </button>
      )}
      {menu.onManageSetlists && (
        <button
          type="button"
          role="menuitem"
          data-testid="workspace-menu-manage"
          onClick={run(() => menu.onManageSetlists!(openSetlist))}
          className={`${menuItem} border-t border-app-border/50`}
        >
          <Layers className={menuIcon} />
          <span>Manage Setlists</span>
        </button>
      )}
    </div>
  )
}
