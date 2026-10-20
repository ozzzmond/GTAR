import type { SongLine } from '../types/gtar'

/** Offline wire contract only. Validation is NOT authentication or pairing approval. */
export const CAST2_VERSION = 1 as const
export const CAST2_LIMITS = Object.freeze({ bytes: 262144, rawContent: 131072, lines: 2048, text: 8192, title: 256, id: 128 })
export type Cast2Direction = 'CONTROLLER_TO_SERVER' | 'RECEIVER_TO_SERVER' | 'SERVER_TO_CONTROLLER' | 'SERVER_TO_RECEIVER'
export interface ReceiverSnapshot {
  songId: string | number | null
  displayTitle: string
  /** Already transposed by the existing parser; render directly, never transpose again. */
  lines: SongLine[]
  chordsVisible: boolean
  transpose: { offset: number; effectiveKey: string }
  position: { lineIndex: number }
  scroll: { top: number; fraction: number }
  mode: { columns: 1 | 2; notation: 'chords' | 'numbers'; fontSize?: number }
}
type RejectionReason = 'DECLINED' | 'EXPIRED' | 'UNAVAILABLE'
type RevocationReason = 'CONTROLLER_ENDED' | 'EXPIRED' | 'REPLACED'
export type Cast2Error = 'UNKNOWN_PROTOCOL_VERSION' | 'UNKNOWN_MESSAGE_TYPE' | 'INVALID_DIRECTION' | 'MALFORMED_PAYLOAD' | 'OVERSIZED_PAYLOAD' | 'INVALID_SEQUENCE' | 'STALE_OR_OUT_OF_ORDER_UPDATE' | 'INVALID_PRESENTATION_STATE' | 'SESSION_MISMATCH' | 'RESYNC_REQUIRED' | 'SESSION_REVOKED'
type Payloads = {
  PAIRING_REQUEST: { requestId: string }
  PAIRING_APPROVAL: { requestId: string }
  PAIRING_REJECTION: { requestId: string; reason: RejectionReason }
  PAIRING_EXPIRY: { requestId: string }
  SESSION_ESTABLISHED: { controllerId: string; receiverId: string }
  SESSION_REVOKED: { reason: RevocationReason }
  PRESENTATION_SNAPSHOT: { snapshot: ReceiverSnapshot }
  /** Atomic replacement, not a partial patch. baseSequence is the last applied presentation sequence. */
  PRESENTATION_UPDATE: { baseSequence: number; snapshot: ReceiverSnapshot }
  SYNC_ACK: { appliedSequence: number }
  SYNC_ERROR: { code: Cast2Error }
}
type ServerOutbound = 'SERVER_TO_CONTROLLER' | 'SERVER_TO_RECEIVER'
type Directions = {
  PAIRING_REQUEST: 'RECEIVER_TO_SERVER'
  PAIRING_APPROVAL: 'CONTROLLER_TO_SERVER'
  PAIRING_REJECTION: 'CONTROLLER_TO_SERVER' | ServerOutbound
  PAIRING_EXPIRY: ServerOutbound
  SESSION_ESTABLISHED: ServerOutbound
  SESSION_REVOKED: ServerOutbound
  PRESENTATION_SNAPSHOT: 'CONTROLLER_TO_SERVER' | 'SERVER_TO_RECEIVER'
  PRESENTATION_UPDATE: 'CONTROLLER_TO_SERVER' | 'SERVER_TO_RECEIVER'
  SYNC_ACK: 'RECEIVER_TO_SERVER'
  SYNC_ERROR: 'RECEIVER_TO_SERVER' | ServerOutbound
}
export type Cast2Type = keyof Payloads
export type Cast2Message = { [K in Cast2Type]: {
  version: typeof CAST2_VERSION; type: K; direction: Directions[K]
  sessionId: string; timestamp: number; sequence: number; payload: Payloads[K]
} }[Cast2Type]
export type Cast2RoleMessage<D extends Cast2Direction> = {
  [K in Cast2Type]: D extends Directions[K] ? Omit<Extract<Cast2Message, { type: K }>, 'direction'> & { direction: D } : never
}[Cast2Type]
export type ReceiverMessage = Cast2RoleMessage<'RECEIVER_TO_SERVER'>
export type ControllerMessage = Cast2RoleMessage<'CONTROLLER_TO_SERVER'>
export type ServerMessage = Cast2RoleMessage<'SERVER_TO_CONTROLLER'> | Cast2RoleMessage<'SERVER_TO_RECEIVER'>
export type Result<T> = { ok: true; value: T } | { ok: false; error: Cast2Error }
export const cast2Failure = (error: Cast2Error): Result<never> => ({ ok: false, error })

