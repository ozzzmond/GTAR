import { authenticateUserRequest } from '../functions/lib/authCore.ts'
import type { AuthEnv } from '../functions/lib/authCore.ts'
import { body, Denial, digest, reply } from './stageCast2Backend.ts'
export { StageCast2Hub } from './stageCast2Backend.ts'

interface Env extends AuthEnv {
  CAST2_MODE?: string
  CAST2_ORIGIN?: string
  CAST2_HUB?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
}
type Authenticate = typeof authenticateUserRequest

/** Separate dormant entrypoint; auth injection is test-only, never an environment bypass. */
export function createStageCast2Worker(authenticate: Authenticate = authenticateUserRequest) {
  return { async fetch(request: Request, env: Env): Promise<Response> {
    if (env.CAST2_MODE !== 'reviewed-v1' || !env.CAST2_HUB || !env.CAST2_ORIGIN) return reply({ error: 'DISABLED' }, 503)
    try {
      const url = new URL(request.url)
      const allowedOrigins = (env.CAST2_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
      const origin = request.headers.get('Origin')
      if (url.search || !origin || !allowedOrigins.includes(origin) || !origin.startsWith('https://')) return reply({ error: 'DENIED' }, 403)
      const ip = request.headers.get('CF-Connecting-IP')
      if (!ip) return reply({ error: 'DENIED' }, 403)
      const path = url.pathname.replace(/^\/cast2-api/, '')
      if (!['/create', '/claim', '/decide', '/status', '/ticket', '/revoke', '/socket'].includes(path) ||
        (path === '/socket' ? request.method !== 'GET' : request.method !== 'POST')) return reply({ error: 'INVALID_REQUEST' }, 400)
      const headers = new Headers({ 'x-cast-client': await digest(ip) })
      let payload: Record<string, unknown> | undefined
      if (path === '/socket') {
        headers.set('Upgrade', request.headers.get('Upgrade') || '')
        headers.set('Sec-WebSocket-Protocol', request.headers.get('Sec-WebSocket-Protocol') || '')
      } else {
        payload = await body(request)
        if (path === '/claim' || payload.role === 'controller') {
          const result = await authenticate(request, env)
          if ('error' in result || !result.user.id || result.user.access_status !== 'active') return reply({ error: 'AUTH_REQUIRED' }, 401)
          headers.set('x-cast-owner', result.user.id)
        }
      }
      // Never forward caller-supplied internal headers, GTAR tokens, cookies or OAuth credentials.
      return await env.CAST2_HUB.get(env.CAST2_HUB.idFromName('stage-cast2-v1')).fetch(new Request('https://cast2.internal' + path, {
        method: request.method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}),
      }))
    } catch (error) { return reply({ error: error instanceof Denial ? error.code : 'UNAVAILABLE' }, error instanceof Denial ? error.status : 503) }
  } }
}
export default createStageCast2Worker()
