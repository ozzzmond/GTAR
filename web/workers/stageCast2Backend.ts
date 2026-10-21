import { CAST2_VERSION, validateCast2Message } from '../src/utils/stageCast2Protocol'
import type { ReceiverSnapshot } from '../src/utils/stageCast2Protocol'

export const POLICY = Object.freeze({ pairingMs: 120_000, idleTimeoutMs: 600_000, sessionMs: 600_000,
  maxLifetimeMs: 5_400_000, ticketMs: 15_000, heartbeatMs: 45_000, sessions: 32, guesses: 5, requests: 120, buckets: 512 })
export type State = 'CREATED' | 'WAITING_FOR_CONTROLLER' | 'AWAITING_TV_APPROVAL' | 'PAIRED' | 'DISCONNECTED' | 'EXPIRED' | 'REVOKED'
type Role = 'controller' | 'receiver'
const transitions: Record<State, State[]> = {
  CREATED: ['WAITING_FOR_CONTROLLER'], WAITING_FOR_CONTROLLER: ['PAIRED', 'EXPIRED', 'REVOKED'],
  // Legacy pending sessions can only expire or be revoked; new claims use possession consent.
  AWAITING_TV_APPROVAL: ['EXPIRED', 'REVOKED'], PAIRED: ['DISCONNECTED', 'EXPIRED', 'REVOKED'],
  DISCONNECTED: ['PAIRED', 'EXPIRED', 'REVOKED'], EXPIRED: [], REVOKED: [],
}
export function transition(from: State, to: State): State {
  if (!transitions[from].includes(to)) throw new Denial('INVALID_STATE', 409)
  return to
}
export class Denial extends Error {
  code: string
  status: number
  constructor(code = 'DENIED', status = 403) { super(code); this.code = code; this.status = status }
}
export interface Socket {
  accept(): void
  send(data: string): void
  close(code: number, reason: string): void
  addEventListener(type: string, callback: (event: { data?: unknown }) => void): void
}
export interface Storage {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  setAlarm(time: number): Promise<void>
}
interface Session {
  ref: string; state: State; deadline: number; pairingDeadline: number; maxDeadline: number; pinHash: string; receiverHash: string
  owner: string; controllerHash: string; requestId: string; guesses: number; sequence: number
  inbound: Record<Role, number>
}
interface Ticket { hash: string; ref: string; role: Role; deadline: number }
interface Bucket { key: string; count: number; window: number }
interface Database { sessions: Session[]; tickets: Ticket[]; buckets: Bucket[] }
interface Connection { ref: string; role: Role; socket: Socket; lastSeen: number; window: number; count: number }
interface Runtime {
  now(): number
  upgrade(): { server: Socket; response: Response }
}
const runtime: Runtime = {
  now: () => Date.now(),
  upgrade: () => {
    const Pair = (globalThis as unknown as { WebSocketPair: new () => { 0: Socket; 1: Socket } }).WebSocketPair
    const pair = new Pair()
    return { server: pair[1], response: new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit) }
  },
}
export const digest = async (value: string): Promise<string> => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
const secret = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
export function securePin(): string {
  // Rejection sampling avoids modulo bias, including leading zeroes.
  let n: number
  do { n = crypto.getRandomValues(new Uint32Array(1))[0] } while (n >= 4_294_000_000)
  return String(n % 1_000_000).padStart(6, '0')
}
export const reply = (value: unknown, status = 200): Response => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' },
})
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Denial('INVALID_REQUEST', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > 2048) { await reader.cancel(); throw new Denial('OVERSIZED_PAYLOAD', 413) }
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch (error) { if (error instanceof Denial) throw error; throw new Denial('INVALID_REQUEST', 400) }
  finally { reader.releaseLock() }
}
const shape = (b: Record<string, unknown>, keys: string[]): void => {
  if (Object.keys(b).length !== keys.length || keys.some(k => !Object.hasOwn(b, k))) throw new Denial('INVALID_REQUEST', 400)
}
const opaque = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)

