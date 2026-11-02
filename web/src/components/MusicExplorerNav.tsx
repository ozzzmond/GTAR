import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Globe, Layers, ListMusic, Music, Plus, Tag } from 'lucide-react'
import { ExplorerFolderTree } from './ExplorerFolderTree'
import type { ActiveSongState, WebSetlist, SetlistFolder } from '../types/gtar'
import { normalizeTags } from '../utils/songTags'

/** Music Explorer collections, canonical tags and nested setlist folders. */
export type ExplorerTarget =
  | { type: 'ALL_SONGS' }
  | { type: 'TAG'; tag: string }
  | { type: 'ALL_SETLISTS' }
  | { type: 'UNFILED_SETLISTS' }
  | { type: 'FOLDER'; folderId: string }
  | { type: 'SHARED_CATALOG' }

export interface MusicExplorerNavProps {
  folders?: SetlistFolder[]
  onSaveFolder?: (folder: SetlistFolder) => boolean
  onDeleteFolder?: (id: string) => boolean
  onChangeTag?: (tag: string, renamed?: string) => boolean
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  currentSelection: ExplorerTarget
  onSelect: (target: ExplorerTarget) => void
  onNewSong: () => void
  onNewSetlist: () => void
  /** #319: Explorer header slot (sidebar collapse control); Browse Sources was removed from the Explorer. */
  headerAction?: React.ReactNode
}

interface TagCount {
  tag: string
  count: number
}

const itemBase =
  'group flex w-full min-h-11 items-center gap-2 rounded-lg px-2.5 text-xs transition-colors cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-action/60'
const itemIdle = 'text-app-text hover:bg-app-surface/60'
const itemActive = 'bg-app-action text-app-on-action font-semibold shadow-sm'
const pill = 'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none'
const pillIdle = 'bg-app-surface border border-app-border text-app-muted'

