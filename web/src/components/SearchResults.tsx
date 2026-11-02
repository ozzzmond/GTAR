import React from 'react'
import { Loader2 } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SharedCatalogSongItem } from '../types/sharedCatalog'
import type { OnlineChordResult } from '../utils/onlineSearch'

/** GTAR1 shows up to 8 rows per group. */
export const SEARCH_GROUP_LIMIT = 8

export interface SearchResultsProps {
  songs: Array<ActiveSongState & { originalIdx: number }>
  setlists: WebSetlist[]
  catalog: SharedCatalogSongItem[]
  online: OnlineChordResult[]
  isSearchingCatalog?: boolean
  isSearchingOnline?: boolean
  isOffline?: boolean
  onlineError?: string | null
  onSelectSong: (originalIdx: number) => void
  onSelectSetlist: (setlist: WebSetlist) => void
  /** One primary action per row: catalog and online rows open the preview, which carries Import. */
  onPreviewCatalog: (song: SharedCatalogSongItem) => void
  onPreviewOnline: (result: OnlineChordResult) => void
  onOpenImport?: () => void
  onOpenSources?: () => void
}

const actionClass = 'block w-full min-h-11 rounded-lg px-3 py-2 text-left text-xs text-app-text hover:bg-app-base focus-visible:outline-2 focus-visible:outline-app-action'
const headingClass = 'px-3 pt-2 text-xs font-bold text-app-heading flex items-center gap-1.5'

/**
 * #319: GTAR1 search dropdown layout (count line, grouped simple rows, sources note),
 * carrying GTAR's shared catalog, setlist and online results.
 */
export function SearchResults({
  songs, setlists, catalog, online, isSearchingCatalog, isSearchingOnline, isOffline, onlineError,
  onSelectSong, onSelectSetlist, onPreviewCatalog, onPreviewOnline, onOpenImport, onOpenSources,
}: SearchResultsProps): React.ReactElement {
  const shownSongs = songs.slice(0, SEARCH_GROUP_LIMIT)
  const shownSetlists = setlists.slice(0, SEARCH_GROUP_LIMIT)
  const shownCatalog = catalog.slice(0, SEARCH_GROUP_LIMIT)
  const shownOnline = online.slice(0, SEARCH_GROUP_LIMIT)
  const localTotal = songs.length + setlists.length
  const truncated = songs.length > shownSongs.length || setlists.length > shownSetlists.length
    || catalog.length > shownCatalog.length || online.length > shownOnline.length
  return <section id="global-search-results" data-testid="global-search-results" aria-label="Search results"
    className="rounded-xl border border-app-border bg-app-surface text-app-text shadow-2xl p-2 max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain">
    <p role="status" className="px-3 py-1 text-xs text-app-muted">{localTotal} local {localTotal === 1 ? 'match' : 'matches'} · Songs and setlists</p>
    {shownSongs.length > 0 && <h2 className={headingClass}>Songs</h2>}
    {shownSongs.map(song => <button type="button" key={`local-${song.id ?? song.originalIdx}`} className={actionClass}
      onClick={() => onSelectSong(song.originalIdx)}>
      <span className="block font-semibold break-words">{song.title}</span><span className="text-app-muted break-words">{song.artist}</span>
    </button>)}
    {shownSetlists.length > 0 && <h2 className={headingClass}>Setlists</h2>}
    {shownSetlists.map(setlist => <button type="button" key={`setlist-${setlist.id}`} className={actionClass} onClick={() => onSelectSetlist(setlist)}>
      <span className="block font-semibold break-words">{setlist.name}</span>
      <span className="text-app-muted">{(setlist.songs || []).length} {(setlist.songs || []).length === 1 ? 'song' : 'songs'}</span>
    </button>)}
    {(shownCatalog.length > 0 || isSearchingCatalog) && <h2 className={headingClass}>
      Shared Catalog{isSearchingCatalog && <Loader2 aria-label="Searching Shared Catalog" className="w-3 h-3 animate-spin text-app-muted" />}
    </h2>}
    {shownCatalog.map(song => <button type="button" key={`catalog-${song.id}`} className={actionClass}
      aria-label={`Preview ${song.title} from Shared Catalog`} onClick={() => onPreviewCatalog(song)}>
      <span className="block font-semibold break-words">{song.title}</span>
      <span className="text-app-muted break-words">{song.artist || 'Unknown Artist'}{song.key ? ` · ${song.key}` : ''}</span>
    </button>)}
    {(shownOnline.length > 0 || isSearchingOnline) && <h2 className={headingClass}>
      Online{isSearchingOnline && <Loader2 aria-label="Searching online" className="w-3 h-3 animate-spin text-app-muted" />}
    </h2>}
    {shownOnline.map(item => <button type="button" key={`online-${item.id}`} className={actionClass}
      aria-label={`Preview ${item.songName} online chords`} onClick={() => onPreviewOnline(item)}>
      <span className="block font-semibold break-words">{item.songName}</span>
      <span className="text-app-muted break-words">{item.artistName}{item.tonality ? ` · ${item.tonality}` : ''}</span>
    </button>)}
    {truncated && <p className="px-3 py-1 text-xs text-app-muted">Showing up to {SEARCH_GROUP_LIMIT} of each. Refine your search for more.</p>}
    <div className="mt-2 border-t border-app-border pt-2">
      {isOffline
        ? <p className="px-3 pb-2 text-xs text-app-muted">Offline: online results are unavailable. Local songs and setlists still work.</p>
        : onlineError && <p className="px-3 pb-2 text-xs text-status-error">{onlineError}</p>}
      {onOpenImport && <button type="button" className={actionClass} onClick={onOpenImport}>Preview &amp; Import a chart</button>}
      {onOpenSources && <button type="button" className={actionClass} onClick={onOpenSources}>Browse external song sources</button>}
    </div>
  </section>
}
