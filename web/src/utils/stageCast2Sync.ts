import { cast2Failure, validateCast2Message } from './stageCast2Protocol'
import type { Cast2Error, ReceiverSnapshot, Result } from './stageCast2Protocol'

export interface Cast2SyncState {
  readonly sessionId: string
  readonly sequence: number
  readonly snapshot: ReceiverSnapshot | null
  readonly awaitingSnapshot: boolean
  readonly revoked: boolean
}
/** Session identity is supplied by the future server boundary, never created or authorized here. */
export function initialCast2SyncState(sessionId: string): Cast2SyncState {
  return { sessionId, sequence: 0, snapshot: null, awaitingSnapshot: true, revoked: false }
}
export function reconnectCast2(state: Cast2SyncState): Cast2SyncState {
  return { ...state, awaitingSnapshot: true }
}
export interface Cast2SyncResult {
  state: Cast2SyncState
  error: Cast2Error | null
}
/** Pure receiver reducer. Only a fresh full snapshot can recover initial/reconnect/gap state. */
export function applyCast2Message(state: Cast2SyncState, input: unknown): Cast2SyncResult {
  const checked = validateCast2Message(input, 'SERVER_TO_RECEIVER')
  const fail = (error: Cast2Error, next = state): Cast2SyncResult => ({ state: next, error })
  if (!checked.ok) return fail(checked.error)
  const m = checked.value
  if (m.sessionId !== state.sessionId) return fail('SESSION_MISMATCH')
  if (state.revoked) return fail('SESSION_REVOKED')
  if (m.type !== 'PRESENTATION_SNAPSHOT' && m.type !== 'PRESENTATION_UPDATE' && m.type !== 'SESSION_REVOKED') return fail('MALFORMED_PAYLOAD')
  if (m.sequence <= state.sequence) return fail('STALE_OR_OUT_OF_ORDER_UPDATE')
  if (m.type === 'SESSION_REVOKED') return { state: { ...state, sequence: m.sequence, snapshot: null, awaitingSnapshot: true, revoked: true }, error: null }
  if (m.type === 'PRESENTATION_UPDATE') {
    if (state.awaitingSnapshot) return fail('RESYNC_REQUIRED')
    if (m.payload.baseSequence !== state.sequence || m.sequence !== state.sequence + 1) return fail('STALE_OR_OUT_OF_ORDER_UPDATE', reconnectCast2(state))
  }
  return { state: { ...state, sequence: m.sequence, snapshot: m.payload.snapshot, awaitingSnapshot: false }, error: null }
}

/** Useful when constructing an offline update fixture; still validates at application boundary. */
export function nextCast2Sequence(sequence: number): Result<number> {
  return Number.isSafeInteger(sequence) && sequence >= 0 && sequence < Number.MAX_SAFE_INTEGER
    ? { ok: true, value: sequence + 1 } : cast2Failure('INVALID_SEQUENCE')
}
