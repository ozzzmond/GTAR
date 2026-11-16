import React from 'react'
import { ContextualHelp } from '../components/ContextualHelp'

/** The one MIDI help, opened from the "?" in the MIDI dialog header. */
export const MidiHelp: React.FC = () => (
  <ContextualHelp
    id="midi-help"
    title="MIDI"
    buttonTestId="midi-help-button"
    panelTestId="midi-help"
    quickSummary="Connects a MIDI pedal or controller. For now it only shows whether a device is connected; it does not control Stage yet."
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
