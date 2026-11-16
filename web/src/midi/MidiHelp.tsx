import React from 'react'
import { ContextualHelp } from '../components/ContextualHelp'

/** The one MIDI help, opened from the "?" in the MIDI dialog header. */
export const MidiHelp: React.FC = () => (
  <ContextualHelp
    id="midi-help"
    title="MIDI"
    buttonTestId="midi-help-button"
    panelTestId="midi-help"
    quickSummary="Connects a MIDI pedal or controller and lets it control Stage. Nothing is set until you teach it with Learn."
    topics={[
      {
        title: 'Status',
        defaultExpanded: true,
        content: (
          <div className="space-y-1">
            <p><strong>Ready:</strong> a MIDI device is connected.</p>
            <p><strong>No device:</strong> plug in or pair your controller.</p>
            <p><strong>Allow:</strong> your browser needs your OK. Tap Allow MIDI.</p>
            <p><strong>Blocked:</strong> allow MIDI for this site in your browser&apos;s site settings, then tap Try again.</p>
            <p><strong>Error:</strong> turn MIDI off and on again.</p>
          </div>
        ),
      },
      {
        title: 'Actions and Learn',
        defaultExpanded: false,
        content: (
          <div className="space-y-1">
            <p>Tap <strong>Learn</strong> next to an action, then press the pedal or button for it. It needs a connected device and waits 10 seconds.</p>
            <p>One pedal or button does one action. If it is already used, choose Replace or Cancel.</p>
            <p><strong>Clear</strong> unsets one action. <strong>Reset</strong> unsets all of them.</p>
            <p>One press is one step. Holding or releasing a pedal does nothing more.</p>
            <p>A latching pedal sends on for one press and off for the next, so it acts on every second press. Set it to momentary.</p>
          </div>
        ),
      },
      {
        title: 'On Stage',
        defaultExpanded: false,
        content: <p>The pedal works while Stage is open. It does nothing while a dialog or menu is open, or while you follow a Band Sync leader. Transpose by pedal is saved with the song, like the on-screen buttons.</p>,
      },
      {
        title: 'On / Off switch',
        defaultExpanded: false,
        content: <p>The switch is in Advanced Tools. While it is off, GTAR does not ask for MIDI and does not listen to any device.</p>,
      },
      {
        title: 'Devices',
        defaultExpanded: false,
        content: (
          <div className="space-y-1">
            <p><strong>USB:</strong> plug the controller in, then switch MIDI on.</p>
            <p><strong>Bluetooth:</strong> pair the controller in your phone or computer&apos;s Bluetooth settings first. Some browsers list it only after it is connected. If it does not show, switch the controller on and tap Check again.</p>
          </div>
        ),
      },
      {
        title: 'Where it works',
        defaultExpanded: false,
        content: <p>Chrome on Android, and Chrome or Edge on a computer. MIDI is not available on iPhone and iPad, or in Safari. Firefox shows N/A until it is tested.</p>,
      },
    ]}
  />
)
