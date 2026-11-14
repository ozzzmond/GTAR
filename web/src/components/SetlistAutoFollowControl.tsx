import type { useSetlistAutoFollow } from '../utils/useSetlistAutoFollow'

export function SetlistAutoFollowControl({ follow }: { follow: ReturnType<typeof useSetlistAutoFollow> }) {
  return <div className="mt-2 border-t border-app-border pt-2" data-testid="setlist-auto-follow">
    <p className="text-sm" role="status">{follow.state.status}</p>
    {follow.state.mode === 'assisted' ? <button type="button" className="ui-button min-h-11 px-3" disabled={!follow.available} onClick={follow.controller.enable}>Enable Auto Follow - current setlist only</button> : <>
      <button type="button" className="ui-button min-h-11 px-3" onClick={follow.controller.assisted}>Use Assisted mode</button>
      {follow.state.paused && <button type="button" className="ui-button min-h-11 px-3" disabled={!follow.available} onClick={follow.controller.resume}>Resume Auto Follow</button>}
      {follow.state.choices.map(entry => <button type="button" key={entry.entryId} className="ui-button min-h-11 px-3 block" onClick={() => follow.controller.choose(entry.index)}>Follow entry {entry.index + 1}: {entry.title}{entry.artist ? ` - ${entry.artist}` : ''}</button>)}
    </>}
    <p className="text-xs text-app-muted">DEV: latest observed presentation; rapid transitions can briefly select the wrong song. Lyrics follow automatically only after fresh, unambiguous content checks.</p>
  </div>
}
