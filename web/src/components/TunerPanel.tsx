import React, { useEffect, useSyncExternalStore } from 'react'
import { Volume2 } from 'lucide-react'
import { GUITAR_STRINGS, tunerTone } from '../utils/tunerTone'

/** Tuner for the Stage toolbar panel: reference tones for the six guitar strings. */
export const TunerPanel: React.FC = () => {
  const active = useSyncExternalStore(tunerTone.subscribe, tunerTone.getActive, () => null)

  // The tone belongs to the open panel: closing it stops the sound.
  useEffect(() => () => tunerTone.stop(), [])

  return (
    <div className="space-y-3">
      <p className="text-xs text-app-muted text-center">Tap a string to hear its pitch.</p>

      <div className="grid grid-cols-3 gap-2">
        {GUITAR_STRINGS.map((str) => {
          const isPlaying = active === str.name
          return (
            <button
              key={str.name}
              type="button"
              aria-pressed={isPlaying}
              onClick={() => tunerTone.toggle(str.name, str.freq)}
              className={`min-h-11 p-2.5 rounded-xl border text-center cursor-pointer flex flex-col items-center gap-1 focus-visible:outline-2 focus-visible:outline-app-action ${
                isPlaying
                  ? 'bg-app-action/20 border-app-action text-app-action shadow-md'
                  : 'bg-app-base border-app-border text-app-text hover:border-app-action'
              }`}
            >
              <Volume2 className={`w-4 h-4 ${isPlaying ? 'text-app-action' : 'text-app-muted'}`} aria-hidden="true" />
              <span className="text-xs font-extrabold">{str.name}</span>
              <span className="text-[10px] font-mono text-app-muted">{str.freq.toFixed(1)} Hz</span>
            </button>
          )
        })}
      </div>

      <p role="status" className="min-h-4 text-center text-xs font-bold text-app-action">
        {active ? `Playing ${active}` : ''}
      </p>
    </div>
  )
}
