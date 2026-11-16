/**
 * MIDI mapping schema v1 (#536): one input per action, one action per input. A mapping stores
 * type, channel and number only; value and velocity are never stored. Every function is pure
 * and returns a new object, so a caller can never change a stored mapping by accident.
 */
import { MIDI_ACTION_IDS, isMidiActionId, type MidiActionId } from './actions'
import { MIDI_MAX_CC_NUMBER, type MidiMessage } from './message'

export type MidiInputType = 'note' | 'cc' | 'pc'

export interface MidiInput {
  type: MidiInputType
  /** 1–16. */
  channel: number
  /** 0–127; a Control Change is 0–119. */
  number: number
}

export type MidiMappings = Partial<Record<MidiActionId, MidiInput>>

/** A Control Change counts as pressed from this value up. */
export const MIDI_CC_PRESS_THRESHOLD = 64

const INPUT_TYPES: readonly string[] = ['note', 'cc', 'pc']
const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** A clean copy with exactly the three stored fields, or null when any field is bad. */
export function validateMidiInput(value: unknown): MidiInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { type, channel, number } = value as Record<string, unknown>
  if (typeof type !== 'string' || !INPUT_TYPES.includes(type)) return null
  if (!isIntegerIn(channel, 1, 16)) return null
  if (!isIntegerIn(number, 0, type === 'cc' ? MIDI_MAX_CC_NUMBER : 127)) return null
  return { type: type as MidiInputType, channel, number }
}

export function sameMidiInput(a: MidiInput, b: MidiInput): boolean {
  return a.type === b.type && a.channel === b.channel && a.number === b.number
}

/** Stable text key for an input, for maps and sets. */
export function midiInputKey(input: MidiInput): string {
  return `${input.type}:${input.channel}:${input.number}`
}

/**
 * The input Learn captures from a message: a Note On, a Control Change at 64 or more, or a
 * Program Change. Note Off and a Control Change below 64 capture nothing.
 */
export function learnableMidiInput(message: MidiMessage): MidiInput | null {
  const type = message.type === 'noteOn' ? 'note'
    : message.type === 'cc' && message.value >= MIDI_CC_PRESS_THRESHOLD ? 'cc'
    : message.type === 'pc' ? 'pc'
    : null
  return type ? validateMidiInput({ type, channel: message.channel, number: message.number }) : null
}

/**
 * Load-time check. An unknown action id or a bad mapping is dropped and the rest stays. If
 * stored data gives one input to two actions, the first action in allowlist order keeps it.
 */
export function validateMidiMappings(value: unknown): MidiMappings {
  const result: MidiMappings = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  const used = new Set<string>()
  for (const id of MIDI_ACTION_IDS) {
    if (!Object.hasOwn(value, id)) continue
    const input = validateMidiInput((value as Record<string, unknown>)[id])
    if (!input || used.has(midiInputKey(input))) continue
    used.add(midiInputKey(input))
    result[id] = input
  }
  return result
}

/** Dispatch lookup by type, channel and number. Can only return one of the nine action ids. */
export function findMidiAction(mappings: MidiMappings, input: MidiInput): MidiActionId | null {
  for (const id of MIDI_ACTION_IDS) {
    const mapped = Object.hasOwn(mappings, id) ? mappings[id] : undefined
    if (mapped && sameMidiInput(mapped, input)) return id
  }
  return null
}

/** The other action already using this input, if any. */
export function findMidiConflict(mappings: MidiMappings, actionId: MidiActionId, input: MidiInput): MidiActionId | null {
  const owner = findMidiAction(mappings, input)
  return owner && owner !== actionId ? owner : null
}

export type MidiAssignResult =
  | { ok: true; mappings: MidiMappings }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'conflict'; conflict: MidiActionId }

/**
 * Learn result → mappings. An input used by another action is a conflict unless `replace` is
 * set (the player chose Replace); then it moves and the other action becomes unset. Nothing is
 * replaced silently.
 */
export function assignMidiMapping(mappings: MidiMappings, actionId: unknown, input: unknown, options: { replace?: boolean } = {}): MidiAssignResult {
  const clean = validateMidiInput(input)
  if (!isMidiActionId(actionId) || !clean) return { ok: false, reason: 'invalid' }
  const current = validateMidiMappings(mappings)
  const conflict = findMidiConflict(current, actionId, clean)
  if (conflict && options.replace !== true) return { ok: false, reason: 'conflict', conflict }
  if (conflict) delete current[conflict]
  current[actionId] = clean
  return { ok: true, mappings: current }
}

/** Clear: one action becomes unset. */
export function clearMidiMapping(mappings: MidiMappings, actionId: unknown): MidiMappings {
  const current = validateMidiMappings(mappings)
  if (isMidiActionId(actionId)) delete current[actionId]
  return current
}

/** Reset: no action is mapped. */
export function resetMidiMappings(): MidiMappings {
  return {}
}
