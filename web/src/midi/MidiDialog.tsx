import React from 'react'
import { Music } from 'lucide-react'
import { AppModal, AppModalSection } from '../components/AppModal'
import { MidiHelp } from './MidiHelp'
import { MidiPill } from './MidiRow'
import { retryMidi, setMidiEnabled, useMidiSnapshot, type MidiSnapshot, type MidiState } from './loader'

function statusText({ state, devices }: MidiSnapshot): string {
  switch (state) {
    case 'off': return 'MIDI is off. Turn it on to use a pedal or controller.'
    case 'starting': return 'Looking for MIDI devices…'
    case 'allow': return 'Your browser needs your OK to use MIDI.'
    case 'blocked': return 'MIDI is blocked for this site. Allow it in your browser\'s site settings, then try again.'
    case 'no-device': return 'No MIDI device found. Plug in or pair your controller.'
    case 'connected': return devices.length === 1 ? `Connected: ${devices[0]}` : `Connected: ${devices.length} devices`
    case 'error': return 'MIDI could not start. Turn it off and on again.'
    case 'unavailable': return 'Not available on this device/browser'
  }
}

/** The one context button under the status line. States without an entry have no button. */
const ACTIONS: Partial<Record<MidiState, { label: string; run: () => void }>> = {
  off: { label: 'Turn on', run: () => setMidiEnabled(true) },
  allow: { label: 'Allow MIDI', run: retryMidi },
  blocked: { label: 'Try again', run: retryMidi },
  'no-device': { label: 'Check again', run: retryMidi },
}

interface MidiDialogProps {
  onClose: () => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

/** MIDI as an application-level dialog; mounted only while open. This slice shows the connection only. */
export const MidiDialog: React.FC<MidiDialogProps> = ({ onClose, returnFocusRef }) => {
  const snapshot = useMidiSnapshot()
  const action = ACTIONS[snapshot.state]

  return (
    <AppModal
      onClose={onClose}
      title="MIDI"
      titleId="midi-modal-title"
      icon={<Music className="w-4 h-4" aria-hidden="true" />}
      panelId="midi-panel"
      testId="midi-panel"
      backdropTestId="midi-modal-backdrop"
      returnFocusRef={returnFocusRef}
      headerActions={
        <>
          <MidiPill state={snapshot.state} className="rounded-full px-2" />
          <MidiHelp />
        </>
      }
    >
      <AppModalSection title="Connection">
        {/* The device name is rendered as a text node: plain text, never HTML. */}
        <p role="status" aria-live="polite" data-testid="midi-status" className="text-sm text-app-heading break-words">{statusText(snapshot)}</p>
        {action && (
          <button
            type="button"
            data-testid="midi-status-action"
            onClick={action.run}
            className="min-h-11 min-w-11 px-4 rounded-xl border border-app-border bg-app-base hover:bg-app-surface text-app-heading text-xs font-semibold flex items-center cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action"
          >
            {action.label}
          </button>
        )}
      </AppModalSection>
    </AppModal>
  )
}