type Check = (value: unknown) => boolean
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const exact = (v: unknown, fields: Record<string, Check>): boolean => obj(v) &&
  Object.keys(v).length === Object.keys(fields).length && Object.entries(fields).every(([k, check]) => Object.hasOwn(v, k) && check(v[k]))
const text = (max: number, min = 0): Check => v => typeof v === 'string' && v.length >= min && v.length <= max
const integer = (min: number, max = Number.MAX_SAFE_INTEGER): Check => v => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max
const number = (max: number): Check => v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
const oneOf = (...values: unknown[]): Check => v => values.includes(v)
const boolean: Check = v => typeof v === 'boolean'
const id = text(CAST2_LIMITS.id, 1)
const string = text(CAST2_LIMITS.text)
const list = (check: Check, max: number): Check => v => Array.isArray(v) && v.length <= max && v.every(check)
const errors: Cast2Error[] = ['UNKNOWN_PROTOCOL_VERSION', 'UNKNOWN_MESSAGE_TYPE', 'INVALID_DIRECTION', 'MALFORMED_PAYLOAD', 'OVERSIZED_PAYLOAD', 'INVALID_SEQUENCE', 'STALE_OR_OUT_OF_ORDER_UPDATE', 'INVALID_PRESENTATION_STATE', 'SESSION_MISMATCH', 'RESYNC_REQUIRED', 'SESSION_REVOKED']
const line: Check = v => {
  if (!obj(v)) return false
  switch (v.type) {
    case 'EMPTY': return exact(v, { type: oneOf('EMPTY') })
    case 'LYRIC': return exact(v, { type: oneOf('LYRIC'), lyrics: string })
    case 'SECTION_HEADER': return exact(v, { type: oneOf('SECTION_HEADER'), title: string })
    case 'TAB': return exact(v, { type: oneOf('TAB'), content: string })
    case 'CHORD_PRO': return exact(v, { type: oneOf('CHORD_PRO'), raw: string, segments: list(s => exact(s, { chord: c => c === null || string(c), text: string }), 1024) })
    case 'CHORD_ROW': return exact(v, { type: oneOf('CHORD_ROW'), raw: string, chords: list(string, 1024), ...(Object.hasOwn(v, 'isOverLyric') ? { isOverLyric: boolean } : {}) })
    default: return false
  }
}
const snapshotCheck: Check = v => {
  if (!obj(v)) return false
  const modeObj = (v as { mode?: unknown }).mode
  const modeRules: Record<string, Check> = {
    columns: oneOf(1, 2),
    notation: oneOf('chords', 'numbers'),
    ...(obj(modeObj) && Object.hasOwn(modeObj, 'fontSize') ? { fontSize: integer(16, 72) } : {}),
  }
  if (!exact(v, {
    songId: s => s === null || id(s) || integer(0)(s), displayTitle: text(CAST2_LIMITS.title, 1),
    lines: list(line, CAST2_LIMITS.lines), chordsVisible: boolean,
    transpose: t => exact(t, { offset: integer(-11, 11), effectiveKey: text(32) }),
    position: p => exact(p, { lineIndex: integer(0, CAST2_LIMITS.lines - 1) }),
    scroll: s => exact(s, { top: number(10000000), fraction: number(1) }),
    mode: m => exact(m, modeRules),
  })) return false
  const s = v as unknown as ReceiverSnapshot
  return s.position.lineIndex < Math.max(1, s.lines.length) && (s.chordsVisible ||
    s.lines.every(l => l.type !== 'CHORD_PRO' && l.type !== 'CHORD_ROW' && l.type !== 'TAB'))
}
const rules: { [K in Cast2Type]: { directions: Cast2Direction[]; payload: Check } } = {
  PAIRING_REQUEST: { directions: ['RECEIVER_TO_SERVER'], payload: p => exact(p, { requestId: id }) },
  PAIRING_APPROVAL: { directions: ['CONTROLLER_TO_SERVER'], payload: p => exact(p, { requestId: id }) },
  PAIRING_REJECTION: { directions: ['CONTROLLER_TO_SERVER', 'SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER'], payload: p => exact(p, { requestId: id, reason: oneOf('DECLINED', 'EXPIRED', 'UNAVAILABLE') }) },
  PAIRING_EXPIRY: { directions: ['SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER'], payload: p => exact(p, { requestId: id }) },
  SESSION_ESTABLISHED: { directions: ['SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER'], payload: p => exact(p, { controllerId: id, receiverId: id }) },
  SESSION_REVOKED: { directions: ['SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER'], payload: p => exact(p, { reason: oneOf('CONTROLLER_ENDED', 'EXPIRED', 'REPLACED') }) },
  PRESENTATION_SNAPSHOT: { directions: ['CONTROLLER_TO_SERVER', 'SERVER_TO_RECEIVER'], payload: p => exact(p, { snapshot: snapshotCheck }) },
  PRESENTATION_UPDATE: { directions: ['CONTROLLER_TO_SERVER', 'SERVER_TO_RECEIVER'], payload: p => exact(p, { baseSequence: integer(1), snapshot: snapshotCheck }) },
  SYNC_ACK: { directions: ['RECEIVER_TO_SERVER'], payload: p => exact(p, { appliedSequence: integer(1) }) },
  SYNC_ERROR: { directions: ['RECEIVER_TO_SERVER', 'SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER'], payload: p => exact(p, { code: oneOf(...errors) }) },
}

