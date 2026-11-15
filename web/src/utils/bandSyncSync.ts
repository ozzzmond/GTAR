import { validateBandSyncMessage } from './bandSyncProtocol'
import type { BandSyncState, BandSyncContent, BandSyncError } from './bandSyncProtocol'

export interface BandSyncFollower {
  roomCode: string; sequence: number; state: BandSyncState | null; content: BandSyncContent | null
  leaderOnline: boolean; awaitingSnapshot: boolean; revoked: boolean
}
export const initialBandSyncState = (roomCode: string): BandSyncFollower => ({ roomCode, sequence: 0,
  state: null, content: null, leaderOnline: false, awaitingSnapshot: true, revoked: false })
export const reconnectBandSync = (s: BandSyncFollower): BandSyncFollower => ({ ...s, awaitingSnapshot: true })
export function applyBandSyncMessage(s: BandSyncFollower, input: unknown): { state: BandSyncFollower; error: BandSyncError | null } {
  const fail = (error: BandSyncError, state = s) => ({ state, error })
  const checked = validateBandSyncMessage(input, 'SERVER_TO_CLIENT')
  if (!checked.ok) return fail(checked.error)
  const m = checked.value
  if (m.roomCode !== s.roomCode) return fail('ROOM_MISMATCH')
  if (s.revoked) return fail('SESSION_REVOKED')
  if (m.sequence < s.sequence || (m.sequence === s.sequence && !(m.type === 'SNAPSHOT' && s.awaitingSnapshot))) return fail('STALE_OR_OUT_OF_ORDER_UPDATE')
  if (m.type === 'SESSION_ENDED') return { state: { ...initialBandSyncState(s.roomCode), sequence: m.sequence, revoked: true }, error: null }
  if (m.type === 'SNAPSHOT') return { state: { ...s, ...m.payload, sequence: m.sequence, awaitingSnapshot: false }, error: null }
  if (s.awaitingSnapshot) return fail('RESYNC_REQUIRED')
  if (m.sequence !== s.sequence + 1) return fail('RESYNC_REQUIRED', reconnectBandSync(s))
  if (m.type === 'STATE') return { state: { ...s, state: m.payload.state, sequence: m.sequence,
    content: s.content?.contentHash === m.payload.state.contentHash ? s.content : null }, error: null }
  if (m.type === 'CONTENT' && m.payload.contentHash === s.state?.contentHash) return { state: { ...s, content: m.payload, sequence: m.sequence }, error: null }
  return fail('RESYNC_REQUIRED', reconnectBandSync(s))
}
