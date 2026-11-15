import type { useSetlistAutoFollow } from '../utils/useSetlistAutoFollow'

export function SetlistAutoFollowControl({ follow }: { follow: ReturnType<typeof useSetlistAutoFollow> }) {
  return (
    <div className="mt-2 border-t border-app-border/40 pt-2 space-y-1.5" data-testid="setlist-auto-follow">
      <p className="text-xs font-medium text-app-heading" role="status">
        {follow.state.status}
      </p>
      {follow.state.mode === 'assisted' ? (
        <button
          type="button"
          className="ui-button min-h-11 px-3 w-full font-medium"
          disabled={!follow.available}
          onClick={follow.controller.enable}
        >
          Enable Auto Follow - current setlist only
        </button>
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            className="ui-button min-h-11 px-3 w-full font-medium"
            onClick={follow.controller.assisted}
          >
            Use Assisted mode
          </button>
          {follow.state.paused && (
            <button
              type="button"
              className="ui-button min-h-11 px-3 w-full font-medium"
              disabled={!follow.available}
              onClick={follow.controller.resume}
            >
              Resume Auto Follow
            </button>
          )}
          {follow.state.choices.map((entry) => (
            <button
              type="button"
              key={entry.entryId}
              className="ui-button min-h-11 px-3 block w-full text-left font-medium truncate"
              onClick={() => follow.controller.choose(entry.index)}
            >
              Follow entry {entry.index + 1}: {entry.title}
              {entry.artist ? ` - ${entry.artist}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
