import type { BandSyncFollower } from '../utils/bandSyncSync'
import { SongLineRenderer } from './SongLineRenderer'
/** Already-projected chart: render once, never transpose or write into the library. */
export function BandSyncRemoteView({ view }: { view: BandSyncFollower }) {
  return <section aria-label="Band Sync read-only view" className="p-4 sm:p-6 bg-app-surface text-app-text rounded-xl border border-app-border">
    <p role="status" className="text-sm text-app-muted">{view.leaderOnline ? 'Following leader · Read only' : 'Leader offline'}</p>
    <h1 className="text-2xl font-bold text-app-heading">{view.state?.displayTitle ?? 'Waiting for song'}</h1>
    <p className="mb-4">Key: {view.state?.effectiveKey || '—'}</p>
    {view.content ? <SongLineRenderer lines={view.content.snapshot.lines} fontSizePx={24} fontFamily="sans" notation={view.content.snapshot.mode.notation} referenceKey={view.state?.effectiveKey} readOnly /> : <p>Waiting for chart</p>}
  </section>
}
