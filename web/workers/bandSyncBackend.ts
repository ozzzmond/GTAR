import { Denial, body, digest, reply } from './stageCast2Backend'
import { BAND_SYNC_LIMITS as L, ROOM_ALPHABET, isRoomCode, validateBandSyncMessage } from '../src/utils/bandSyncProtocol'
import type { BandSyncState, BandSyncContent, BandSyncMessage } from '../src/utils/bandSyncProtocol'

interface Storage {
  get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>
  deleteAll(): Promise<void>; setAlarm(time: number): Promise<void>
}
export interface BandSocket {
  send(data: string): void; close(code: number, reason: string): void
  serializeAttachment(value: unknown): void; deserializeAttachment(): Attachment | null
}
interface Context {
  storage: Storage; acceptWebSocket(socket: BandSocket): void; getWebSockets(): BandSocket[]
  setWebSocketAutoResponse(pair: unknown): void
}
interface Attachment { role: 'leader' | 'follower'; window: number; count: number; inbound: number; active: boolean }
interface Runtime { now(): number; upgrade(): { server: BandSocket; response: Response }; heartbeat(): unknown }
const rt: Runtime = {
  now: () => Date.now(),
  upgrade: () => {
    const Pair = (globalThis as unknown as { WebSocketPair: new () => { 0: BandSocket; 1: BandSocket } }).WebSocketPair
    const pair = new Pair()
    return { server: pair[1], response: new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'bandsync' } } as ResponseInit) }
  },
  heartbeat: () => {
    const Pair = (globalThis as unknown as { WebSocketRequestResponsePair: new (a: string, b: string) => unknown }).WebSocketRequestResponsePair
    return new Pair('ping', 'pong')
  },
}
export const bandSecret = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
export function generateRoomCode(): string {
  let code = ''
  // 256 is exactly divisible by 32; keep rejection sampling explicit if alphabet changes.
  const ceiling = Math.floor(256 / ROOM_ALPHABET.length) * ROOM_ALPHABET.length
  while (code.length < 8) {
    const n = crypto.getRandomValues(new Uint8Array(1))[0]
    if (n < ceiling) code += ROOM_ALPHABET[n % ROOM_ALPHABET.length]
  }
  return code
}
const shape = (p: Record<string, unknown>, fields: string[]): boolean => Object.keys(p).length === fields.length && fields.every(k => Object.hasOwn(p, k))
const secretShape = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
export const socketTicket = (r: Request): string => {
  const match = /^bandsync\s*,\s*ticket\.([a-f0-9]{64})$/.exec(r.headers.get('Sec-WebSocket-Protocol') || '')
  if (r.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || !match) throw new Denial()
  return match[1]
}
interface Ticket { hash: string; role: 'leader' | 'follower'; expires: number }
interface Room {
  roomCode: string; leaderHash: string; created: number; touched: number; attempts: number
  sequence: number; state: BandSyncState | null; content: BandSyncContent | null
  pending: BandSyncState | null; lastStateAt: number; tickets: Ticket[]
}

