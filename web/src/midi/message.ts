/**
 * MIDI bytes → one small message, or null (#536). Only note on/off, Control Change 0–119 and
 * Program Change are read. Clock, active sensing, pitch bend, aftertouch, SysEx, channel-mode
 * messages (CC 120–127) and anything malformed are dropped here and never reach Learn or Stage.
 */
export type MidiMessageType = 'noteOn' | 'noteOff' | 'cc' | 'pc'

export interface MidiMessage {
  type: MidiMessageType
  /** 1–16. */
  channel: number
  /** Note, controller (0–119) or program number, 0–127. */
  number: number
  /** Velocity or controller value, 0–127. Always 0 for a Program Change. */
  value: number
}

/** Highest Control Change number that is a real controller; 120–127 are channel-mode messages. */
export const MIDI_MAX_CC_NUMBER = 119

const isByte = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255

/** Accepts the `data` of a `midimessage` event (one complete message per event). */
export function parseMidiMessage(data: unknown): MidiMessage | null {
  if (!(data instanceof Uint8Array) && !Array.isArray(data)) return null
  const bytes = data as ArrayLike<unknown>
  if (bytes.length !== 2 && bytes.length !== 3) return null
  const status = bytes[0]
  if (!isByte(status) || status < 0x80) return null
  for (let index = 1; index < bytes.length; index++) {
    const byte = bytes[index]
    if (!isByte(byte) || byte > 0x7f) return null
  }
  const channel = (status & 0x0f) + 1
  const number = bytes[1] as number
  const value = bytes[2] as number
  switch (status & 0xf0) {
    case 0x80:
      return bytes.length === 3 ? { type: 'noteOff', channel, number, value } : null
    case 0x90:
      if (bytes.length !== 3) return null
      // A Note On with velocity 0 is a Note Off.
      return { type: value === 0 ? 'noteOff' : 'noteOn', channel, number, value }
    case 0xb0:
      return bytes.length === 3 && number <= MIDI_MAX_CC_NUMBER ? { type: 'cc', channel, number, value } : null
    case 0xc0:
      return bytes.length === 2 ? { type: 'pc', channel, number, value: 0 } : null
    default:
      // Aftertouch, channel pressure, pitch bend and every system message (0xF0–0xFF).
      return null
  }
}

/** Channel filter: 'all', or one channel 1–16 that drops every other channel. */
export function midiChannelAllows(filter: 'all' | number, message: Pick<MidiMessage, 'channel'>): boolean {
  return filter === 'all' || filter === message.channel
}
