import React from 'react'
import { ChevronRight, Tv } from 'lucide-react'
import { launcherButton, launcherIcon, launcherRow, launcherSwitch } from './advancedToolsRow'
import { setTvSyncEnabled, useTvSyncEnabled } from '../utils/tvSyncSettings'
import { stageCast2Controller } from '../utils/stageCast2Controller'

const SUMMARY = 'TV presentation & second screen'

interface TvSyncRowProps {
  /** Same row style the Advanced Tools popover uses for its other rows. */
  rowClass: string
  /** Opens the app-level TV Sync / presentation dialog owned by the caller. */
  onOpenDialog?: () => void
}

export const TvSyncRow: React.FC<TvSyncRowProps> = ({ rowClass, onOpenDialog }) => {
  const enabled = useTvSyncEnabled()
  const isConnected = React.useSyncExternalStore(
    listener => stageCast2Controller.subscribe(listener),
    () => stageCast2Controller.getView().state === 'CONNECTED',
    () => false
  )

  return (
    <div data-testid="tv-sync-row" className="mb-2 last:mb-0">
      <div className={`${launcherRow(rowClass)} justify-between`}>
        <button
          type="button"
          data-testid="tv-sync-expand"
          aria-haspopup="dialog"
          onClick={onOpenDialog}
          className={launcherButton}
        >
          <Tv className={launcherIcon} aria-hidden="true" />
          <div className="flex flex-1 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>TV Sync</span>
            {isConnected && (
              <span className="shrink-0 whitespace-nowrap text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                Connected
              </span>
            )}
          </div>
          <span className="sr-only">{SUMMARY}</span>
          <ChevronRight className="w-3.5 h-3.5 text-app-muted shrink-0" aria-hidden="true" />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="TV Sync"
          data-testid="settings-tv-sync"
          onClick={() => setTvSyncEnabled(!enabled)}
          className={`${launcherSwitch} rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent`}
        >
          <span className={`block w-11 h-6 rounded-full transition-colors motion-reduce:transition-none relative p-0.5 border ${enabled ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>
    </div>
  )
}
