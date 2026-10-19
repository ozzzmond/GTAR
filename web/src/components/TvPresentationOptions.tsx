import React, { useSyncExternalStore } from 'react'
import { stageCast2Controller } from '../utils/stageCast2Controller'
import { cast2LocalEnabled } from '../utils/stageCast2Local'

void React

const subscribe = (listener: () => void) => stageCast2Controller.subscribe(listener)
const getChords = () => stageCast2Controller.getChords()

/** Receiver preferences stay separate from controller notation, sizing and layout. */
export function TvPresentationOptions() {
  const chords = useSyncExternalStore(subscribe, getChords, getChords)
  if (!cast2LocalEnabled) return null
  return <section aria-labelledby="tv-presentation-options" className="border-t border-app-border pt-4 mb-5 space-y-3">
    <h3 id="tv-presentation-options" className="text-xs font-bold uppercase tracking-wider text-app-action">TV Presentation / TV Sync</h3>
    <p className="text-xs text-app-muted">TV display only. Controller settings above stay independent. Manage pairing and connection in Cast Options.</p>
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-app-muted w-20 shrink-0">TV chords</span>
      <div className="grid grid-cols-2 gap-1.5 flex-1">
        {[false, true].map(visible => <button key={String(visible)} type="button"
          aria-pressed={chords === visible} onClick={() => stageCast2Controller.setChords(visible)}
          className={`min-h-11 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all cursor-pointer ${chords === visible
            ? 'bg-app-action text-app-on-action border-app-action shadow-sm'
            : 'bg-app-base text-app-text border-app-border hover:border-app-action'}`}>
          {visible ? 'Show chords' : 'Lyrics only'}
        </button>)}
      </div>
    </div>
  </section>
}
