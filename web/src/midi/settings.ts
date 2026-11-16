/**
 * MIDI settings (#536): one versioned localStorage key, local to this browser profile. It is
 * not in backups and not in cloud sync (deliberately absent from SETTINGS_KEYS). Every field is
 * checked on every read; reading never writes, so an unreadable or newer value stays untouched
 * until the player changes something. Learn state and the input monitor are never stored.
 */
import { validateMidiMappings, type MidiMappings } from './mapping'

export const MIDI_SETTINGS_KEY = 'gtar_midi_v1'
export const MIDI_SETTINGS_CHANGED = 'gtar-midi-settings-changed'
export const MIDI_SETTINGS_VERSION = 1
/** Device names and ids are plain text and cut to this length. */
export const MIDI_DEVICE_TEXT_MAX = 128

export interface MidiDeviceChoice {
  id: string
  name: string
  manufacturer: string
}

export interface MidiSettingsV1 {
  version: 1
  /** Default false: no listener, no permission request, no function. */
  enabled: boolean
  device: 'all' | MidiDeviceChoice
  /** 'all', or one channel 1–16. */
  channel: 'all' | number
  mappings: MidiMappings
}

export type MidiSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

export function defaultMidiSettings(): MidiSettingsV1 {
  return { version: 1, enabled: false, device: 'all', channel: 'all', mappings: {} }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function normalizeDevice(value: unknown): 'all' | MidiDeviceChoice {
  if (!isRecord(value)) return 'all'
  const { id, name, manufacturer } = value
  // The id is how a device is remembered; without a usable one the choice falls back to all devices.
  if (typeof id !== 'string' || id.length === 0 || id.length > MIDI_DEVICE_TEXT_MAX) return 'all'
  const text = (field: unknown) => (typeof field === 'string' ? field.slice(0, MIDI_DEVICE_TEXT_MAX) : '')
  return { id, name: text(name), manufacturer: text(manufacturer) }
}

/**
 * Field-by-field check. Anything that is not a version 1 object means MIDI off with no
 * mappings; inside a version 1 object each bad field falls back to its default on its own.
 */
export function normalizeMidiSettings(raw: unknown): MidiSettingsV1 {
  if (!isRecord(raw) || raw.version !== MIDI_SETTINGS_VERSION) return defaultMidiSettings()
  const { enabled, device, channel, mappings } = raw
  return {
    version: 1,
    enabled: enabled === true,
    device: normalizeDevice(device),
    channel: typeof channel === 'number' && Number.isInteger(channel) && channel >= 1 && channel <= 16 ? channel : 'all',
    mappings: validateMidiMappings(mappings),
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** Never throws and never writes. Missing, unreadable or unknown data reads as the defaults. */
export function readMidiSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): MidiSettingsV1 {
  try {
    const text = storage?.getItem(MIDI_SETTINGS_KEY)
    return typeof text === 'string' ? normalizeMidiSettings(JSON.parse(text)) : defaultMidiSettings()
  } catch {
    return defaultMidiSettings()
  }
}

/**
 * Stores the checked form of `settings` and announces the change. Returns false when this
 * device could not save; nothing is announced then.
 */
export function writeMidiSettings(settings: MidiSettingsV1, storage: Pick<Storage, 'setItem'> | null = safeStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(MIDI_SETTINGS_KEY, JSON.stringify(normalizeMidiSettings(settings)))
  } catch {
    return false
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MIDI_SETTINGS_CHANGED))
  return true
}

/** Calls `listener` after a change in this tab or another tab. Returns the unsubscribe function. */
export function subscribeMidiSettings(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === MIDI_SETTINGS_KEY) listener() }
  window.addEventListener(MIDI_SETTINGS_CHANGED, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(MIDI_SETTINGS_CHANGED, listener)
    window.removeEventListener('storage', onStorage)
  }
}
