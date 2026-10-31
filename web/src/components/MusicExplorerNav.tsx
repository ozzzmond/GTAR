import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Globe, Layers, ListMusic, Music, Plus } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { normalizeTags } from '../utils/songTags'

/**
 * Music Explorer navigation targets. Original GTAR has no folder data model, so
 * setlist targets stay limited to the two canonical collections. Individual
 * setlists are presented in the workspace, not duplicated here.
 */
export type ExplorerTarget =
  | { type: 'ALL_SONGS' }
  | { type: 'TAG'; tag: string }
  | { type: 'ALL_SETLISTS' }
  | { type: 'UNFILED_SETLISTS' }

export interface MusicExplorerNavProps {
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  currentSelection: ExplorerTarget
  onSelect: (target: ExplorerTarget) => void
  onNewSong: () => void
  onNewSetlist: () => void
  onOpenSources?: () => void
}

interface TagCount {
  tag: string
  count: number
}

const itemBase =
  'group flex w-full min-h-9 items-center gap-2 rounded-md px-2.5 text-xs transition-colors cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-action/60'
const itemIdle = 'text-app-text hover:bg-app-base/70'
const itemActive = 'bg-app-action/15 text-app-action font-semibold'
const pill = 'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none'
const pillIdle = 'bg-app-base border border-app-border text-app-muted'

export const MusicExplorerNav: React.FC<MusicExplorerNavProps> = ({
  songs,
  setlists,
  currentSelection,
  onSelect,
  onNewSong,
  onNewSetlist,
  onOpenSources,
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

  // Original GTAR setlists have no folder ownership; every active setlist is unfiled.
  const unfiledSetlists = activeSetlists

  const isSelected = (target: ExplorerTarget) => {
    if (target.type !== currentSelection.type) return false
    if (target.type === 'TAG' && currentSelection.type === 'TAG') {
      return target.tag.toLowerCase() === currentSelection.tag.toLowerCase()
    }
    return true
  }

  const select = (target: ExplorerTarget) => onSelect(target)

  const selectClass = (target: ExplorerTarget) =>
    `${itemBase} ${isSelected(target) ? itemActive : itemIdle}`

  const pillClass = (target: ExplorerTarget) =>
    `${pill} ${isSelected(target) ? 'bg-app-action/20 text-app-action' : pillIdle}`

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
        className="flex items-center gap-1 text-[11px] font-semibold text-app-heading hover:text-app-action cursor-pointer"
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
      className="flex select-none flex-col gap-2.5 px-3 py-3 text-xs text-app-text"
    >
      {/* Quick actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="explorer-nav-new-song"
          onClick={onNewSong}
          className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-app-action px-2.5 text-xs font-semibold text-app-on-action transition-colors hover:brightness-110 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Song</span>
        </button>
        <button
          type="button"
          data-testid="explorer-nav-new-set"
          onClick={onNewSetlist}
          className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-app-border bg-app-button px-2.5 text-xs font-semibold text-app-button-text transition-colors hover:brightness-110 cursor-pointer"
        >
          <ListMusic className="h-3.5 w-3.5 text-app-section" />
          <span>New Set</span>
        </button>
      </div>

      {/* Songbook */}
      <section>
        {sectionHeading(
          'Songbook',
          songbookExpanded,
          () => setSongbookExpanded((value) => !value),
          <span className="text-[10px] text-app-muted">
            {songs.length} {songs.length === 1 ? 'song' : 'songs'}
          </span>
        )}
        {songbookExpanded && (
          <div className="flex flex-col gap-0.5">
            <div
              role="button"
              tabIndex={0}
              data-testid="explorer-nav-all-songs"
              aria-current={isSelected({ type: 'ALL_SONGS' }) ? 'page' : undefined}
              onClick={() => select({ type: 'ALL_SONGS' })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  select({ type: 'ALL_SONGS' })
                }
              }}
              className={selectClass({ type: 'ALL_SONGS' })}
            >
              <Music className="h-4 w-4 shrink-0 text-app-action" />
              <span>All Songs</span>
              <span className={pillClass({ type: 'ALL_SONGS' })}>{songs.length}</span>
            </div>

            {onOpenSources && (
              <button
                type="button"
                data-testid="explorer-nav-browse-sources"
                onClick={onOpenSources}
                className={`${itemBase} ${itemIdle}`}
              >
                <Globe className="h-4 w-4 shrink-0 text-app-action" />
                <span>Browse Sources</span>
                <span className="ml-auto shrink-0 text-[10px] text-app-muted">External</span>
              </button>
            )}
          </div>
        )}
      </section>

      {/* Tags / Songbooks */}
      <section>
        {sectionHeading(
          'Tags',
          tagsExpanded,
          () => setTagsExpanded((value) => !value),
          <span className="text-[10px] text-app-muted">{tagCounts.length}</span>
        )}
        {tagsExpanded && (
          <div className="flex flex-col gap-0.5 pl-4">
            {tagCounts.length === 0 ? (
              <p className="px-1 py-1 text-[11px] italic text-app-muted">No tags assigned yet</p>
            ) : (
              tagCounts.map(({ tag, count }) => {
                const target: ExplorerTarget = { type: 'TAG', tag }
                return (
                  <button
                    key={tag}
                    type="button"
                    data-testid={`explorer-nav-tag-${tag}`}
                    aria-current={isSelected(target) ? 'page' : undefined}
                    onClick={() => select(target)}
                    className={selectClass(target)}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-app-section" aria-hidden="true" />
                    <span className="truncate">#{tag}</span>
                    <span className={pillClass(target)}>{count}</span>
                  </button>
                )
              })
            )}
          </div>
        )}
      </section>

      {/* Setlists & Folders */}
      <section>
        {sectionHeading(
          'Setlists & Folders',
          setlistsExpanded,
          () => setSetlistsExpanded((value) => !value),
          <span className="text-[10px] text-app-muted">
            {activeSetlists.length} {activeSetlists.length === 1 ? 'set' : 'sets'}
          </span>
        )}
        {setlistsExpanded && (
          <div className="flex flex-col gap-0.5">
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
          </div>
        )}
      </section>
    </nav>
  )
}
