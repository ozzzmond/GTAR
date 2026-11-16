/**
 * MIDI engine (#536 Slice 3): one MIDIAccess, one statechange handler, one map of listened
 * ports. Loaded with import() only while MIDI is ON (see ./loader). Access is requested without
 * SysEx and nothing is ever sent to a device.
 *
 * This slice only connects. A received message goes to the optional onMessage sink, which
 * nothing provides yet, so MIDI cannot move Stage.
 */
import { MIDI_DEVICE_TEXT_MAX } from './settings'
import type { MidiSnapshot, MidiStartMode, MidiState } from './loader'

export interface MidiEngineOptions {
  /** Called with every new status. */
  onChange(snapshot: MidiSnapshot): void
  /** Bytes of one message from a listened port. Not wired in this slice. */
  onMessage?: (portId: string, data: Uint8Array) => void
  /** Defaults to the browser's navigator. Tests pass a fake. */
  navigator?: Pick<Navigator, 'requestMIDIAccess' | 'permissions'>
}

export interface MidiEngine {
  /** Starts, or starts again from scratch. Never leaves a second listener on a port. */
  start(mode: MidiStartMode): void
  /** Clears every listener, closes the ports and drops the access object. */
  stop(): void
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

  /** Listens to every connected input once and forgets the ones that went away. */
  const refresh = (run: number) => {
    if (run !== generation || !access) return
    const present = new Map<string, MIDIInput>()
    access.inputs.forEach(port => { if (port.state !== 'disconnected') present.set(port.id, port) })
    for (const [id, port] of [...listened]) {
      if (present.get(id) === port) continue
      release(port, false)
      listened.delete(id)
    }
    for (const [id, port] of present) {
      if (listened.has(id)) continue
      // A property, not addEventListener: one port can never hold two GTAR listeners.
      port.onmidimessage = guard(run, (event: MIDIMessageEvent) => { if (event.data) options.onMessage?.(id, event.data) })
      listened.set(id, port)
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
      set('starting')
      void open(run, mode)
    },
    stop() {
      generation++
      detach()
      set('off')
    },
    getSnapshot: () => snapshot,
  }
}
