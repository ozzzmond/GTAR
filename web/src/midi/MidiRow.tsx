import React from 'react'
import { ChevronRight, Music } from 'lucide-react'
import { flatRow, launcherButton, launcherIcon, launcherRow, launcherSwitch } from '../components/advancedToolsRow'
import { midiAvailability, setMidiEnabled, useMidiSnapshot, type MidiState } from './loader'

const SUMMARY = 'Pedal or controller for Stage'

const amber = 'bg-amber-400/15 text-amber-400 border-amber-400/30'
const red = 'bg-rose-500/15 text-rose-400 border-rose-500/30'
const green = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
const grey = 'bg-app-surface text-app-muted border-app-border'

/** Every pill carries text; colour is never the only signal. */
const PILLS: Record<MidiState, [label: string, tone: string]> = {
  off: ['Off', grey],
  starting: ['Starting', amber],
  allow: ['Allow', amber],
  blocked: ['Blocked', red],
  'no-device': ['No device', grey],
  connected: ['Ready', green],
  error: ['Error', red],
  unavailable: ['N/A', red],
}

export const MidiPill: React.FC<{ state: MidiState; className?: string }> = ({ state, className = '' }) => (
  <span data-testid="midi-pill" className={`shrink-0 whitespace-nowrap text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${PILLS[state][1]} ${className}`}>
    {PILLS[state][0]}
  </span>
)

interface MidiRowProps {
  /** Same row style the Advanced Tools popover uses for its other rows. */
  rowClass: string
  /** Opens the app-level MIDI dialog owned by the caller. */
  onOpenDialog: () => void
}

/**
 * #536: the MIDI launcher row in Advanced Tools. The row opens the MIDI dialog; the switch only
 * turns MIDI on or off. Where MIDI cannot run the row is plain text with an N/A pill.
 */
export const MidiRow: React.FC<MidiRowProps> = ({ rowClass, onOpenDialog }) => {
  const { state } = useMidiSnapshot()
  const availability = midiAvailability()

  if (!availability.available) {
    return (
      <div data-testid="midi-row" className="mb-2 last:mb-0">
        <div className={`${flatRow(rowClass)} justify-between`}>
          <div className="flex flex-1 min-w-0 items-center gap-2.5">
            <Music className="w-4 h-4 text-app-muted shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0 text-left">
              <span className="block">MIDI</span>
              <span className="block text-app-muted text-[10px] font-normal">{SUMMARY}</span>
            </div>
            {/* Short visible pill; the full reason is read by screen readers instead. */}
            <span data-testid="midi-unavailable" className={`shrink-0 whitespace-nowrap text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${red}`}>
              <span aria-hidden="true">N/A</span>
              <span className="sr-only">{availability.reason}</span>
            </span>
          </div>
        </div>
      </div>
    )
  }

  const isOn = state !== 'off'
  return (
    <div data-testid="midi-row" className={`${launcherRow(rowClass)} justify-between mb-2 last:mb-0`}>
      <button type="button" data-testid="midi-expand" aria-haspopup="dialog" onClick={onOpenDialog} className={launcherButton}>
        <Music className={launcherIcon} aria-hidden="true" />
        <div className="flex flex-1 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>MIDI</span>
          {/* The switch already says off; a pill appears for what it cannot say. */}
          {isOn && <MidiPill state={state} />}
        </div>
        <span className="sr-only">{SUMMARY}</span>
        <ChevronRight className="w-3.5 h-3.5 text-app-muted shrink-0" aria-hidden="true" />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label="MIDI"
        data-testid="settings-midi"
        onClick={() => setMidiEnabled(!isOn)}
        className={`${launcherSwitch} rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent`}
      >
        <span className={`block w-11 h-6 rounded-full transition-colors motion-reduce:transition-none relative p-0.5 border ${isOn ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'}`}>
          <span className={`block w-5 h-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${isOn ? 'translate-x-5' : 'translate-x-0'}`} />
        </span>
      </button>
    </div>
  )
}
