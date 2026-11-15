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
  status: 'starting' | 'active' | 'offline' | 'error'; role: 'leader' | 'follower' | null
  roomCode: string; follower: BandSyncFollower | null; ended: boolean
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
  }
  private clearConnection() {
    for (const t of this.timers) this.rt.cancel(t)
    this.timers.clear()
    const s = this.socket; this.socket = null
    if (s) { s.onopen = null; s.onclose = null; s.onmessage = null; s.onerror = null; s.close() }
  }
  private reset() {
    this.generation++; this.lifetime.abort(); this.lifetime = new AbortController()
    this.clearConnection(); this.credential = ''; this.sequence = 0; this.backoff = 1000; this.sentHash = ''
  }
  private async post(path: string, value: unknown): Promise<Record<string, unknown>> {
    const response = await this.rt.fetch('/bandsync-api' + path, { method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: this.lifetime.signal })
    if (!response.ok) throw new Error('Room request failed')
    return await response.json() as Record<string, unknown>
  }
  async create(): Promise<void> {
    if (this.disposed) return
    this.reset(); const generation = this.generation
    this.update({ status: 'starting', role: 'leader', roomCode: '', follower: null, ended: false })
    try {
      const result = await this.post('/create', {})
      if (generation !== this.generation) return
      if (!isRoomCode(result.roomCode) || typeof result.leaderCredential !== 'string' || !/^[a-f0-9]{64}$/.test(result.leaderCredential)) throw new Error('Invalid room response')
      this.credential = result.leaderCredential
      this.update({ roomCode: result.roomCode })
      await this.connect(generation)
    } catch { if (generation === this.generation) this.update({ status: 'error' }) }
  }
  async join(code: string): Promise<void> {
    if (this.disposed) return
    const roomCode = code.trim().toUpperCase()
    if (!isRoomCode(roomCode)) { this.update({ status: 'error' }); return }
    this.reset(); const generation = this.generation
    this.update({ status: 'starting', role: 'follower', roomCode, follower: initialBandSyncState(roomCode), ended: false })
    await this.connect(generation)
  }
  private async connect(generation: number): Promise<void> {
    if (generation !== this.generation || this.disposed || this.view.ended) return
    try {
      let ticket: Record<string, unknown> | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        ticket = await this.post(this.view.role === 'leader' ? '/ticket' : '/join', this.view.role === 'leader'
          ? { roomCode: this.view.roomCode, leaderCredential: this.credential } : { roomCode: this.view.roomCode })
        if (generation !== this.generation) return
        if (typeof ticket.expiresAt === 'number' && ticket.expiresAt > this.rt.now()) break
        ticket = undefined
      }
      if (!ticket || ticket.roomCode !== this.view.roomCode || typeof ticket.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket.ticket)) throw new Error('Invalid ticket')
      const url = new URL('/bandsync-api/socket', this.rt.origin); url.protocol = 'wss:'
      const socket = this.rt.socket(url.href, ['bandsync', `ticket.${ticket.ticket}`])
      this.socket = socket; this.sequence = 0; this.sentHash = ''
      const current = () => generation === this.generation && this.socket === socket && !this.disposed && !this.view.ended
      socket.onopen = () => {
        if (!current()) return
        this.backoff = 1000; this.update({ status: 'active' })
        this.send('HELLO', { role: this.view.role })
        this.publishCurrent()
        const ping = () => { if (current()) { socket.send('ping'); this.timer(ping, BAND_SYNC_LIMITS.heartbeatMs) } }
        this.timer(ping, BAND_SYNC_LIMITS.heartbeatMs)
      }
      socket.onmessage = event => { if (current()) this.receive(event.data) }
      socket.onclose = () => { if (current()) this.retry(generation) }
      socket.onerror = () => { if (current()) this.retry(generation) }
    } catch { if (generation === this.generation && !this.disposed) this.retry(generation) }
  }
  private retry(generation: number) {
    this.clearConnection()
    if (this.view.ended || this.disposed) return
    this.update({ status: 'offline', follower: this.view.follower ? reconnectBandSync(this.view.follower) : null })
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
    if (this.view.role !== 'leader' || !this.current) return
    this.send('STATE', { state: this.current.state })
    if (forceContent || this.sentHash !== this.current.content.contentHash) {
      this.send('CONTENT', this.current.content)
      if (this.socket?.readyState === 1) this.sentHash = this.current.content.contentHash
    }
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
      this.reset(); this.update({ status: 'offline', ended: true, follower, role: null, roomCode: '' }); return
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
    try { if (leader && roomCode) await this.post('/end', { roomCode, leaderCredential }) }
    catch { this.update({ status: 'error' }); return }
    this.reset(); this.update({ status: 'offline', role: null, roomCode: '', follower: null, ended: true })
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.reset(); this.current = null; this.update({ status: 'offline', role: null, roomCode: '', follower: null, ended: true }) }
}
