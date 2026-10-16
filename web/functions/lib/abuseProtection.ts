/** Dormant until an operator approves and configures the external DO namespace. */
export const ABUSE_POLICIES = {
  'session-issue': { limit: 300, windowMs: 60_000, identity: 'anonymous' },
  'session-read': { limit: 600, windowMs: 60_000, identity: 'anonymous' },
  'session-account': { limit: 20, windowMs: 60_000, identity: 'account' },
  'share-create': { limit: 30, windowMs: 60_000, identity: 'account' },
  'share-read': { limit: 120, windowMs: 60_000, identity: 'account' },
  'share-revoke': { limit: 30, windowMs: 60_000, identity: 'account' },
  'sync-read': { limit: 120, windowMs: 60_000, identity: 'account' },
  'sync-write': { limit: 60, windowMs: 60_000, identity: 'account' },
  'metadata': { limit: 10, windowMs: 60_000, identity: 'account' },
  'metadata-budget': { limit: 100, windowMs: 3_600_000, identity: 'account' },
  'ug-fetch': { limit: 60, windowMs: 60_000, identity: 'account' },
} as const

export type AbusePolicy = keyof typeof ABUSE_POLICIES
export interface AbuseEnv {
  API_ABUSE_MODE?: string
  AUTH_SECRET?: string
  API_ABUSE_LIMITER?: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request): Promise<Response> }
  }
}

export function abuseConfiguration(env: AbuseEnv = {}): 'disabled' | 'ready' | 'invalid' {
  if (env.API_ABUSE_MODE === undefined || env.API_ABUSE_MODE === 'off') return 'disabled'
  if (env.API_ABUSE_MODE !== 'durable-v1' || !env.API_ABUSE_LIMITER ||
      typeof env.API_ABUSE_LIMITER.idFromName !== 'function' ||
      typeof env.API_ABUSE_LIMITER.get !== 'function' ||
      typeof env.AUTH_SECRET !== 'string' || env.AUTH_SECRET.trim().length < 32) return 'invalid'
  return 'ready'
}

export function abuseResponse(status: 429 | 503, retryAfter: number): Response {
  return new Response(JSON.stringify({ success: false, status: 'error',
    error: status === 429 ? 'RATE_LIMIT_EXCEEDED' : 'ABUSE_PROTECTION_UNAVAILABLE' }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'Retry-After',
      'Retry-After': String(Math.max(1, Math.ceil(retryAfter))),
    },
  })
}

/** accountId must come from verified server identity, never request headers/body. */
export async function enforceAbuseLimit(env: AbuseEnv = {}, policy: AbusePolicy, accountId?: string): Promise<Response | null> {
  const configuration = abuseConfiguration(env)
  if (configuration === 'disabled') return null
  if (configuration === 'invalid') return abuseResponse(503, 5)
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    const identity = ABUSE_POLICIES[policy].identity
    if (identity === 'account' && !accountId) return abuseResponse(503, 5)
    // Anonymous admission uses one shared bucket. No IP/forwarded headers are trusted.
    const material = JSON.stringify(['gtar-abuse-v1', policy, identity, identity === 'account' ? accountId : 'global'])
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.AUTH_SECRET!),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(material))
    const name = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
    const namespace = env.API_ABUSE_LIMITER!
    const backend = async () => {
      const response = await namespace.get(namespace.idFromName(name)).fetch(new Request(
        `https://abuse.internal/${policy}`, { method: 'POST', signal: AbortSignal.timeout(3000) }))
      if (!response.ok) throw new Error('Limiter unavailable')
      return await response.json() as { allowed?: unknown; retryAfter?: unknown }
    }
    // Bound both headers and JSON even if a transport ignores the abort signal.
    const result = await Promise.race([backend(), new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Limiter deadline exceeded')), 3000)
    })])
    if (result.allowed === true && result.retryAfter === 0) return null
    if (result.allowed === false && typeof result.retryAfter === 'number' &&
        Number.isSafeInteger(result.retryAfter) && result.retryAfter > 0 &&
        result.retryAfter <= Math.ceil(ABUSE_POLICIES[policy].windowMs / 1000)) {
      return abuseResponse(429, result.retryAfter)
    }
    return abuseResponse(503, 5)
  } catch {
    // Never log backend errors, identity, IP, bearer credentials or storage details.
    return abuseResponse(503, 5)
  } finally {
    if (deadline !== undefined) clearTimeout(deadline)
  }
}

interface Counter { start: number; count: number }
interface Transaction {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
}
export interface LimiterStorage {
  transaction<T>(callback: (txn: Transaction) => Promise<T>): Promise<T>
}

/** External Worker DO implementation; intentionally no deployment/config in this PR. */
export class ApiAbuseLimiter {
  private storage: LimiterStorage
  constructor(state: { storage: LimiterStorage }) { this.storage = state.storage }

  async fetch(request: Request): Promise<Response> {
    const policy = new URL(request.url).pathname.slice(1)
    if (request.method !== 'POST' || !Object.hasOwn(ABUSE_POLICIES, policy)) {
      return new Response(null, { status: 400 })
    }
    const { limit, windowMs } = ABUSE_POLICIES[policy as AbusePolicy]
    // Only durable transactional state is authoritative, including after eviction.
    const result = await this.storage.transaction(async txn => {
      const now = Date.now()
      const start = Math.floor(now / windowMs) * windowMs
      const previous = await txn.get<Counter>(policy)
      const counter = previous?.start === start ? previous : { start, count: 0 }
      if (counter.count >= limit) {
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) }
      }
      await txn.put(policy, { start, count: counter.count + 1 })
      return { allowed: true, retryAfter: 0 }
    })
    return Response.json(result)
  }
}
