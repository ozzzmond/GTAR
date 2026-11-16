/**
 * MIDI switch, status store and lazy engine loader (#536 Slice 3). This is the only file that
 * reaches ./engine, and only through import() while MIDI is ON: with MIDI off no engine code is
 * loaded, no access is requested and no listener exists. If the engine cannot load, the status
 * is Error and the rest of the app works as before.
 */
import { useSyncExternalStore } from 'react'
import { isIosDevice } from '../utils/iosDevice'
import { readMidiSettings, subscribeMidiSettings, writeMidiSettings } from './settings'
import type { MidiEngine } from './engine'

export type MidiState = 'off' | 'starting' | 'allow' | 'blocked' | 'no-device' | 'connected' | 'error' | 'unavailable'

export interface MidiSnapshot {
  readonly state: MidiState
  /** Names of the inputs being listened to: plain text, cut to MIDI_DEVICE_TEXT_MAX. */
  readonly devices: readonly string[]
}

/** 'ask' may show the browser prompt (a tap). 'quiet' connects only when access is already granted. */
export type MidiStartMode = 'quiet' | 'ask'

export type MidiAvailability = { available: true } | { available: false; reason: string }

/**
 * N/A on iPhone and iPad, on Firefox (Android and desktop, until tested) and wherever the
 * browser has no Web MIDI. The rest is feature detection.
 */
export function midiAvailability(): MidiAvailability {
  const nav = globalThis.navigator
  const firefox = /\b(?:Firefox|FxiOS)\//.test(nav?.userAgent ?? '')
  return !isIosDevice(nav) && !firefox && globalThis.isSecureContext === true && typeof nav?.requestMIDIAccess === 'function'
    ? { available: true } : { available: false, reason: 'Not available on this device/browser' }
}

const only = (state: MidiState): MidiSnapshot => ({ state, devices: [] })
const OFF = only('off'), STARTING = only('starting'), ERROR = only('error'), UNAVAILABLE = only('unavailable')

let snapshot = OFF
/** True while MIDI should run in this page. */
let wanted = false
/** Counts every start and stop, so a late engine load after OFF is ignored. */
let turn = 0
let engine: MidiEngine | null = null
const listeners = new Set<() => void>()

function publish(next: MidiSnapshot): void {
  if (next.state === snapshot.state && next.devices.length === snapshot.devices.length && next.devices.every((name, index) => name === snapshot.devices[index])) return
  snapshot = next
  for (const listener of [...listeners]) {
    try { listener() } catch { /* One failing subscriber must not stop the others. */ }
  }
}

async function begin(mode: MidiStartMode): Promise<void> {
  const mine = ++turn
  try {
    if (!engine) {
      publish(STARTING)
      const { createMidiEngine } = await import('./engine')
      if (mine !== turn) return
      engine ??= createMidiEngine({ onChange: next => { if (wanted) publish(next) } })
    }
    engine.start(mode)
  } catch {
    if (mine === turn) publish(ERROR)
  }
}

function apply(enabled: boolean, mode: MidiStartMode): void {
  if (enabled === wanted) return
  wanted = enabled
  if (enabled) { void begin(mode); return }
  turn++
  try { engine?.stop() } catch { /* Off is shown either way. */ }
  publish(OFF)
}

/** The switch. Turning on from a tap may show the browser prompt; the choice is saved on this device. */
export function setMidiEnabled(enabled: boolean): void {
  if (!midiAvailability().available) return
  // Applied before saving: the save announces a change, and that path never prompts.
  apply(enabled, 'ask')
  const settings = readMidiSettings()
  if (settings.enabled !== enabled) writeMidiSettings({ ...settings, enabled })
}

/** The dialog's Allow MIDI, Try again and Check again: ask the browser again while MIDI is on. */
export function retryMidi(): void {
  if (wanted && midiAvailability().available) void begin('ask')
}

/**
 * App start: if MIDI was left ON, connect without a prompt when access is already granted
 * (otherwise the status is Allow or Blocked). Also follows the switch from another tab.
 * Returns the cleanup, which detaches without changing the saved choice.
 */
export function startMidi(): () => void {
  if (!midiAvailability().available) return () => {}
  const sync = () => apply(readMidiSettings().enabled, 'quiet')
  sync()
  const unsubscribe = subscribeMidiSettings(sync)
  return () => { unsubscribe(); apply(false, 'quiet') }
}

export function getMidiSnapshot(): MidiSnapshot {
  return midiAvailability().available ? snapshot : UNAVAILABLE
}

export function subscribeMidi(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useMidiSnapshot(): MidiSnapshot {
  return useSyncExternalStore(subscribeMidi, getMidiSnapshot, () => OFF)
}
