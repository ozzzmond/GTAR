import React from 'react'
import { ContextualHelp, type HelpTopic } from './ContextualHelp'

/** "?" help for the Stage tool panels (Metronome, Tuner). One short topic per control; the first starts open. */
type Entry = [title: string, text: string]

const topics = (entries: Entry[]): HelpTopic[] =>
  entries.map(([title, text], index) => ({ title, content: <p>{text}</p>, defaultExpanded: index === 0 }))

interface StageToolHelpProps {
  prefer?: 'below' | 'above'
  className?: string
}

export const MetronomeHelp: React.FC<StageToolHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="metronome-help"
    title="Metronome"
    buttonTestId="metronome-help-button"
    panelTestId="metronome-help"
    quickSummary="Set the tempo, then tap Start. It keeps going if you close this panel."
    topics={topics([
      ['Tempo', 'Drag the slider, use the -5, -1, +1 and +5 buttons, or type a BPM. Tap sets the tempo from your taps.'],
      ['Beats and accents', 'Pick the time signature. Tap a beat light to change it between accent, normal and silent.'],
      ['Start and Stop', 'Start begins the click. Closing this panel does not stop it, so you can keep playing. Press Stop here, or switch the tool off in Advanced Tools.'],
      ['Count-in', 'Plays one bar of clicks before the beat lights start counting.'],
      ['Sound on / Lights only', 'Lights only mutes the click and keeps the beat lights, handy when you only want a visual cue.'],
      ['Sound and split ears', 'Choose the click sound and volume. Split ears sends a different click to each ear, so use earphones.'],
    ])}
  />
)

export const TunerHelp: React.FC<StageToolHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="tuner-help"
    title="Tuner"
    buttonTestId="tuner-help-button"
    panelTestId="tuner-help"
    quickSummary="Tap Start listening, allow the microphone, then play one note."
    topics={topics([
      ['Start listening', 'Allows the microphone and shows the note you play. Closing this panel turns the microphone off.'],
      ['Auto and Preset', 'Auto names any note it hears. Preset compares what you play to the strings of the tuning you picked.'],
      ['Tuning', 'Pick your instrument and tuning, for example guitar, bass, ukulele or an alternate tuning.'],
      ['Reading the needle', 'Center means in tune. Left is flat, so tune up. Right is sharp, so tune down.'],
      ['Hear a string', 'Tap a string to hear its pitch and tune by ear. Tap it again to stop.'],
      ['A4 (Hz)', 'The reference pitch. Leave it at 440 unless your band tunes differently.'],
    ])}
  />
)
