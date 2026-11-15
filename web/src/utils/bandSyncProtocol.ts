import { CAST2_LIMITS, validateReceiverSnapshot } from './stageCast2Protocol'
import type { ReceiverSnapshot } from './stageCast2Protocol'

export const BAND_SYNC_VERSION = 1 as const
export const BAND_SYNC_LIMITS = Object.freeze({ stateBytes: 4096, bytes: CAST2_LIMITS.bytes + 4096,
  followers: 12, ticketMs: 15_000, idleMs: 1_800_000, lifetimeMs: 21_600_000,
  attempts: 5, messagesPerSecond: 30, stateIntervalMs: 250, heartbeatMs: 45_000,
  rooms: 32, createsPerMinute: 5, directoryBuckets: 512, tickets: 32 })
export type BandSyncDirection = 'LEADER_TO_SERVER' | 'FOLLOWER_TO_SERVER' | 'SERVER_TO_CLIENT'
export interface BandSyncState {
  songId: string | number | null; contentHash: string; displayTitle: string
  transposeOffset: number; effectiveKey: string; chordsVisible: boolean
  setlist: { id: string | null; index: number; count: number }
  lineIndex: number; scrollFraction: number; autoscroll: { on: boolean; speed: number }
  notation: 'chords' | 'numbers'
}
export type BandSyncError = 'UNKNOWN_PROTOCOL_VERSION' | 'UNKNOWN_MESSAGE_TYPE' | 'INVALID_DIRECTION' |
  'MALFORMED_PAYLOAD' | 'OVERSIZED_PAYLOAD' | 'INVALID_SEQUENCE' | 'ROOM_MISMATCH' |
  'STALE_OR_OUT_OF_ORDER_UPDATE' | 'RESYNC_REQUIRED' | 'SESSION_REVOKED'
export type BandSyncContent = { contentHash: string; snapshot: ReceiverSnapshot }
type Payloads = {
  HELLO: { role: 'leader' | 'follower' }
  SNAPSHOT: { state: BandSyncState | null; content: BandSyncContent | null; leaderOnline: boolean }
  STATE: { state: BandSyncState }
  CONTENT: BandSyncContent
  NEED_CONTENT: { contentHash: string }
  BYE: Record<string, never>
  SESSION_ENDED: { reason: 'LEADER_ENDED' | 'EXPIRED' | 'LOCKED' }
  ERROR: { code: BandSyncError }
}
export type BandSyncType = keyof Payloads
export type BandSyncMessage = { [K in BandSyncType]: {
  version: typeof BAND_SYNC_VERSION; type: K; direction: BandSyncDirection
  roomCode: string; sequence: number; timestamp: number; payload: Payloads[K]
} }[BandSyncType]
export type BandSyncResult<T> = { ok: true; value: T } | { ok: false; error: BandSyncError }
type Check = (v: unknown) => boolean
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: unknown, fields: Record<string, Check>): boolean => obj(v) &&
  Object.keys(v).length === Object.keys(fields).length && Object.entries(fields).every(([k, c]) => Object.hasOwn(v, k) && c(v[k]))
const text = (max: number, min = 0): Check => v => typeof v === 'string' && v.length >= min && v.length <= max
const integer = (min: number, max = Number.MAX_SAFE_INTEGER): Check => v => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max
const number = (max: number): Check => v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
const oneOf = (...items: unknown[]): Check => v => items.includes(v)
const bool: Check = v => typeof v === 'boolean'
export const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' // 32 symbols; no 0, 1, I, O.
export const isRoomCode = (v: unknown): v is string => typeof v === 'string' && v.length === 8 && [...v].every(c => ROOM_ALPHABET.includes(c))
const hash: Check = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const state: Check = v => exact(v, {
  songId: s => s === null || text(CAST2_LIMITS.id, 1)(s) || integer(0)(s), contentHash: hash,
  displayTitle: text(CAST2_LIMITS.title, 1), transposeOffset: integer(-11, 11), effectiveKey: text(32), chordsVisible: bool,
  setlist: s => exact(s, { id: i => i === null || text(CAST2_LIMITS.id, 1)(i), index: integer(0), count: integer(0) }) &&
    Number((s as BandSyncState['setlist']).index) < Math.max(1, Number((s as BandSyncState['setlist']).count)),
  lineIndex: integer(0, CAST2_LIMITS.lines - 1), scrollFraction: number(1),
  autoscroll: a => exact(a, { on: bool, speed: number(1000) }), notation: oneOf('chords', 'numbers'),
})
const content: Check = v => exact(v, { contentHash: hash, snapshot: s => validateReceiverSnapshot(s).ok })
const errors: BandSyncError[] = ['UNKNOWN_PROTOCOL_VERSION', 'UNKNOWN_MESSAGE_TYPE', 'INVALID_DIRECTION', 'MALFORMED_PAYLOAD',
  'OVERSIZED_PAYLOAD', 'INVALID_SEQUENCE', 'ROOM_MISMATCH', 'STALE_OR_OUT_OF_ORDER_UPDATE', 'RESYNC_REQUIRED', 'SESSION_REVOKED']
