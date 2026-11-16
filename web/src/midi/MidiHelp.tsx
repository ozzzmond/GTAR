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
            <p>One press is one step. Holding or releasing a pedal does nothing more. Set a latching footswitch to momentary.</p>
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
        content: <p>USB and Bluetooth controllers work when your device shows them to the browser. Pair a Bluetooth controller in your device settings first.</p>,
      },
      {
        title: 'Where it works',
        defaultExpanded: false,
        content: <p>Chrome on Android, and Chrome or Edge on a computer. It is not available on iPhone, iPad, Safari or Firefox.</p>,
      },
    ]}
  />
)