export const MusicExplorerNav: React.FC<MusicExplorerNavProps> = ({
  songs,
  folders = [], onSaveFolder, onDeleteFolder, onChangeTag,
  setlists,
  currentSelection,
  onSelect,
  onNewSong,
  onNewSetlist,
  headerAction,
}) => {
  const [songbookExpanded, setSongbookExpanded] = useState(true)
  const [tagsExpanded, setTagsExpanded] = useState(true)
  const [setlistsExpanded, setSetlistsExpanded] = useState(true)

  const activeSetlists = useMemo(() => setlists.filter((sl) => !sl.isDeleted), [setlists])

  // Count canonical multi-tag membership (case-insensitive, first spelling wins).
  const tagCounts = useMemo<TagCount[]>(() => {
    const counts = new Map<string, TagCount>()
    for (const song of songs) {
      for (const tag of normalizeTags(song.tags)) {
        const key = tag.toLowerCase()
        const existing = counts.get(key)
        if (existing) existing.count += 1
        else counts.set(key, { tag, count: 1 })
      }
    }
    return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag))
  }, [songs])

  // Orphaned folder references remain accessible in Unfiled.
  const unfiledSetlists = activeSetlists.filter(list => !list.folderId || !folders.some(folder => folder.id === list.folderId))

  const isSelected = (target: ExplorerTarget) => {
    if (target.type !== currentSelection.type) return false
    if (target.type === 'FOLDER' && currentSelection.type === 'FOLDER') return target.folderId === currentSelection.folderId
    if (target.type === 'TAG' && currentSelection.type === 'TAG') {
      return target.tag.toLowerCase() === currentSelection.tag.toLowerCase()
    }
    return true
  }

  const select = (target: ExplorerTarget) => onSelect(target)

  const selectClass = (target: ExplorerTarget) =>
    `${itemBase} ${isSelected(target) ? itemActive : itemIdle}`

  const pillClass = (target: ExplorerTarget) =>
    `${pill} ${isSelected(target) ? 'bg-app-action/80 text-app-on-action' : pillIdle}`

  const sectionHeading = (
    label: string,
    expanded: boolean,
    onToggle: () => void,
    trailing?: React.ReactNode
  ) => (
    <div className="mb-1 flex items-center justify-between px-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="ui-section-text flex min-h-11 items-center gap-1 text-xs font-bold uppercase tracking-wider text-app-muted hover:text-app-heading cursor-pointer"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>{label}</span>
      </button>
      {trailing}
    </div>
  )

  return (
    <nav
      aria-label="Music Explorer"
      data-testid="music-explorer-nav"
      className="flex select-none flex-col px-3 py-3 text-xs text-app-text"
    >
      {/* Quick actions */}
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          data-testid="explorer-nav-new-song"
          onClick={onNewSong}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-app-action px-2.5 text-xs font-semibold text-app-on-action transition-colors hover:brightness-110 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Song</span>
        </button>
        <button
          type="button"
          data-testid="explorer-nav-new-set"
          onClick={onNewSetlist}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-app-border bg-app-button px-2.5 text-xs font-semibold text-app-button-text transition-colors hover:brightness-110 cursor-pointer"
        >
          <ListMusic className="h-3.5 w-3.5 text-app-section" />
          <span>New Set</span>
        </button>
        {headerAction}
      </div>

      {/* Songbook */}
      <section className="mb-5">
        {sectionHeading(
          'Songbook',
          songbookExpanded,
          () => setSongbookExpanded((value) => !value),
          <span className="text-[10px] uppercase tracking-wider text-app-muted">
            {songs.length} {songs.length === 1 ? 'master song' : 'master songs'}
          </span>
        )}
        {songbookExpanded && (
          <div className="space-y-0.5 pl-1">
            <button
              type="button"
              data-testid="explorer-nav-all-songs"
              aria-current={isSelected({ type: 'ALL_SONGS' }) ? 'page' : undefined}
              onClick={() => select({ type: 'ALL_SONGS' })}
              className={selectClass({ type: 'ALL_SONGS' })}
            >
              <Music className="h-4 w-4 shrink-0 text-current" />
              <span>All Songs</span>
              <span className={pillClass({ type: 'ALL_SONGS' })}>{songs.length}</span>
            </button>

            <button
              type="button"
              data-testid="explorer-nav-shared-catalog"
              aria-current={isSelected({ type: 'SHARED_CATALOG' }) ? 'page' : undefined}
              onClick={() => select({ type: 'SHARED_CATALOG' })}
              className={selectClass({ type: 'SHARED_CATALOG' })}
            >
              <Globe className="h-4 w-4 shrink-0 text-current" />
              <span>Shared Catalog</span>
            </button>
            <div role="group" aria-label="Tags">
              <button
                type="button"
                aria-expanded={tagsExpanded}
                onClick={() => setTagsExpanded((value) => !value)}
                className="flex min-h-11 w-full items-center gap-1 text-[11px] text-app-muted cursor-pointer"
              >
                {tagsExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Tag className="h-3.5 w-3.5 text-app-section" />
                <span>Tags ({tagCounts.length})</span>
              </button>
              {tagsExpanded && (
                <div className="space-y-0.5 pl-3">
                  {tagCounts.length === 0 ? (
                    <p className="px-1 py-1 text-[11px] italic text-app-muted">No tags assigned yet</p>
                  ) : (
                    tagCounts.map(({ tag, count }) => {
                      const target: ExplorerTarget = { type: 'TAG', tag }
                      return (
                        <div key={tag} className="flex items-center min-w-0"><button
                          type="button"
                          data-testid={`explorer-nav-tag-${tag}`}
                          aria-current={isSelected(target) ? 'page' : undefined}
                          onClick={() => select(target)}
                          className={`${selectClass(target)} min-w-0 flex-1`}
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-app-section" aria-hidden="true" />
                          <span className="truncate">#{tag}</span>
                          <span className={pillClass(target)}>{count}</span>
                        </button>
                        {onChangeTag && <button type="button" aria-label={`Tag actions for ${tag}`} className="min-h-11 min-w-11 rounded-lg text-app-muted hover:bg-app-surface" onClick={() => {
                          const action = window.prompt(`Tag #${tag}: enter a new name, or leave blank to remove it from the library.`, tag)
                          if (action === null) return
                          const renamed = normalizeTags([action])[0]
                          if (renamed === tag) return
                          if (window.confirm(renamed ? `Rename #${tag} to #${renamed} across the library?` : `Remove #${tag} from every song? Songs will be kept.`)) {
                            if (!onChangeTag(tag, renamed)) window.alert('Tag change was not saved. Resolve the storage conflict and retry.')
                          }
                        }}>...</button>}</div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Setlists & Folders */}
      <section>
        {sectionHeading(
          'Setlists & Folders',
          setlistsExpanded,
          () => setSetlistsExpanded((value) => !value)
        )}
        {setlistsExpanded && (
          <div className="space-y-0.5 pl-1">
            <button
              type="button"
              data-testid="explorer-nav-all-setlists"
              aria-current={isSelected({ type: 'ALL_SETLISTS' }) ? 'page' : undefined}
              onClick={() => select({ type: 'ALL_SETLISTS' })}
              className={selectClass({ type: 'ALL_SETLISTS' })}
            >
              <Layers className="h-4 w-4 shrink-0 text-app-section" />
              <span>All Setlists</span>
              <span className={pillClass({ type: 'ALL_SETLISTS' })}>{activeSetlists.length}</span>
            </button>

            <button
              type="button"
              data-testid="explorer-nav-unfiled-setlists"
              aria-current={isSelected({ type: 'UNFILED_SETLISTS' }) ? 'page' : undefined}
              onClick={() => select({ type: 'UNFILED_SETLISTS' })}
              className={selectClass({ type: 'UNFILED_SETLISTS' })}
            >
              <ListMusic className="h-4 w-4 shrink-0 text-app-section" />
              <span>Unfiled Setlists</span>
              <span className={pillClass({ type: 'UNFILED_SETLISTS' })}>{unfiledSetlists.length}</span>
            </button>
            <ExplorerFolderTree folders={folders} setlists={setlists} selectedId={currentSelection.type === 'FOLDER' ? currentSelection.folderId : undefined}
              onSelect={folderId => select({ type: 'FOLDER', folderId })} onSave={onSaveFolder} onDelete={onDeleteFolder} />
          </div>
        )}
      </section>
    </nav>
  )
}
