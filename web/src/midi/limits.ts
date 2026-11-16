/**
 * Press detection and rate limits for MIDI input (#536). Every action is one press, one step:
 * releasing does nothing and holding never repeats. Starting values, to be tuned in QA.
 *
 *   press(port, message)  → the input when this message is a new press, else null
 *   allow(input)          → true when a mapped press may fire now (debounce + burst cap)
 *
 * The caller looks the input up between the two calls, so only presses that are mapped count
 * against the burst cap (notes played on a keyboard do not use up a pedal's budget).
 */
import { MIDI_CC_PRESS_THRESHOLD, midiInputKey, type MidiInput } from './mapping'
import type { MidiMessage } from './message'

/** The same input is ignored for this long after it fires (switch bounce, double sends). */
export const MIDI_DEBOUNCE_MS = 150
/** At most this many actions fire within MIDI_BURST_WINDOW_MS; the rest are dropped, never queued. */
export const MIDI_BURST_LIMIT = 8
export const MIDI_BURST_WINDOW_MS = 1000
/** Input from a port is ignored for this long after it connects (power-up bursts). */
export const MIDI_SETTLE_MS = 500

export interface MidiLimitOptions {
  /** Monotonic clock in milliseconds. Tests pass a fake clock. */
  now?: () => number
  debounceMs?: number
  burstLimit?: number
  burstWindowMs?: number
  settleMs?: number
}

export interface MidiLimits {
  /** A port was attached: start its settle time with a clean press state. */
  portConnected(portId: string): void
  /** A port went away: forget its settle time and press state. */
  portDisconnected(portId: string): void
  /** True while input from this port is still ignored after it connected. */
  settling(portId: string): boolean
  /** Press detection. Note Off, a Control Change below 64 and a held control return null. */
  press(portId: string, message: MidiMessage): MidiInput | null
  /** Debounce and burst cap for a mapped press. True means fire now; the fire is recorded. */
  allow(input: MidiInput): boolean
  /** MIDI off, or the device or channel choice changed: forget all press, debounce and burst state. */
  reset(): void
}

export function createMidiLimits(options: MidiLimitOptions = {}): MidiLimits {
  const now = options.now ?? (() => performance.now())
  const debounceMs = options.debounceMs ?? MIDI_DEBOUNCE_MS
  const burstLimit = options.burstLimit ?? MIDI_BURST_LIMIT
  const burstWindowMs = options.burstWindowMs ?? MIDI_BURST_WINDOW_MS
  const settleMs = options.settleMs ?? MIDI_SETTLE_MS

  /** Port id → time its settle window ends. */
  const settleUntil = new Map<string, number>()
  /** Port id → controls currently at 64 or more ("channel:number"). They fire again only after dropping below 64. */
  const heldControls = new Map<string, Set<string>>()
  /** Input key → time it last fired. */
  const lastFired = new Map<string, number>()
  /** Fire times inside the burst window, oldest first. */
  const recentFires: number[] = []

  const heldFor = (portId: string) => {
    let held = heldControls.get(portId)
    if (!held) heldControls.set(portId, held = new Set())
    return held
  }

  const settling = (portId: string) => now() < (settleUntil.get(portId) ?? -Infinity)

  return {
    portConnected(portId) {
      settleUntil.set(portId, now() + settleMs)
      heldControls.delete(portId)
    },

    portDisconnected(portId) {
      settleUntil.delete(portId)
      heldControls.delete(portId)
    },

    settling,

    press(portId, message) {
      if (message.type === 'cc') {
        // The control's position is followed even while settling, so a pedal that reports
        // "down" at power-up does not fire on its next message; it must come back up first.
        const held = heldFor(portId)
        const control = `${message.channel}:${message.number}`
        if (message.value < MIDI_CC_PRESS_THRESHOLD) { held.delete(control); return null }
        if (held.has(control)) return null
        held.add(control)
        return settling(portId) ? null : { type: 'cc', channel: message.channel, number: message.number }
      }
      if (settling(portId)) return null
      if (message.type === 'noteOn') return { type: 'note', channel: message.channel, number: message.number }
      if (message.type === 'pc') return { type: 'pc', channel: message.channel, number: message.number }
      return null
    },

    allow(input) {
      const at = now()
      const key = midiInputKey(input)
      const last = lastFired.get(key)
      if (last !== undefined && at - last < debounceMs) return false
      while (recentFires.length > 0 && at - recentFires[0] >= burstWindowMs) recentFires.shift()
      if (recentFires.length >= burstLimit) return false
      recentFires.push(at)
      lastFired.set(key, at)
      return true
    },

    reset() {
      settleUntil.clear()
      heldControls.clear()
      lastFired.clear()
      recentFires.length = 0
    },
  }
}