/** Isolated external Worker DO. No Pages route, binding or deployment is installed. */
export class StageCast2Hub {
  private db: Database = { sessions: [], tickets: [], buckets: [] }
  private connections: Connection[] = []
  private snapshots = new Map<string, ReceiverSnapshot>()
  private tail: Promise<unknown>
  private failed = false
  private pending: Array<() => void> = []
  private storage: Storage
  private rt: Runtime
  constructor(state: { storage: Storage }, _env?: unknown, rt: Runtime = runtime) {
    this.storage = state.storage
    this.rt = rt
    this.tail = this.storage.get<Database>('hub').then(saved => {
      if (saved) this.db = saved
      // Standard sockets close on eviction; presentation is deliberately memory only.
      for (const s of this.db.sessions) if (s.state === 'PAIRED') s.state = transition(s.state, 'DISCONNECTED')
    }).catch(() => { this.failed = true })
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.tail.then(async () => {
      if (this.failed) throw new Denial('UNAVAILABLE', 503)
      let outcome: { ok: true; value: T } | { ok: false; error: unknown }
      try { this.sweep(); outcome = { ok: true, value: await operation() } }
      catch (error) { outcome = { ok: false, error } }
      try {
        await this.storage.put('hub', this.db)
        if (this.db.sessions.length || this.db.buckets.length) await this.storage.setAlarm(this.rt.now() + 15_000)
        const pending = this.pending; this.pending = []
        for (const deliver of pending) deliver()
      } catch {
        this.failed = true
        for (const c of this.connections) c.socket.close(1011, 'UNAVAILABLE')
        this.connections = []; this.snapshots.clear()
        this.pending = []
        throw new Denial('UNAVAILABLE', 503)
      }
      if (!outcome.ok) throw outcome.error
      return outcome.value
    })
    this.tail = work.catch(() => {})
    return work
  }
  private limit(key: string, maximum: number): void {
    const window = Math.floor(this.rt.now() / 60_000)
    let b = this.db.buckets.find(v => v.key === key && v.window === window)
    if (!b) {
      if (this.db.buckets.length >= POLICY.buckets) throw new Denial('RATE_LIMITED', 429)
      b = { key, count: 0, window }; this.db.buckets.push(b)
    }
    if (++b.count > maximum) throw new Denial('RATE_LIMITED', 429)
  }
  private sweep(): void {
    const now = this.rt.now()
    this.db.buckets = this.db.buckets.filter(b => b.window === Math.floor(now / 60_000))
    this.db.tickets = this.db.tickets.filter(t => t.deadline > now)
    for (const s of this.db.sessions) {
      if (!['REVOKED', 'EXPIRED'].includes(s.state) && (now >= s.deadline ||
        (['WAITING_FOR_CONTROLLER', 'AWAITING_TV_APPROVAL'].includes(s.state) && now >= s.pairingDeadline))) this.end(s, 'EXPIRED')
    }
    for (const c of [...this.connections]) if (now - c.lastSeen >= POLICY.heartbeatMs) this.disconnect(c)
    // Keep terminal tombstones until session deadline; absent refs deny identically.
    this.db.sessions = this.db.sessions.filter(s => now < s.deadline)
  }
  private end(s: Session, state: 'REVOKED' | 'EXPIRED'): void {
    s.state = transition(s.state, state)
    const message = this.outbound(s, 'SESSION_REVOKED', { reason: state === 'EXPIRED' ? 'EXPIRED' : 'CONTROLLER_ENDED' })
    for (const c of this.connections.filter(c => c.ref === s.ref)) {
      if (c.role === 'receiver') this.send(c, message)
      this.pending.push(() => c.socket.close(1000, state))
    }
    this.connections = this.connections.filter(c => c.ref !== s.ref)
    this.db.tickets = this.db.tickets.filter(t => t.ref !== s.ref)
    s.receiverHash = ''; s.controllerHash = ''; s.pinHash = ''
    this.snapshots.delete(s.ref)
  }
  private touch(s: Session): void {
    if (['REVOKED', 'EXPIRED'].includes(s.state)) return
    s.deadline = Math.min(s.maxDeadline, this.rt.now() + POLICY.idleTimeoutMs)
  }
  private session(ref: unknown): Session {
    const s = this.db.sessions.find(s => s.ref === ref)
    if (!s || ['REVOKED', 'EXPIRED'].includes(s.state)) throw new Denial()
    return s
  }
  private async authorize(s: Session, role: Role, credential: unknown, owner: string): Promise<void> {
    if (!opaque(credential) || await digest(credential) !== (role === 'receiver' ? s.receiverHash : s.controllerHash) ||
      (role === 'controller' && (!owner || owner !== s.owner))) throw new Denial()
  }
  async fetch(request: Request): Promise<Response> {
    try { return await this.serial(async () => {
      const url = new URL(request.url)
      if (url.search) throw new Denial('INVALID_REQUEST', 400)
      const ip = request.headers.get('x-cast-client')
      if (!opaque(ip)) throw new Denial()
      this.limit('global', POLICY.requests)
      this.limit('ip:' + ip, 40)
      if (url.pathname === '/socket' && request.method === 'GET') return this.connect(request)
      if (request.method !== 'POST') throw new Denial('INVALID_REQUEST', 400)
      const b = await body(request)
      const owner = request.headers.get('x-cast-owner') || ''
      if (url.pathname === '/create') {
        shape(b, [])
        this.limit('create:' + ip, 5)
        if (this.db.sessions.length >= POLICY.sessions) throw new Denial('UNAVAILABLE', 503)
        const ref = secret(), credential = secret(), pin = securePin(), now = this.rt.now()
        const s: Session = { ref, state: transition('CREATED', 'WAITING_FOR_CONTROLLER'), deadline: now + POLICY.sessionMs,
          pairingDeadline: now + POLICY.pairingMs, maxDeadline: now + POLICY.maxLifetimeMs, pinHash: await digest(ref + pin), receiverHash: await digest(credential),
          owner: '', controllerHash: '', requestId: '', guesses: 0, sequence: 0, inbound: { controller: 0, receiver: 0 } }
        this.db.sessions.push(s)
        return reply({ ref, pin, receiverCredential: credential, pairingExpiresAt: s.pairingDeadline, expiresAt: s.deadline })
      }
      const s = this.session(b.ref)
      if (url.pathname === '/claim') {
        shape(b, ['ref', 'pin'])
        if (!owner) throw new Denial('AUTH_REQUIRED', 401)
        this.limit('owner:' + await digest(owner), 10)
        if (s.state !== 'WAITING_FOR_CONTROLLER') throw new Denial()
        if (++s.guesses > POLICY.guesses) { this.end(s, 'REVOKED'); throw new Denial() }
        if (typeof b.pin !== 'string' || !/^\d{6}$/.test(b.pin) || await digest(s.ref + b.pin) !== s.pinHash) {
          if (s.guesses >= POLICY.guesses) this.end(s, 'REVOKED')
          throw new Denial()
        }
        if (this.rt.now() >= s.pairingDeadline) { this.end(s, 'EXPIRED'); throw new Denial() }
        // Possession of the displayed PIN plus an active server-authorized account is consent.
        // Serial persistence binds the first claim to its owner and burns the PIN before reply.
        s.state = transition(s.state, 'PAIRED')
        s.deadline = Math.min(s.maxDeadline, this.rt.now() + POLICY.idleTimeoutMs)
        const credential = secret()
        s.controllerHash = await digest(credential); s.owner = owner; s.requestId = secret(); s.pinHash = ''
        return reply({ state: s.state, sessionId: s.ref, requestId: s.requestId, controllerCredential: credential, expiresAt: s.deadline })
      }
      if (b.role !== 'controller' && b.role !== 'receiver') throw new Denial()
      const role = b.role
      await this.authorize(s, role, b.credential, owner)
      switch (url.pathname) {
        case '/status':
          shape(b, ['ref', 'role', 'credential'])
          this.touch(s)
          return reply({ sessionId: s.ref, state: s.state, requestId: s.requestId, expiresAt: s.deadline,
            maxExpiresAt: s.maxDeadline, sequence: s.sequence, inboundSequence: s.inbound[role] })
        case '/revoke':
          shape(b, ['ref', 'role', 'credential'])
          this.end(s, 'REVOKED'); return reply({ state: s.state })
        case '/ticket': {
          shape(b, ['ref', 'role', 'credential'])
          if (!['PAIRED', 'DISCONNECTED'].includes(s.state)) throw new Denial()
          this.touch(s)
          this.db.tickets = this.db.tickets.filter(t => t.ref !== s.ref || t.role !== role)
          const ticket = secret()
          this.db.tickets.push({ hash: await digest(ticket), ref: s.ref, role, deadline: this.rt.now() + POLICY.ticketMs })
          return reply({ ticket, expiresAt: Math.min(s.deadline, this.rt.now() + POLICY.ticketMs) })
        }
        default: throw new Denial('INVALID_REQUEST', 400)
      }
    }) } catch (error) { return reply({ error: error instanceof Denial ? error.code : 'UNAVAILABLE' }, error instanceof Denial ? error.status : 503) }
  }
  private async connect(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new Denial()
    // Browser WebSocket API supports protocols, not Authorization headers. Ticket is one-use and never echoed.
    const protocols = request.headers.get('Sec-WebSocket-Protocol') || ''
    const match = /^cast2,\s*ticket\.([a-f0-9]{64})$/.exec(protocols)
    if (!match) throw new Denial()
    const hash = await digest(match[1])
    const index = this.db.tickets.findIndex(t => t.hash === hash)
    if (index < 0) throw new Denial()
    const [ticket] = this.db.tickets.splice(index, 1)
    const s = this.session(ticket.ref)
    if (!['PAIRED', 'DISCONNECTED'].includes(s.state)) throw new Denial()
    for (const old of this.connections.filter(c => c.ref === s.ref && c.role === ticket.role)) {
      this.disconnect(old, ticket.role === 'receiver' ? 'REPLACED' : 'DISCONNECTED')
    }
    const { server, response } = this.rt.upgrade()
    response.headers.set('Sec-WebSocket-Protocol', 'cast2')
    const c: Connection = { ref: s.ref, role: ticket.role, socket: server, lastSeen: this.rt.now(), window: 0, count: 0 }
    server.accept(); this.connections.push(c)
    const enqueue = (fn: () => Promise<void>): void => { void this.serial(fn).catch(() => { this.disconnect(c) }) }
    server.addEventListener('message', event => enqueue(async () => this.receive(c, event.data)))
    server.addEventListener('close', () => enqueue(async () => this.disconnect(c)))
    server.addEventListener('error', () => enqueue(async () => this.disconnect(c)))
    if (s.state === 'DISCONNECTED' && this.connections.filter(c => c.ref === s.ref).length === 2) s.state = transition(s.state, 'PAIRED')
    this.resync(s)
    return response
  }
  private disconnect(c: Connection, reason = 'DISCONNECTED'): void {
    if (!this.connections.includes(c)) return
    this.connections = this.connections.filter(v => v !== c)
    c.socket.close(1000, reason)
    const s = this.db.sessions.find(s => s.ref === c.ref)
    if (s?.state === 'PAIRED') s.state = transition(s.state, 'DISCONNECTED')
  }
  private send(c: Connection, data: unknown): void {
    this.pending.push(() => {
      try { c.socket.send(JSON.stringify(data)) } catch { this.disconnect(c) }
    })
  }
  private outbound(s: Session, type: string, payload: unknown): unknown {
    if (s.sequence >= Number.MAX_SAFE_INTEGER) throw new Denial('SEQUENCE_EXHAUSTED', 409)
    const checked = validateCast2Message({ version: CAST2_VERSION, type, direction: 'SERVER_TO_RECEIVER', sessionId: s.ref,
      timestamp: this.rt.now(), sequence: s.sequence + 1, payload }, 'SERVER_TO_RECEIVER')
    if (!checked.ok) throw new Denial(checked.error, 400)
    s.sequence++
    return checked.value
  }
  private resync(s: Session): void {
    const receiver = this.connections.find(c => c.ref === s.ref && c.role === 'receiver')
    const snapshot = this.snapshots.get(s.ref)
    if (snapshot && receiver) this.send(receiver, this.outbound(s, 'PRESENTATION_SNAPSHOT', { snapshot }))
    else {
      const controller = this.connections.find(c => c.ref === s.ref && c.role === 'controller')
      if (controller) this.send(controller, { version: 1, type: 'SYNC_ERROR', direction: 'SERVER_TO_CONTROLLER',
        sessionId: s.ref, timestamp: this.rt.now(), sequence: Math.max(1, s.sequence), payload: { code: 'RESYNC_REQUIRED' } })
    }
  }
  private async receive(c: Connection, raw: unknown): Promise<void> {
    if (!this.connections.includes(c)) return
    const s = this.session(c.ref)
    const window = Math.floor(this.rt.now() / 1000)
    if (c.window !== window) { c.window = window; c.count = 0 }
    if (++c.count > 30) { this.disconnect(c); return }
    if (raw === 'ping') { c.lastSeen = this.rt.now(); this.touch(s); this.send(c, 'pong'); return }
    if (typeof raw !== 'string') { this.disconnect(c); return }
    const checked = validateCast2Message(raw, c.role === 'controller' ? 'CONTROLLER_TO_SERVER' : 'RECEIVER_TO_SERVER')
    if (!checked.ok) { this.disconnect(c); return }
    const m = checked.value
    if (m.sessionId !== s.ref || m.sequence <= s.inbound[c.role] ||
      (c.role === 'controller' ? !['PRESENTATION_SNAPSHOT', 'PRESENTATION_UPDATE'].includes(m.type) : !['SYNC_ACK', 'SYNC_ERROR'].includes(m.type))) {
      this.disconnect(c); return
    }
    if (m.type === 'SYNC_ACK' && m.payload.appliedSequence > s.sequence) { this.disconnect(c); return }
    if (m.type === 'SYNC_ERROR' && m.payload.code !== 'RESYNC_REQUIRED') { this.disconnect(c); return }
    if (m.type === 'PRESENTATION_UPDATE' && (!this.snapshots.has(s.ref) || m.payload.baseSequence !== s.sequence)) {
      this.disconnect(c); return
    }
    s.inbound[c.role] = m.sequence; c.lastSeen = this.rt.now(); this.touch(s)
    if (m.type === 'SYNC_ERROR') { this.resync(s); return }
    if (m.type === 'SYNC_ACK') return
    if (m.type === 'PRESENTATION_SNAPSHOT' || m.type === 'PRESENTATION_UPDATE') {
      const receiver = this.connections.find(v => v.ref === s.ref && v.role === 'receiver')
      const baseSequence = s.sequence
      const out = this.outbound(s, m.type, m.type === 'PRESENTATION_UPDATE' ? { baseSequence, snapshot: m.payload.snapshot } : m.payload)
      this.snapshots.set(s.ref, m.payload.snapshot)
      if (receiver) this.send(receiver, out)
    }
  }
  async alarm(): Promise<void> { await this.serial(async () => {}) }
}
