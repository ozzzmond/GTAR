/**
 * The MIDI allowlist (#536): the nine things a pedal or controller may do, in dialog order.
 * Nothing else can be mapped, stored or dispatched. Ids equal the Stage command names.
 */
export const MIDI_ACTIONS = [
  { id: 'nextSong', label: 'Next song' },
  { id: 'prevSong', label: 'Previous song' },
  { id: 'nextSection', label: 'Next section' },
  { id: 'prevSection', label: 'Previous section' },
  { id: 'toggleAutoScroll', label: 'Autoscroll on/off' },
  { id: 'scrollUp', label: 'Scroll up' },
  { id: 'scrollDown', label: 'Scroll down' },
  { id: 'transposeUp', label: 'Transpose up' },
  { id: 'transposeDown', label: 'Transpose down' },
] as const

export type MidiActionId = (typeof MIDI_ACTIONS)[number]['id']

export const MIDI_ACTION_IDS: readonly MidiActionId[] = MIDI_ACTIONS.map(action => action.id)

/** Checked at Learn, on load and at dispatch. Only an exact id string passes. */
export function isMidiActionId(value: unknown): value is MidiActionId {
  return typeof value === 'string' && (MIDI_ACTION_IDS as readonly string[]).includes(value)
}

export function midiActionLabel(id: MidiActionId): string {
  return MIDI_ACTIONS.find(action => action.id === id)!.label
}
