import { validateCast2Message } from './stageCast2Protocol'
import type { ReceiverSnapshot } from './stageCast2Protocol'
import { applyCast2Message, initialCast2SyncState, reconnectCast2 } from './stageCast2Sync'

type Role = 'receiver' | 'controller'
export interface Cast2View {
  state: string; error: string; ref: string; pin: string; requestId: string
  pairingExpiresAt: number; expiresAt: number; snapshot: ReceiverSnapshot | null
}
export interface Cast2IO {
  post(path: string, data: object, controller: boolean): Promise<Record<string, unknown>>
  socket(ticket: string): WebSocket
  now(): number
}
const opaque = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const deadline = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const states = ['WAITING_FOR_CONTROLLER', 'AWAITING_TV_APPROVAL', 'PAIRED', 'DISCONNECTED', 'EXPIRED', 'REVOKED']

/** Ephemeral scopes only. Caller drives tick every five seconds; no hidden retry loops. */
export class Cast2Client {
  view: Cast2View = { state: 'IDLE', error: '', ref: '', pin: '', requestId: '', pairingExpiresAt: 0, expiresAt: 0, snapshot: null }
  private credential = ''
  private ws: WebSocket | null = null
  private sync = initialCast2SyncState('')
  private sequence = 0
  private failures = 0
  private epoch = 0
  private busy = false
  private connectingAt = 0
  private lastPing = 0
  private latest: ReceiverSnapshot | null = null
  private role: Role
  private io: Cast2IO
  private changed: (view: Cast2View) => void
  constructor(role: Role, io: Cast2IO, changed: (view: Cast2View) => void) { this.role = role; this.io = io; this.changed = changed }
  private emit(patch: Partial<Cast2View>) { this.view = { ...this.view, ...patch }; this.changed(this.view) }
  private scope() { return { ref: this.view.ref, role: this.role, credential: this.credential } }
  private close() { const ws = this.ws; this.ws = null; if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.onopen = null; ws.close() } }
  dispose() { this.epoch++; this.close(); this.credential = ''; this.latest = null; this.sync = initialCast2SyncState(''); this.view = { ...this.view, snapshot: null } }
  private terminal(state: string, error = '') { this.dispose(); this.emit({ state, error, pin: '', requestId: '', snapshot: null }) }
  private fail(error: unknown) {
    const code = error instanceof Error ? error.message : 'UNAVAILABLE'
    if (['DENIED', 'AUTH_REQUIRED', 'DISABLED'].includes(code)) this.terminal('ENDED', code)
    else if (++this.failures >= 3) this.terminal('DISCONNECTED', 'Connection attempts exhausted. Start a new pairing.')
    else { this.close(); this.emit({ state: 'DISCONNECTED', error: 'Connection interrupted. Retrying…', snapshot: null }) }
  }
  async start(ref = '', pin = '') {
    if (this.busy || this.credential) return
    this.busy = true
    this.failures = 0; this.sequence = 0
    const epoch = this.epoch
    this.emit({ state: 'LOADING', error: '' })
    try {
      if (this.role === 'controller' && (!opaque(ref) || !/^\d{6}$/.test(pin))) throw Error('Invalid TV reference or six-digit PIN.')
      const data = await this.io.post(this.role === 'receiver' ? '/create' : '/claim', this.role === 'receiver' ? {} : { ref, pin }, this.role === 'controller')
      if (epoch !== this.epoch) return
      const id = this.role === 'receiver' ? data.ref : data.sessionId
      const credential = this.role === 'receiver' ? data.receiverCredential : data.controllerCredential
      if (!opaque(id) || !opaque(credential) || !deadline(data.expiresAt) || (this.role === 'receiver' &&
        (!deadline(data.pairingExpiresAt) || typeof data.pin !== 'string' || !/^\d{6}$/.test(data.pin)))) throw Error('Invalid server response.')
      if (this.role === 'controller' && data.state !== 'PAIRED') throw Error('TV pairing service needs an update. Reload both devices after the DEV service is updated.')
      this.credential = credential; this.sync = initialCast2SyncState(id)
      this.emit({ ref: id, pin: this.role === 'receiver' ? data.pin as string : '', expiresAt: data.expiresAt,
        pairingExpiresAt: this.role === 'receiver' ? data.pairingExpiresAt as number : this.io.now() + 120_000,
        state: this.role === 'receiver' ? 'WAITING_FOR_CONTROLLER' : 'PAIRED' })
    } catch (error) { if (epoch === this.epoch) this.terminal('ERROR', error instanceof Error ? error.message : 'UNAVAILABLE') }
    finally { this.busy = false }
  }
  async end() {
    const scope = this.scope()
    this.terminal('ENDED')
    if (scope.credential) { try { await this.io.post('/revoke', scope, this.role === 'controller') } catch { this.emit({ error: 'End request failed. TV session expires automatically.' }) } }
  }
  publish(snapshot: ReceiverSnapshot) { this.latest = snapshot; this.sendSnapshot() }
  private sendSnapshot() {
    if (this.role !== 'controller' || !this.latest || this.ws?.readyState !== 1) return
    this.send('PRESENTATION_SNAPSHOT', { snapshot: this.latest })
  }
  private send(type: string, payload: unknown) {
    if (this.ws?.readyState !== 1) return
    const message = { version: 1, type, direction: this.role === 'controller' ? 'CONTROLLER_TO_SERVER' : 'RECEIVER_TO_SERVER',
      sessionId: this.view.ref, sequence: ++this.sequence, timestamp: this.io.now(), payload }
    const checked = validateCast2Message(message, message.direction as 'CONTROLLER_TO_SERVER' | 'RECEIVER_TO_SERVER')
    if (!checked.ok) { this.terminal('ERROR', checked.error); return }
    this.ws.send(JSON.stringify(checked.value))
  }
  async tick() {
    if (!this.credential || this.busy) return
    const pairing = ['WAITING_FOR_CONTROLLER', 'AWAITING_TV_APPROVAL'].includes(this.view.state)
    if (this.io.now() >= this.view.expiresAt || (pairing && this.io.now() >= this.view.pairingExpiresAt)) { this.terminal('EXPIRED'); return }
    this.busy = true
    const epoch = this.epoch
    try {
      const status = await this.io.post('/status', this.scope(), this.role === 'controller')
      if (epoch !== this.epoch) return
      if (!states.includes(status.state as string) || status.sessionId !== this.view.ref || !Number.isSafeInteger(status.inboundSequence)) throw Error('Invalid server response.')
      if (status.state === 'REVOKED' || status.state === 'EXPIRED') { this.terminal(status.state); return }
      this.sequence = Math.max(this.sequence, status.inboundSequence as number)
      this.emit({ state: status.state as string, requestId: typeof status.requestId === 'string' ? status.requestId : '', error: '',
        ...(status.state === 'PAIRED' || status.state === 'DISCONNECTED' ? { pin: '' } : {}) })
      if (!['PAIRED', 'DISCONNECTED'].includes(status.state as string)) return
      if (this.ws?.readyState === 0 && this.io.now() - this.connectingAt >= 10_000) throw Error('Socket timeout')
      if (!this.ws) {
        const data = await this.io.post('/ticket', this.scope(), this.role === 'controller')
        if (epoch !== this.epoch) return
        if (!opaque(data.ticket)) throw Error('Invalid ticket')
        this.sync = reconnectCast2(this.sync)
        this.connectingAt = this.io.now()
        const ws = this.io.socket(data.ticket); this.ws = ws
        ws.onopen = () => { if (epoch === this.epoch) { this.lastPing = this.io.now(); this.emit({ state: 'CONNECTED', error: '' }); this.sendSnapshot() } }
        ws.onclose = ws.onerror = () => { if (epoch === this.epoch && this.ws === ws) this.fail(Error('Socket closed')) }
        ws.onmessage = event => {
          if (epoch !== this.epoch || this.ws !== ws || event.data === '"pong"') return
          if (this.role === 'controller') {
            const m = validateCast2Message(event.data, 'SERVER_TO_CONTROLLER')
            if (!m.ok || m.value.sessionId !== this.view.ref) { this.terminal('ERROR', 'Invalid server message'); return }
            if (m.value.type === 'SYNC_ERROR' && m.value.payload.code === 'RESYNC_REQUIRED') this.sendSnapshot()
          } else {
            const result = applyCast2Message(this.sync, event.data)
            if (result.error) {
              if (result.error === 'RESYNC_REQUIRED' || result.error === 'STALE_OR_OUT_OF_ORDER_UPDATE') { this.sync = result.state; this.send('SYNC_ERROR', { code: 'RESYNC_REQUIRED' }); return }
              this.terminal('ERROR', result.error); return
            }
            this.sync = result.state
            if (this.sync.revoked) { this.terminal('REVOKED'); return }
            this.emit({ state: 'CONNECTED', snapshot: this.sync.snapshot })
            this.send('SYNC_ACK', { appliedSequence: this.sync.sequence })
          }
        }
      } else if (this.ws.readyState === 1) {
        this.emit({ state: status.state === 'DISCONNECTED' ? 'DISCONNECTED' : 'CONNECTED' })
        if (this.io.now() - this.lastPing >= 20_000) { this.ws.send('ping'); this.lastPing = this.io.now() }
      }
    } catch (error) { if (epoch === this.epoch) this.fail(error) }
    finally { this.busy = false }
  }
}
