import type { BandSyncFollower } from '../utils/bandSyncSync'
import { SongLineRenderer } from './SongLineRenderer'
import { useEffect, useRef } from 'react'
import { createBandSyncScroll } from '../utils/bandSyncScroll'
/** Already-projected chart: render once, never transpose or write into the library. */
export function BandSyncRemoteView({ view }: { view: BandSyncFollower }) {
  const viewport = useRef<HTMLDivElement>(null)
  const scroll = useRef<ReturnType<typeof createBandSyncScroll> | null>(null)
  useEffect(() => {
    if (!viewport.current) return
    const controller = createBandSyncScroll(viewport.current)
    scroll.current = controller
    return () => { controller.dispose(); scroll.current = null }
  }, [])
  useEffect(() => { scroll.current?.apply(view.state, view.leaderOnline && !view.revoked) }, [view.state, view.content, view.leaderOnline, view.revoked, view.sequence])
  return <section aria-label="Band Sync read-only view" className="p-4 sm:p-6 bg-app-surface text-app-text rounded-xl border border-app-border">
    <p role="status" className="text-sm text-app-muted">{view.leaderOnline ? 'Following leader · Read only' : 'Leader offline'}</p>
    <h1 className="text-2xl font-bold text-app-heading">{view.state?.displayTitle ?? 'Waiting for song'}</h1>
    <p className="mb-4">Key: {view.state?.effectiveKey || '—'}</p>
    {!!view.state?.setlist.count && <p>Song {view.state.setlist.index + 1} of {view.state.setlist.count}</p>}
    <div ref={viewport} data-testid="band-sync-viewport" className="max-h-[70vh] overflow-y-auto">
      {view.content ? <SongLineRenderer lines={view.content.snapshot.lines} fontSizePx={24} fontFamily="sans" notation={view.content.snapshot.mode.notation} referenceKey={view.state?.effectiveKey} readOnly /> : <p>Waiting for chart</p>}
    </div>
  </section>
}