/** Serialized events, bounded single-room storage, hibernatable sockets; no account service. */
export class BandSyncHub {
  private room: Room | undefined
  private tail: Promise<unknown>
  private failed = false
  private ctx: Context
  private clock: Runtime
  constructor(ctx: Context, _env?: unknown, clock: Runtime = rt) {
    this.ctx = ctx; this.clock = clock
    ctx.setWebSocketAutoResponse(clock.heartbeat())
    this.tail = ctx.storage.get<Room>('room').then(r => { this.room = r }).catch(() => { this.failed = true })
  }
  private sockets(role?: Attachment['role']): BandSocket[] {
    return this.ctx.getWebSockets().filter(s => { const a = s.deserializeAttachment(); return a?.active && (!role || a.role === role) })
  }
  private close(s: BandSocket, reason = 'DENIED'): void {
    const a = s.deserializeAttachment()
    if (a) s.serializeAttachment({ ...a, active: false })
    s.close(1008, reason)
  }
  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.tail.then(async () => {
      if (this.failed) throw new Denial('UNAVAILABLE', 503)
      try {
        if (this.room && this.expired()) await this.end('EXPIRED')
        let value: T
        try { value = await fn() }
        finally {
          if (this.room) {
            await this.ctx.storage.put('room', this.room)
            await this.ctx.storage.setAlarm(Math.min(this.room.created + L.lifetimeMs, this.room.touched + L.idleMs,
              this.room.pending ? this.room.lastStateAt + L.stateIntervalMs : Infinity))
          }
        }
        return value
      } catch (e) {
        if (!(e instanceof Denial)) {
          this.failed = true
          for (const s of this.sockets()) this.close(s, 'UNAVAILABLE')
          this.room = undefined
        }
        throw e
      }
    })
    this.tail = work.catch(() => { /* Keep event queue usable after a denial. */ })
    return work
  }
  private expired(): boolean { return this.clock.now() >= Math.min(this.room!.created + L.lifetimeMs, this.room!.touched + L.idleMs) }
  private requireRoom(): Room { if (!this.room) throw new Denial(); return this.room }
  private send(s: BandSocket, type: BandSyncMessage['type'], payload: unknown): void {
    const r = this.requireRoom()
    try { s.send(JSON.stringify({ version: 1, roomCode: r.roomCode, type, direction: 'SERVER_TO_CLIENT', sequence: r.sequence, timestamp: this.clock.now(), payload })) }
    catch { this.close(s, 'DISCONNECTED') }
  }
  private advance(): void {
    if (this.requireRoom().sequence >= Number.MAX_SAFE_INTEGER) throw new Denial('INVALID_SEQUENCE')
    this.room!.sequence++
  }
  private snapshot(s: BandSocket): void {
    const r = this.requireRoom(), state = r.pending || r.state
    this.send(s, 'SNAPSHOT', { state, content: r.content?.contentHash === state?.contentHash ? r.content : null, leaderOnline: this.sockets('leader').length === 1 })
  }
  private presence(): void { this.advance(); for (const s of this.sockets()) this.snapshot(s) }
  private flushState(): void {
    const r = this.requireRoom()
    if (!r.pending) return
    r.state = r.pending; r.pending = null; r.lastStateAt = this.clock.now()
    if (r.content?.contentHash !== r.state.contentHash) r.content = null
    this.advance()
    for (const s of this.sockets('follower')) this.send(s, 'STATE', { state: r.state })
  }
  private async end(reason: 'LEADER_ENDED' | 'EXPIRED' | 'LOCKED'): Promise<void> {
    this.advance()
    for (const s of this.sockets()) { this.send(s, 'SESSION_ENDED', { reason }); this.close(s, reason) }
    this.room = undefined
    await this.ctx.storage.deleteAll()
    await this.ctx.storage.put('used', true)
  }
  private async bad(): Promise<never> {
    if (++this.requireRoom().attempts >= L.attempts) await this.end('LOCKED')
    throw new Denial()
  }
  private async ticket(role: Ticket['role']): Promise<Response> {
    const r = this.requireRoom(), now = this.clock.now()
    r.tickets = r.tickets.filter(t => t.expires > now)
    if (r.tickets.length >= L.tickets) throw new Denial('LIMIT', 429)
    const ticket = bandSecret()
    r.tickets.push({ hash: await digest(ticket), role, expires: now + L.ticketMs })
    return reply({ ticket, roomCode: r.roomCode, expiresAt: now + L.ticketMs })
  }
  async fetch(request: Request): Promise<Response> {
    try { return await this.serial(async () => {
      const url = new URL(request.url)
      if (url.search) throw new Denial()
      if (url.pathname === '/socket' && request.method === 'GET') {
        const r = this.requireRoom()
        let token: string
        try { token = socketTicket(request) } catch { return this.bad() }
        const h = await digest(token), t = r.tickets.find(t => t.hash === h)
        if (!t || t.expires <= this.clock.now()) return this.bad()
        r.tickets = r.tickets.filter(x => x !== t)
        if (t.role === 'follower' && this.sockets('follower').length >= L.followers) throw new Denial('ROOM_FULL', 409)
        // Burn ticket durably before upgrading or replacing the old leader.
        await this.ctx.storage.put('room', r)
        const upgraded = this.clock.upgrade()
        if (t.role === 'leader') for (const s of this.sockets('leader')) this.close(s, 'REPLACED')
        upgraded.server.serializeAttachment({ role: t.role, window: this.clock.now(), count: 0, inbound: 0, active: true })
        this.ctx.acceptWebSocket(upgraded.server)
        r.touched = this.clock.now()
        if (t.role === 'leader') this.presence()
        else this.snapshot(upgraded.server)
        return upgraded.response
      }
      if (request.method !== 'POST') throw new Denial('INVALID_REQUEST', 400)
      const p = await body(request)
      if (url.pathname === '/create') {
        if (!shape(p, ['roomCode']) || !isRoomCode(p.roomCode)) throw new Denial('INVALID_REQUEST', 400)
        if (this.room || await this.ctx.storage.get('used')) throw new Denial('ROOM_EXISTS', 409)
        const credential = bandSecret(), now = this.clock.now()
        this.room = { roomCode: p.roomCode, leaderHash: await digest(credential), created: now, touched: now,
          attempts: 0, sequence: 1, state: null, content: null, pending: null, lastStateAt: 0, tickets: [] }
        // Tombstone prevents old credentials/tickets from ever reaching a reused room code.
        await this.ctx.storage.put('used', true)
        return reply({ roomCode: p.roomCode, leaderCredential: credential, expiresAt: now + L.lifetimeMs })
      }
      const r = this.requireRoom()
      if (p.roomCode !== r.roomCode) return this.bad()
      if (url.pathname === '/join') {
        if (!shape(p, ['roomCode'])) return this.bad()
        if (this.sockets('follower').length >= L.followers) throw new Denial('ROOM_FULL', 409)
        return this.ticket('follower')
      }
      if (!['/ticket', '/end'].includes(url.pathname)) throw new Denial('INVALID_REQUEST', 400)
      if (!shape(p, ['roomCode', 'leaderCredential']) || !secretShape(p.leaderCredential) || await digest(p.leaderCredential) !== r.leaderHash) return this.bad()
      if (url.pathname === '/end') { await this.end('LEADER_ENDED'); return reply({ ended: true }) }
      return this.ticket('leader')
    }) } catch (e) { return reply({ error: e instanceof Denial ? e.code : 'UNAVAILABLE' }, e instanceof Denial ? e.status : 503) }
  }
  async webSocketMessage(socket: BandSocket, input: unknown): Promise<void> {
    try { await this.serial(async () => {
      const r = this.requireRoom(), a = socket.deserializeAttachment()
      if (!a?.active) { this.close(socket); return }
      const now = this.clock.now()
      if (now >= a.window + 1000) { a.window = now; a.count = 0 }
      if (++a.count > L.messagesPerSecond) { this.close(socket, 'RATE_LIMIT'); if (a.role === 'leader') this.presence(); return }
      socket.serializeAttachment(a)
      const checked = validateBandSyncMessage(input, a.role === 'leader' ? 'LEADER_TO_SERVER' : 'FOLLOWER_TO_SERVER')
      if (!checked.ok || checked.value.roomCode !== r.roomCode || checked.value.sequence <= a.inbound) {
        this.close(socket); if (a.role === 'leader') this.presence(); return
      }
      const m = checked.value
      a.inbound = m.sequence; socket.serializeAttachment(a)
      r.touched = now
      switch (m.type) {
        case 'HELLO':
          if (m.payload.role !== a.role) { this.close(socket); if (a.role === 'leader') this.presence() }
          else this.snapshot(socket)
          break
        case 'BYE':
          if (a.role === 'leader') await this.end('LEADER_ENDED')
          else this.close(socket, 'BYE')
          break
        case 'STATE':
          r.pending = m.payload.state
          if (now >= r.lastStateAt + L.stateIntervalMs) this.flushState()
          break
        case 'CONTENT': {
          const state = r.pending || r.state
          if (m.payload.contentHash !== state?.contentHash || m.payload.snapshot.songId !== state.songId) { this.close(socket); this.presence(); break }
          if (r.content?.contentHash === m.payload.contentHash) break
          // Content follows the published state; pending scroll remains coalesced.
          r.content = m.payload
          if (r.state?.contentHash !== m.payload.contentHash) {
            this.advance(); for (const s of this.sockets('follower')) this.snapshot(s)
          } else { this.advance(); for (const s of this.sockets('follower')) this.send(s, 'CONTENT', r.content) }
          break
        }
        case 'NEED_CONTENT':
          if (m.payload.contentHash !== (r.pending || r.state)?.contentHash) break
          if (r.content?.contentHash === m.payload.contentHash) {
            this.advance(); for (const s of this.sockets('follower')) this.snapshot(s)
          } else for (const s of this.sockets('leader')) this.send(s, 'NEED_CONTENT', m.payload)
          break
        default: this.close(socket)
      }
    }) } catch { this.close(socket, 'UNAVAILABLE') }
  }
  async webSocketClose(socket: BandSocket): Promise<void> {
    await this.serial(async () => {
      const a = socket.deserializeAttachment()
      this.close(socket, 'DISCONNECTED')
      if (this.room && a?.active && a.role === 'leader') this.presence()
    }).catch(() => { this.close(socket, 'UNAVAILABLE') })
  }
  async webSocketError(socket: BandSocket): Promise<void> { return this.webSocketClose(socket) }
  async alarm(): Promise<void> {
    await this.serial(async () => { if (this.room?.pending && this.clock.now() >= this.room.lastStateAt + L.stateIntervalMs) this.flushState() })
  }
}

