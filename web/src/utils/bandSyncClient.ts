import { BAND_SYNC_LIMITS, isRoomCode, validateBandSyncMessage } from './bandSyncProtocol'
import type { BandSyncContent, BandSyncMessage, BandSyncState } from './bandSyncProtocol'
import { applyBandSyncMessage, initialBandSyncState, reconnectBandSync } from './bandSyncSync'
import type { BandSyncFollower } from './bandSyncSync'

interface Socket {
  readyState: number; send(data: string): void; close(): void
  onopen: (() => void) | null; onclose: (() => void) | null; onerror: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
}
interface Runtime {
  fetch: typeof fetch; socket(url: string, protocols: string[]): Socket; origin: string; now(): number
  later(fn: () => void, ms: number): ReturnType<typeof setTimeout>
  cancel(timer: ReturnType<typeof setTimeout>): void
}
export interface BandSyncClientView {
  message?: string
  status: 'starting' | 'active' | 'offline' | 'error'; role: 'leader' | 'follower' | null
  roomCode: string; follower: BandSyncFollower | null; ended: boolean
}
/** Fixed text only: never retain or expose an error response body. */
export class BandSyncHttpError extends Error {
  readonly status: number
  readonly networkOrSignIn: boolean
  constructor(status: number, networkOrSignIn = false) { super('Room request failed'); this.status = status; this.networkOrSignIn = networkOrSignIn }
}
const networkMessage = 'Could not reach Band Sync (network or sign-in)'
function failureMessage(error: unknown, operation: 'create' | 'join' | 'ticket' | 'end'): string {
  if (!(error instanceof BandSyncHttpError)) return 'Band Sync error'
  const status = error.status
  if (error.networkOrSignIn || status === 0 || status === 401 || (status >= 300 && status < 400)) return networkMessage
  if (status === 403 && operation === 'create') return 'Rejected by server'
  if ([403, 404].includes(status) && ['join', 'ticket'].includes(operation)) return 'Room not found or ended'
  if (status === 429) return 'Too many attempts, wait a minute'
  if (status === 503) return 'Band Sync is unavailable'
  return 'Band Sync error'
}
/** Created only by an activated extension. Credentials/tickets stay in this instance, never in URLs or logs. */
export class BandSyncClient {
  private rt: Runtime
  private changed: (view: BandSyncClientView) => void
  private view: BandSyncClientView = { status: 'offline', role: null, roomCode: '', follower: null, ended: false }
  private credential = ''
  private socket: Socket | null = null
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private lifetime = new AbortController()
  private generation = 0
  private sequence = 0
  private backoff = 1000
  private current: { state: BandSyncState; content: BandSyncContent } | null = null
  private sentHash = ''
  private disposed = false
  private lastStateAt = -Infinity
  private stateTimer: ReturnType<typeof setTimeout> | null = null
  private forceContent = false
  constructor(changed: (view: BandSyncClientView) => void, runtime?: Runtime) {
    this.changed = changed
    this.rt = runtime ?? { fetch: (...args) => fetch(...args), socket: (url, protocols) => new WebSocket(url, protocols) as unknown as Socket,
      origin: location.origin, now: () => Date.now(), later: (fn, ms) => setTimeout(fn, ms), cancel: t => clearTimeout(t) }
  }
  getSnapshot = () => this.view
  private update(patch: Partial<BandSyncClientView>) { this.view = { ...this.view, ...patch }; this.changed(this.view) }
  private timer(fn: () => void, ms: number) {
    const t = this.rt.later(() => { this.timers.delete(t); if (!this.disposed) fn() }, ms)
    this.timers.add(t)
    return t
  }
  private clearConnection() {
    for (const t of this.timers) this.rt.cancel(t)
    this.timers.clear()
    this.stateTimer = null
    this.lastStateAt = -Infinity
    const s = this.socket; this.socket = null
    if (s) { s.onopen = null; s.onclose = null; s.onmessage = null; s.onerror = null; s.close() }
  }
  private reset() {
    this.generation++; this.lifetime.abort(); this.lifetime = new AbortController()
    this.clearConnection(); this.credential = ''; this.sequence = 0; this.backoff = 1000; this.sentHash = ''
    this.forceContent = false
  }
  private async post(path: string, value: unknown): Promise<Record<string, unknown>> {
    let response: Response
    try {
      // DEV Access needs same-origin cookies; the Pages Function strips them before reaching the worker.
      response = await this.rt.fetch('/bandsync-api' + path, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: this.lifetime.signal })
    } catch { throw new BandSyncHttpError(0) }
    if (response.redirected || ['opaque', 'opaqueredirect'].includes(response.type)) throw new BandSyncHttpError(response.status, true)
    if (!response.ok) throw new BandSyncHttpError(response.status)
    return await response.json() as Record<string, unknown>
  }
  async create(): Promise<void> {
    if (this.disposed) return
    this.reset(); const generation = this.generation
    this.update({ status: 'starting', role: 'leader', roomCode: '', follower: null, ended: false, message: undefined })
    try {
      const result = await this.post('/create', {})
      if (generation !== this.generation) return
      if (!isRoomCode(result.roomCode) || typeof result.leaderCredential !== 'string' || !/^[a-f0-9]{64}$/.test(result.leaderCredential)) throw new Error('Invalid room response')
      this.credential = result.leaderCredential
      this.update({ roomCode: result.roomCode })
      await this.connect(generation)
    } catch (error) { if (generation === this.generation) this.update({ status: 'error', message: failureMessage(error, 'create') }) }
  }
  async join(code: string): Promise<void> {
    if (this.disposed) return
    const roomCode = code.trim().toUpperCase()
    if (!isRoomCode(roomCode)) { this.update({ status: 'error', message: 'Band Sync error' }); return }
    this.reset(); const generation = this.generation
    this.update({ status: 'starting', role: 'follower', roomCode, follower: initialBandSyncState(roomCode), ended: false, message: undefined })
    await this.connect(generation)
  }
  private async connect(generation: number): Promise<void> {
    if (generation !== this.generation || this.disposed || this.view.ended) return
    try {
      // Ticket time belongs to the server; a phone's wall clock cannot decide expiry.
      const ticket = await this.post(this.view.role === 'leader' ? '/ticket' : '/join', this.view.role === 'leader'
          ? { roomCode: this.view.roomCode, leaderCredential: this.credential } : { roomCode: this.view.roomCode })
      if (generation !== this.generation) return
      if (ticket.roomCode !== this.view.roomCode || typeof ticket.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket.ticket)) throw new Error('Invalid ticket')
      const url = new URL('/bandsync-api/socket', this.rt.origin); url.protocol = 'wss:'
      const socket = this.rt.socket(url.href, ['bandsync', `ticket.${ticket.ticket}`])
      this.socket = socket; this.sequence = 0; this.sentHash = ''
      const current = () => generation === this.generation && this.socket === socket && !this.disposed && !this.view.ended
      socket.onopen = () => {
        if (!current()) return
        this.backoff = 1000; this.update({ status: 'active', message: undefined })
        this.send('HELLO', { role: this.view.role })
        this.publishCurrent()
        const ping = () => { if (current()) { socket.send('ping'); this.timer(ping, BAND_SYNC_LIMITS.heartbeatMs) } }
        this.timer(ping, BAND_SYNC_LIMITS.heartbeatMs)
      }
      socket.onmessage = event => { if (current()) this.receive(event.data) }
      socket.onclose = () => { if (current()) this.retry(generation) }
      socket.onerror = () => { if (current()) this.retry(generation) }
    } catch (error) {
      if (generation !== this.generation || this.disposed) return
      const message = failureMessage(error, this.view.role === 'leader' ? 'ticket' : 'join')
      if (error instanceof BandSyncHttpError && [403, 404].includes(error.status)) {
        this.clearConnection()
        this.update({ status: 'error', message, follower: null })
      } else this.retry(generation, message)
    }
  }
  private retry(generation: number, message = networkMessage) {
    this.clearConnection()
    if (this.view.ended || this.disposed) return
    this.update({ status: 'offline', message, follower: this.view.follower ? { ...reconnectBandSync(this.view.follower), leaderOnline: false } : null })
    const delay = this.backoff; this.backoff = Math.min(30000, delay * 2)
    this.timer(() => { void this.connect(generation) }, delay)
  }
  private send(type: BandSyncMessage['type'], payload: unknown) {
    if (this.socket?.readyState !== 1 || !this.view.role || this.sequence >= Number.MAX_SAFE_INTEGER) return
    const message = { version: 1, roomCode: this.view.roomCode, type, payload, sequence: ++this.sequence,
      timestamp: this.rt.now(), direction: this.view.role === 'leader' ? 'LEADER_TO_SERVER' : 'FOLLOWER_TO_SERVER' } as const
    const checked = validateBandSyncMessage(message, message.direction)
    if (checked.ok) this.socket.send(JSON.stringify(checked.value))
  }
  publish(state: BandSyncState, content: BandSyncContent) { this.current = { state, content }; this.publishCurrent() }
  private publishCurrent(forceContent = false) {
    if (this.view.role !== 'leader' || !this.current || this.socket?.readyState !== 1) return
    if (forceContent && this.sentHash === this.current.content.contentHash) { this.send('CONTENT', this.current.content); return }
    this.forceContent ||= forceContent
    const delay = BAND_SYNC_LIMITS.stateIntervalMs - (this.rt.now() - this.lastStateAt)
    if (delay > 0) {
      this.stateTimer ??= this.timer(() => { this.stateTimer = null; this.publishCurrent() }, delay)
      return
    }
    this.lastStateAt = this.rt.now()
    this.send('STATE', { state: this.current.state })
    if (this.forceContent || this.sentHash !== this.current.content.contentHash) {
      this.send('CONTENT', this.current.content)
      if (this.socket?.readyState === 1) this.sentHash = this.current.content.contentHash
    }
    this.forceContent = false
  }
  private receive(input: unknown) {
    if (input === 'pong') return
    const checked = validateBandSyncMessage(input, 'SERVER_TO_CLIENT')
    if (!checked.ok || checked.value.roomCode !== this.view.roomCode) return
    const m = checked.value
    if (m.type === 'SESSION_ENDED') {
      const reduced = this.view.follower ? applyBandSyncMessage(this.view.follower, m) : null
      if (reduced?.error) return
      const follower = reduced?.state ?? null
      this.reset(); this.update({ status: 'offline', ended: true, follower, role: null, roomCode: '', message: undefined }); return
    }
    if (this.view.role === 'leader') {
      if (m.type === 'NEED_CONTENT' && m.payload.contentHash === this.current?.content.contentHash) this.publishCurrent(true)
      return
    }
    if (!this.view.follower) return
    const reduced = applyBandSyncMessage(this.view.follower, m)
    if (reduced.error === 'RESYNC_REQUIRED') { this.update({ follower: reduced.state }); this.send('HELLO', { role: 'follower' }); return }
    if (reduced.error) return
    this.update({ follower: reduced.state })
    if (reduced.state.state && !reduced.state.content) this.send('NEED_CONTENT', { contentHash: reduced.state.state.contentHash })
  }
  async end(): Promise<void> {
    const leader = this.view.role === 'leader', roomCode = this.view.roomCode, leaderCredential = this.credential
    try { if (leader && roomCode && this.view.message !== 'Room not found or ended') await this.post('/end', { roomCode, leaderCredential }) }
    catch (error) { this.update({ status: 'error', message: failureMessage(error, 'end') }); return }
    this.reset(); this.update({ status: 'offline', role: null, roomCode: '', follower: null, ended: true, message: undefined })
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.reset(); this.current = null; this.update({ status: 'offline', role: null, roomCode: '', follower: null, ended: true, message: undefined }) }
}
