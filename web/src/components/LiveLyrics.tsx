import type { useLiveLyrics } from '../utils/useLiveLyrics'

export function LiveLyricsControl({ live, songTitle }: { live: ReturnType<typeof useLiveLyrics>; songTitle: string }) {
  if (!live.snapshot) return null
  return <details className="border border-app-border rounded-lg bg-app-surface text-app-text px-3 py-2 text-sm" data-testid="live-lyrics-control">
    <summary className="cursor-pointer min-h-11 flex items-center">ProPresenter · {live.status}</summary>
    {live.confirmed ? <button type="button" className="ui-button min-h-11 px-3" onClick={live.stop}>Stop live lyrics</button> : <>
      <p>Confirm GTAR song “{songTitle}” and the observed presentation and current slide belong to the same song. This link lasts only for this fullscreen session.</p>
      <p className="mt-2 break-words">Presentation: {live.snapshot.presentation?.title ?? 'Unavailable'}</p>
      <p className="text-xs break-all">{live.snapshot.presentation?.uuid}</p>
      <p className="whitespace-pre-wrap mt-2">Current slide: {live.snapshot.current?.text ?? 'Unavailable'}</p>
      <button type="button" className="ui-button min-h-11 px-3 mt-2 disabled:opacity-50" disabled={!live.canConfirm} onClick={live.confirm}>Confirm same song · enable highlights</button>
    </>}
    <p role="status" className="text-app-muted">{live.status}. Highlight only; scroll manually.</p>
  </details>
}