/** Bound traversal before serialization; reject cycles, accessors and non-JSON objects. */
function boundedJson(input: unknown): Result<unknown> {
  let nodes = 0
  let chars = 0
  const seen = new Set<object>()
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 40000 || depth > 16) throw 'OVERSIZED_PAYLOAD'
    if (typeof v === 'string') { chars += v.length; if (chars > CAST2_LIMITS.bytes) throw 'OVERSIZED_PAYLOAD'; return }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return
    if (typeof v !== 'object' || seen.has(v)) throw 'MALFORMED_PAYLOAD'
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== Array.prototype && Object.getPrototypeOf(v) !== null) throw 'MALFORMED_PAYLOAD'
    if (Array.isArray(v) && v.length > 40000) throw 'OVERSIZED_PAYLOAD'
    if (Array.isArray(v) && Object.keys(v).length !== v.length) throw 'MALFORMED_PAYLOAD'
    seen.add(v)
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue
      if (typeof key !== 'string') throw 'MALFORMED_PAYLOAD'
      const d = Object.getOwnPropertyDescriptor(v, key)!
      if (!d.enumerable || !('value' in d)) throw 'MALFORMED_PAYLOAD'
      chars += key.length
      if (chars > CAST2_LIMITS.bytes) throw 'OVERSIZED_PAYLOAD'
      visit(d.value, depth + 1)
    }
    seen.delete(v)
  }
  try {
    if (typeof input === 'string') {
      if (new TextEncoder().encode(input).length > CAST2_LIMITS.bytes) return cast2Failure('OVERSIZED_PAYLOAD')
      input = JSON.parse(input)
    }
    visit(input, 0)
    const json = JSON.stringify(input)
    if (new TextEncoder().encode(json).length > CAST2_LIMITS.bytes) return cast2Failure('OVERSIZED_PAYLOAD')
    return { ok: true, value: JSON.parse(json) }
  } catch (e) { return cast2Failure(e === 'OVERSIZED_PAYLOAD' ? e : 'MALFORMED_PAYLOAD') }
}

/** Returns a detached JSON value. Expected direction comes from the future transport boundary. */
export function validateCast2Message(input: unknown, expectedDirection: Cast2Direction): Result<Cast2Message> {
  const json = boundedJson(input)
  if (!json.ok) return json
  const m = json.value
  if (!obj(m)) return cast2Failure('MALFORMED_PAYLOAD')
  if (m.version !== CAST2_VERSION) return cast2Failure('UNKNOWN_PROTOCOL_VERSION')
  if (typeof m.type !== 'string' || !Object.hasOwn(rules, m.type)) return cast2Failure('UNKNOWN_MESSAGE_TYPE')
  const rule = rules[m.type as Cast2Type]
  if (m.direction !== expectedDirection || !rule.directions.includes(m.direction as Cast2Direction)) return cast2Failure('INVALID_DIRECTION')
  if (!integer(1)(m.sequence)) return cast2Failure('INVALID_SEQUENCE')
  if (!exact(m, { version: oneOf(CAST2_VERSION), type: text(32), direction: text(32), sessionId: id, timestamp: integer(0), sequence: integer(1), payload: () => true })) return cast2Failure('MALFORMED_PAYLOAD')
  if ((m.type === 'PRESENTATION_SNAPSHOT' || m.type === 'PRESENTATION_UPDATE') && obj(m.payload) && !snapshotCheck(m.payload.snapshot)) return cast2Failure('INVALID_PRESENTATION_STATE')
  if (!rule.payload(m.payload)) return cast2Failure('MALFORMED_PAYLOAD')
  if (m.type === 'PRESENTATION_UPDATE' && (m.payload as Payloads['PRESENTATION_UPDATE']).baseSequence >= (m.sequence as number)) return cast2Failure('INVALID_SEQUENCE')
  return { ok: true, value: m as Cast2Message }
}

export function validateReceiverSnapshot(input: unknown): Result<ReceiverSnapshot> {
  const json = boundedJson(input)
  if (!json.ok) return json
  return snapshotCheck(json.value) ? { ok: true, value: json.value as ReceiverSnapshot } : cast2Failure('INVALID_PRESENTATION_STATE')
}
