/**
 * MIDI engine (#536): one MIDIAccess, one statechange handler, one map of listened ports.
 * Loaded with import() only while MIDI is ON (see ./loader). Access is requested without SysEx
 * and nothing is ever sent to a device.
 *
 * A received message is parsed, then either captured by Learn or, when it is a new press of a
 * mapped input inside the limits, sent to Stage through stageCommands.run() with one of the
 * nine action ids. Nothing else in the app is reached from here.
 */
import { stageCommands } from '../utils/stageCommands'
import { createMidiLimits } from './limits'
import { findMidiAction, learnableMidiInput, type MidiInput, type MidiMappings } from './mapping'
import { parseMidiMessage } from './message'
import { MIDI_DEVICE_TEXT_MAX, readMidiSettings, subscribeMidiSettings } from './settings'
import type { MidiSnapshot, MidiStartMode, MidiState } from './loader'

export interface MidiEngineOptions {
  /** Called with every new status. */
  onChange(snapshot: MidiSnapshot): void
  /** Defaults to the browser's navigator. Tests pass a fake. */
  navigator?: Pick<Navigator, 'requestMIDIAccess' | 'permissions'>
  /** Monotonic clock in milliseconds for the press limits. Tests pass a fake clock. */
  now?: () => number
}

export interface MidiEngine {
  /** Starts, or starts again from scratch. Never leaves a second listener on a port. */
  start(mode: MidiStartMode): void
  /** Clears every listener, closes the ports and drops the access object. */
  stop(): void
  /**
   * Learn: the next input that counts goes to `listener`, once, and never to Stage. While a
   * listener waits no action fires. Returns the cancel; stopping or restarting cancels too.
   */
  learn(listener: (input: MidiInput) => void): () => void
  getSnapshot(): MidiSnapshot
}

/** Shown as plain text only; never parsed, never used as HTML. */
function deviceName(port: MIDIInput): string {
  const name = typeof port.name === 'string' ? port.name.trim().slice(0, MIDI_DEVICE_TEXT_MAX) : ''
  return name || 'MIDI device'
}

const isDenied = (error: unknown) => {
  const name = (error as { name?: unknown } | null)?.name
  return name === 'NotAllowedError' || name === 'SecurityError'
}

export function createMidiEngine(options: MidiEngineOptions): MidiEngine {
  /** Read at each start, so nothing is touched before MIDI is switched on. */
  const browser = () => options.navigator ?? globalThis.navigator
  /** Counts every start, stop and failure; a callback or answer from an earlier run is ignored. */
  let generation = 0
  let access: MIDIAccess | null = null
  const listened = new Map<string, MIDIInput>()
  let snapshot: MidiSnapshot = { state: 'off', devices: [] }
  const limits = createMidiLimits({ now: options.now })
  /** The saved mappings, read at start and after every settings change; never per message. */
  let mappings: MidiMappings = {}
  let unsubscribe: (() => void) | null = null
  let learner: ((input: MidiInput) => void) | null = null

  const set = (state: MidiState, devices: string[] = []) => {
    if (state === snapshot.state && devices.length === snapshot.devices.length && devices.every((name, index) => name === snapshot.devices[index])) return
    snapshot = { state, devices }
    try { options.onChange(snapshot) } catch { /* A failing subscriber must not break the engine. */ }
  }

  const release = (port: MIDIInput, close: boolean) => {
    try { port.onmidimessage = null } catch { /* Best effort: the port may already be gone. */ }
    if (!close) return
    try { void port.close().catch(() => undefined) } catch { /* Best effort: the port may already be gone. */ }
  }

  const detach = () => {
    for (const port of listened.values()) release(port, true)
    listened.clear()
    learner = null
    limits.reset()
    unsubscribe?.()
    unsubscribe = null
    if (access) {
      try { access.onstatechange = null } catch { /* Best effort: the access object is dropped next. */ }
    }
    access = null
  }

  const fail = () => {
    generation++
    detach()
    set('error')
  }

  /** Every browser callback runs through this: a stale run does nothing, an error sets Error and detaches. */
  const guard = <Args extends unknown[]>(run: number, callback: (...args: Args) => void) => (...args: Args) => {
    if (run !== generation) return
    try { callback(...args) } catch { fail() }
  }

  /** One parsed message: Learn takes it, or a new press of a mapped input moves Stage once. */
  const receive = (portId: string, data: unknown) => {
    const message = parseMidiMessage(data)
    if (!message) return
    // Followed in every mode, so a pedal held down through Learn fires nothing afterwards.
    const pressed = limits.press(portId, message)
    if (learner) {
      const input = limits.settling(portId) ? null : learnableMidiInput(message)
      if (!input) return
      const capture = learner
      learner = null
      capture(input)
      return
    }
    if (!pressed) return
    // findMidiAction can only return one of the nine action ids; stageCommands checks it again.
    const action = findMidiAction(mappings, pressed)
    if (action && limits.allow(pressed)) stageCommands.run(action)
  }

  /** Listens to every connected input once and forgets the ones that went away. */
  const refresh = (run: number) => {
    if (run !== generation || !access) return
    const present = new Map<string, MIDIInput>()
    access.inputs.forEach(port => { if (port.state !== 'disconnected') present.set(port.id, port) })
    for (const [id, port] of [...listened]) {
      if (present.get(id) === port) continue
      release(port, false)
      listened.delete(id)
      limits.portDisconnected(id)
    }
    for (const [id, port] of present) {
      if (listened.has(id)) continue
      // A property, not addEventListener: one port can never hold two GTAR listeners.
      port.onmidimessage = guard(run, (event: MIDIMessageEvent) => receive(id, event.data))
      listened.set(id, port)
      // Starts the settle time: a power-up burst from this port is ignored.
      limits.portConnected(id)
    }
    set(listened.size > 0 ? 'connected' : 'no-device', [...listened.values()].map(deviceName))
  }

  const permissionState = async (): Promise<string> => {
    try {
      return (await browser().permissions.query({ name: 'midi' })).state
    } catch {
      // Unknown: never ask at start, wait for a tap.
      return 'prompt'
    }
  }

  const open = async (run: number, mode: MidiStartMode): Promise<void> => {
    try {
      if (mode === 'quiet') {
        const permission = await permissionState()
        if (run !== generation) return
        if (permission !== 'granted') { set(permission === 'denied' ? 'blocked' : 'allow'); return }
      }
      let granted: MIDIAccess
      try {
        // No options: SysEx is never requested.
        granted = await browser().requestMIDIAccess()
      } catch (error) {
        if (run === generation) set(isDenied(error) ? 'blocked' : 'error')
        return
      }
      // A late answer after OFF or a restart: nothing was attached, nothing to undo.
      if (run !== generation) return
      access = granted
      access.onstatechange = guard(run, () => refresh(run))
      refresh(run)
    } catch {
      if (run === generation) fail()
    }
  }

  return {
    start(mode) {
      const run = ++generation
      detach()
      const load = () => { mappings = readMidiSettings().mappings }
      load()
      unsubscribe = subscribeMidiSettings(load)
      set('starting')
      void open(run, mode)
    },
    stop() {
      generation++
      detach()
      mappings = {}
      set('off')
    },
    learn(listener) {
      learner = listener
      return () => { if (learner === listener) learner = null }
    },
    getSnapshot: () => snapshot,
  }
}