const rules: Record<BandSyncType, { directions: BandSyncDirection[]; check: Check }> = {
  HELLO: { directions: ['LEADER_TO_SERVER', 'FOLLOWER_TO_SERVER'], check: v => exact(v, { role: oneOf('leader', 'follower') }) },
  SNAPSHOT: { directions: ['SERVER_TO_CLIENT'], check: v => exact(v, { state: s => s === null || state(s), content: c => c === null || content(c), leaderOnline: bool }) &&
    (!(v as Payloads['SNAPSHOT']).content || (v as Payloads['SNAPSHOT']).content?.contentHash === (v as Payloads['SNAPSHOT']).state?.contentHash) },
  STATE: { directions: ['LEADER_TO_SERVER', 'SERVER_TO_CLIENT'], check: v => exact(v, { state }) },
  CONTENT: { directions: ['LEADER_TO_SERVER', 'SERVER_TO_CLIENT'], check: content },
  NEED_CONTENT: { directions: ['FOLLOWER_TO_SERVER', 'SERVER_TO_CLIENT'], check: v => exact(v, { contentHash: hash }) },
  BYE: { directions: ['LEADER_TO_SERVER', 'FOLLOWER_TO_SERVER'], check: v => exact(v, {}) },
  SESSION_ENDED: { directions: ['SERVER_TO_CLIENT'], check: v => exact(v, { reason: oneOf('LEADER_ENDED', 'EXPIRED', 'LOCKED') }) },
  ERROR: { directions: ['SERVER_TO_CLIENT'], check: v => exact(v, { code: oneOf(...errors) }) },
}

/** Detached JSON only; bounded traversal rejects accessors/cycles before serialization. Text is never HTML. */
export function validateBandSyncMessage(input: unknown, direction: BandSyncDirection): BandSyncResult<BandSyncMessage> {
  const fail = (error: BandSyncError): BandSyncResult<never> => ({ ok: false, error })
  let nodes = 0, chars = 0
  const seen = new Set<object>()
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 40000 || depth > 16) throw 'OVERSIZED_PAYLOAD'
    if (typeof v === 'string') { chars += v.length; if (chars > BAND_SYNC_LIMITS.bytes) throw 'OVERSIZED_PAYLOAD'; return }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return
    if (typeof v !== 'object' || seen.has(v)) throw 'MALFORMED_PAYLOAD'
    if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(v))) throw 'MALFORMED_PAYLOAD'
    if (Array.isArray(v) && v.length > 40000) throw 'OVERSIZED_PAYLOAD'
    if (Array.isArray(v) && Object.keys(v).length !== v.length) throw 'MALFORMED_PAYLOAD'
    seen.add(v)
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue
      if (typeof key !== 'string') throw 'MALFORMED_PAYLOAD'
      const d = Object.getOwnPropertyDescriptor(v, key)!
      if (!d.enumerable || !('value' in d)) throw 'MALFORMED_PAYLOAD'
      chars += key.length
      if (chars > BAND_SYNC_LIMITS.bytes) throw 'OVERSIZED_PAYLOAD'
      visit(d.value, depth + 1)
    }
    seen.delete(v)
  }
  try {
    if (typeof input === 'string') {
      if (new TextEncoder().encode(input).length > BAND_SYNC_LIMITS.bytes) return fail('OVERSIZED_PAYLOAD')
      input = JSON.parse(input)
    }
    visit(input, 0)
    const json = JSON.stringify(input)
    if (new TextEncoder().encode(json).length > BAND_SYNC_LIMITS.bytes) return fail('OVERSIZED_PAYLOAD')
    const m = JSON.parse(json)
    if (!obj(m)) return fail('MALFORMED_PAYLOAD')
    if (m.version !== BAND_SYNC_VERSION) return fail('UNKNOWN_PROTOCOL_VERSION')
    if (typeof m.type !== 'string' || !Object.hasOwn(rules, m.type)) return fail('UNKNOWN_MESSAGE_TYPE')
    if (m.type === 'STATE' && new TextEncoder().encode(json).length > BAND_SYNC_LIMITS.stateBytes) return fail('OVERSIZED_PAYLOAD')
    const rule = rules[m.type as BandSyncType]
    if (m.direction !== direction || !rule.directions.includes(direction)) return fail('INVALID_DIRECTION')
    if (!integer(1)(m.sequence)) return fail('INVALID_SEQUENCE')
    if (!exact(m, { version: oneOf(1), type: text(32), direction: text(32), roomCode: isRoomCode,
      sequence: integer(1), timestamp: integer(0), payload: rule.check })) return fail('MALFORMED_PAYLOAD')
    return { ok: true, value: m as BandSyncMessage }
  } catch (e) { return fail(e === 'OVERSIZED_PAYLOAD' ? e : 'MALFORMED_PAYLOAD') }
}
