import type { BandSyncFollower } from '../utils/bandSyncSync'
import { SongLineRenderer } from './SongLineRenderer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { createBandSyncScroll } from '../utils/bandSyncScroll'
/** Already-projected chart: render once, never transpose or write into the library. */
export function BandSyncRemoteView({ view }: { view: BandSyncFollower }) {
  const viewport = useRef<HTMLDivElement>(null)
  const scroll = useRef<ReturnType<typeof createBandSyncScroll> | null>(null)
  // Full screen is a view-only toggle (never stored). It covers the app so it also works where the browser
  // Fullscreen API is unavailable (iPhone Safari); where the API exists it is requested as well.
  const [immersive, setImmersive] = useState(false)
  const toggle = useCallback(() => {
    const next = !immersive
    setImmersive(next)
    try {
      if (next) void document.documentElement.requestFullscreen?.()?.catch(() => { /* Overlay still covers the app. */ })
      else if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => { /* Already out. */ })
    } catch { /* Overlay-only mode. */ }
  }, [immersive])
  useEffect(() => {
    if (!immersive) return
    const onChange = () => { if (!document.fullscreenElement) setImmersive(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setImmersive(false) }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('keydown', onKey) }
  }, [immersive])
  // Leaving the view (unmount) must not leave the browser stuck in full screen.
  useEffect(() => () => { try { if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => {}) } catch { /* Ignore. */ } }, [])
  useEffect(() => {
    if (!viewport.current) return
    const controller = createBandSyncScroll(viewport.current)
    scroll.current = controller
    return () => { controller.dispose(); scroll.current = null }
  }, [])
  useEffect(() => { scroll.current?.apply(view.state, view.leaderOnline && !view.revoked) }, [view.state, view.content, view.leaderOnline, view.revoked, view.sequence, immersive])
  const Icon = immersive ? Minimize2 : Maximize2
  // The same elements stay mounted when the mode changes, so the scroll controller keeps its viewport.
  return <section aria-label="Band Sync read-only view"
    className={immersive ? 'fixed inset-0 z-[100] flex flex-col p-3 bg-app-surface text-app-text' : 'p-4 sm:p-6 bg-app-surface text-app-text rounded-xl border border-app-border'}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p role="status" className="text-sm text-app-muted">{view.leaderOnline ? 'Following leader · Read only' : 'Leader offline'}</p>
        <h1 className={immersive ? 'text-lg font-bold text-app-heading truncate' : 'text-2xl font-bold text-app-heading'}>{view.state?.displayTitle ?? 'Waiting for song'}</h1>
      </div>
      <button type="button" onClick={toggle} aria-pressed={immersive} aria-label={immersive ? 'Exit full screen' : 'Full screen'}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-app-border bg-app-base text-xs font-bold cursor-pointer">
        <Icon className="w-4 h-4" aria-hidden="true" />{immersive ? 'Exit full screen' : 'Full screen'}
      </button>
    </div>
    <p className="mb-2">Key: {view.state?.effectiveKey || '—'}{!!view.state?.setlist.count && <> · Song {view.state.setlist.index + 1} of {view.state.setlist.count}</>}</p>
    <div ref={viewport} data-testid="band-sync-viewport" className={immersive ? 'flex-1 min-h-0 overflow-y-auto' : 'max-h-[70vh] overflow-y-auto'}>
      {view.content ? <SongLineRenderer lines={view.content.snapshot.lines} fontSizePx={24} fontFamily="sans" notation={view.content.snapshot.mode.notation} referenceKey={view.state?.effectiveKey} readOnly /> : <p>Waiting for chart</p>}
    </div>
  </section>
}