interface DirectoryData {
  rooms: { code: string; expires: number }[]
  clients: { hash: string; count: number; window: number }[]
  tickets: { hash: string; roomCode: string; expires: number }[]
}
/** Admission and short-lived socket routing only; conservative room leases last at most six hours. */
export class BandSyncDirectory {
  private tail: Promise<unknown> = Promise.resolve()
  private ctx: { storage: Storage }
  private now: () => number
  constructor(ctx: { storage: Storage }, _env?: unknown, clock = { now: () => Date.now() }) { this.ctx = ctx; this.now = clock.now }
  async fetch(request: Request): Promise<Response> {
    const work = this.tail.then(async () => {
      const p = await body(request), path = new URL(request.url).pathname, now = this.now()
      const d = await this.ctx.storage.get<DirectoryData>('directory') || { rooms: [], clients: [], tickets: [] }
      d.rooms = d.rooms.filter(r => r.expires > now); d.clients = d.clients.filter(c => c.window + 60000 > now); d.tickets = d.tickets.filter(t => t.expires > now)
      let result: unknown
      if (path === '/create' && shape(p, ['client']) && secretShape(p.client)) {
        let c = d.clients.find(c => c.hash === p.client)
        if (!c) {
          if (d.clients.length >= L.directoryBuckets) throw new Denial('LIMIT', 429)
          c = { hash: p.client, count: 0, window: now }; d.clients.push(c)
        }
        if (c.count >= L.createsPerMinute || d.rooms.length >= L.rooms) throw new Denial('LIMIT', 429)
        c.count++
        let code: string
        do { code = generateRoomCode() } while (d.rooms.some(r => r.code === code))
        d.rooms.push({ code, expires: now + L.lifetimeMs }); result = { roomCode: code }
      } else if (path === '/register' && shape(p, ['roomCode', 'hash']) && isRoomCode(p.roomCode) && secretShape(p.hash) && d.rooms.some(r => r.code === p.roomCode)) {
        if (d.tickets.length >= L.rooms * L.tickets) throw new Denial('LIMIT', 429)
        d.tickets.push({ roomCode: p.roomCode, hash: p.hash, expires: now + L.ticketMs }); result = { ok: true }
      } else if (path === '/resolve' && shape(p, ['hash']) && secretShape(p.hash)) {
        const t = d.tickets.find(t => t.hash === p.hash)
        if (!t) throw new Denial()
        d.tickets = d.tickets.filter(x => x !== t); result = { roomCode: t.roomCode }
      } else throw new Denial('INVALID_REQUEST', 400)
      await this.ctx.storage.put('directory', d)
      await this.ctx.storage.setAlarm(now + L.lifetimeMs)
      return reply(result)
    })
    this.tail = work.catch(() => { /* Denials do not stall admission. */ })
    try { return await work } catch (e) { return reply({ error: e instanceof Denial ? e.code : 'UNAVAILABLE' }, e instanceof Denial ? e.status : 503) }
  }
  async alarm(): Promise<void> {
    const work = this.tail.then(async () => {
      const d = await this.ctx.storage.get<DirectoryData>('directory')
      if (!d) return
      const now = this.now()
      d.rooms = d.rooms.filter(r => r.expires > now); d.tickets = d.tickets.filter(t => t.expires > now); d.clients = d.clients.filter(c => c.window + 60000 > now)
      if (!d.rooms.length && !d.clients.length && !d.tickets.length) await this.ctx.storage.deleteAll()
      else { await this.ctx.storage.put('directory', d); await this.ctx.storage.setAlarm(now + L.lifetimeMs) }
    })
    this.tail = work.catch(() => { /* A later alarm can retry cleanup. */ })
    return work
  }
}
