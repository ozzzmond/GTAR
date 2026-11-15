import { body, Denial, digest, reply } from './stageCast2Backend'
import { socketTicket } from './bandSyncBackend'
import { isRoomCode } from '../src/utils/bandSyncProtocol'
export { BandSyncHub, BandSyncDirectory } from './bandSyncBackend'

interface Namespace { idFromName(name: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }
interface Env {
  BANDSYNC_MODE?: string; BANDSYNC_ORIGIN?: string
  BANDSYNC_HUB?: Namespace; BANDSYNC_DIRECTORY?: Namespace
}
/** No Pages routing in P1a. Only sanitized protocol bodies and socket headers cross this boundary. */
export default { async fetch(request: Request, env: Env): Promise<Response> {
  if (env.BANDSYNC_MODE !== 'reviewed-v1' || !env.BANDSYNC_HUB || !env.BANDSYNC_DIRECTORY || !env.BANDSYNC_ORIGIN) return reply({ error: 'DISABLED' }, 503)
  try {
    const url = new URL(request.url), origin = request.headers.get('Origin')
    const origins = env.BANDSYNC_ORIGIN.split(',').map(o => o.trim())
    if (!origins.every(o => { try { const u = new URL(o); return u.protocol === 'https:' && u.origin === o } catch { return false } })) throw new Denial()
    if (url.search || !origin || !origins.includes(origin) || request.headers.has('Cookie')) throw new Denial()
    const path = url.pathname
    if (!['/create', '/join', '/ticket', '/end', '/socket'].includes(path) ||
      (path === '/socket' ? request.method !== 'GET' : request.method !== 'POST')) throw new Denial('INVALID_REQUEST', 400)
    const directory = env.BANDSYNC_DIRECTORY.get(env.BANDSYNC_DIRECTORY.idFromName('directory'))
    const hubs = env.BANDSYNC_HUB
    const dir = (path: string, payload: unknown) => directory.fetch(new Request('https://directory.internal' + path, { method: 'POST', body: JSON.stringify(payload) }))
    const ip = request.headers.get('CF-Connecting-IP')
    if (!ip) throw new Denial()
    const client = await digest(ip)
    const admission = await dir('/attempt', { client })
    if (!admission.ok) return admission
    const { attemptId } = await admission.json() as { attemptId: string }
    const execute = async (): Promise<Response> => {
      const headers = new Headers()
      let roomCode: unknown, payload: Record<string, unknown> | undefined
      if (path === '/socket') {
        const ticket = socketTicket(request), resolution = await dir('/resolve', { hash: await digest(ticket) })
        if (!resolution.ok) return resolution
        roomCode = (await resolution.json() as { roomCode: string }).roomCode
        headers.set('Upgrade', 'websocket'); headers.set('Sec-WebSocket-Protocol', `bandsync, ticket.${ticket}`)
      } else {
        payload = await body(request)
        const fields = path === '/create' ? [] : path === '/join' ? ['roomCode'] : ['roomCode', 'leaderCredential']
        if (Object.keys(payload).length !== fields.length || !fields.every(k => Object.hasOwn(payload!, k))) throw new Denial('INVALID_REQUEST', 400)
        if (path === '/create') {
          const reservation = await dir('/create', { client })
          if (!reservation.ok) return reservation
          roomCode = (await reservation.json() as { roomCode: string }).roomCode
          payload = { roomCode }
        } else roomCode = payload.roomCode
      }
      if (!isRoomCode(roomCode)) throw new Denial('INVALID_REQUEST', 400)
      const response = await hubs.get(hubs.idFromName(roomCode)).fetch(new Request('https://bandsync.internal' + path, {
        method: request.method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}),
      }))
      if (response.ok && (path === '/join' || path === '/ticket')) {
        const result = await response.clone().json() as { ticket: string }
        const registered = await dir('/register', { roomCode, hash: await digest(result.ticket) })
        if (!registered.ok) return reply({ error: 'UNAVAILABLE' }, 503)
      }
      if (response.ok && path === '/end') {
        try { await dir('/release', { roomCode }) } catch { /* Hub release and directory lease also cover this slot. */ }
      }
      return response
    }
    let response: Response
    try { response = await execute() }
    catch (e) { response = reply({ error: e instanceof Denial ? e.code : 'UNAVAILABLE' }, e instanceof Denial ? e.status : 503) }
    // Successful/non-credential requests refund their reservation. Failure to settle stays bounded until the minute expires.
    try { await dir('/result', { client, attemptId, failed: response.status === 403 }) } catch { /* Fail closed on the reserved budget. */ }
    return response
  } catch (e) { return reply({ error: e instanceof Denial ? e.code : 'UNAVAILABLE' }, e instanceof Denial ? e.status : 503) }
} }
