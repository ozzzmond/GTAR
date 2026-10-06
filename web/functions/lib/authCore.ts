/**
 * GTAR Server-Authoritative Account & Access Control (v1.0.123-dev.3e)
 * Cloudflare Pages Functions + D1 SQLite Core Library
 */

export interface UserRecord {
  id: string
  google_sub: string
  email: string
  display_name: string | null
  picture_url: string | null
  role: 'admin' | 'member'
  access_status: 'pending' | 'active' | 'denied'
  created_at: string
  updated_at: string
  last_login_at: string
}

export interface D1PreparedStatement {
  bind(...args: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta?: unknown }>
  run(): Promise<{ success: boolean; meta?: unknown }>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

export interface AuthEnv {
  DB?: D1Database
  GOOGLE_CLIENT_ID?: string
  VITE_GOOGLE_CLIENT_ID?: string
  BOOTSTRAP_ADMIN_GOOGLE_SUB?: string
  BOOTSTRAP_ADMIN_EMAIL?: string
  AUTH_SECRET?: string
  TEST_MOCK_AUTH?: string
}

export const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  })
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status)
}

/**
 * Base64URL decode helper
 */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  if (typeof atob === 'function') {
    return atob(base64)
  }
  // Node.js fallback
  return Buffer.from(base64, 'base64').toString('binary')
}

/**
 * Base64URL encode helper
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface VerifiedGoogleProfile {
  sub: string
  email: string
  name?: string
  picture?: string
  email_verified: boolean
}

/**
 * In-memory cache for Google JWKS public keys
 */
let cachedJwks: { keys: Array<{ kid: string; n: string; e: string; kty: string; alg: string }> } | null = null
let jwksCacheTime = 0

async function getGoogleJwks(): Promise<Array<{ kid: string; n: string; e: string; kty: string; alg: string }>> {
  const now = Date.now()
  if (cachedJwks && now - jwksCacheTime < 3600_000) {
    return cachedJwks.keys
  }
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    headers: { 'User-Agent': 'GTAR-Cloudflare-Pages' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch Google JWKS: ${res.status}`)
  }
  cachedJwks = (await res.json()) as { keys: Array<{ kid: string; n: string; e: string; kty: string; alg: string }> }
  jwksCacheTime = now
  return cachedJwks.keys
}

/**
 * Server verifies Google identity credential (JWT ID Token)
 * Validates: Issuer, Audience, Signature, Expiration, and non-empty verified Google sub
 */
export async function verifyGoogleIdToken(
  token: string,
  env: AuthEnv,
  now = Date.now()
): Promise<VerifiedGoogleProfile> {
  if (!token || typeof token !== 'string') {
    throw new Error('Credential token is missing or invalid')
  }

  // Handle mock / test tokens in test environment
  if (env.TEST_MOCK_AUTH === 'true' && token.startsWith('test_token:')) {
    const parts = token.slice('test_token:'.length).split(':')
    const [sub, email, name, role] = parts
    return {
      sub: sub || 'test_sub',
      email: (email || 'test@example.com').toLowerCase().trim(),
      name: name || 'Test User',
      picture: undefined,
      email_verified: true,
    }
  }

  const parts = token.trim().split('.')
  if (parts.length !== 3) {
    throw new Error('Malformed JWT structure')
  }

  let header: { alg?: string; kid?: string }
  let payload: {
    iss?: string
    aud?: string
    sub?: string
    email?: string
    name?: string
    picture?: string
    email_verified?: boolean | string
    exp?: number
  }

  try {
    header = JSON.parse(base64UrlDecode(parts[0]))
    payload = JSON.parse(base64UrlDecode(parts[1]))
  } catch {
    throw new Error('Failed to parse JWT payload or header')
  }

  // 1. Verify Issuer
  const validIssuers = ['accounts.google.com', 'https://accounts.google.com']
  if (!payload.iss || !validIssuers.includes(payload.iss)) {
    throw new Error(`Invalid token issuer: ${payload.iss}`)
  }

  // 2. Verify Expiration
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) {
    throw new Error('Google ID token is expired')
  }

  // 3. Verify Audience
  const expectedClientId = env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID
  if (expectedClientId && payload.aud !== expectedClientId) {
    throw new Error(`Token audience mismatch: expected ${expectedClientId}, got ${payload.aud}`)
  }

  // 4. Verify Identity
  if (!payload.sub || typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('Token does not contain a valid Google subject ID')
  }

  if (!payload.email || typeof payload.email !== 'string' || !payload.email.trim()) {
    throw new Error('Token does not contain a valid email address')
  }

  const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
  if (!emailVerified) {
    throw new Error('Google account email is not verified')
  }

  // 5. Verify Cryptographic Signature
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported token algorithm: ${header.alg}`)
  }

  let signatureValid = false
  try {
    const keys = await getGoogleJwks()
    const matchingKey = keys.find((k) => k.kid === header.kid)
    if (matchingKey && typeof crypto !== 'undefined' && crypto.subtle) {
      const cryptoKey = await crypto.subtle.importKey(
        'jwk',
        {
          kty: matchingKey.kty,
          n: matchingKey.n,
          e: matchingKey.e,
          alg: 'RS256',
        },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      )

      const encoder = new TextEncoder()
      const signedData = encoder.encode(`${parts[0]}.${parts[1]}`)
      const rawSig = base64UrlDecode(parts[2])
      const sigBytes = new Uint8Array(rawSig.length)
      for (let i = 0; i < rawSig.length; i++) {
        sigBytes[i] = rawSig.charCodeAt(i)
      }

      signatureValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, signedData)
    }
  } catch {
    // If JWKS fetch or SubtleCrypto fails, fallback to Google tokeninfo verification
    signatureValid = false
  }

  if (!signatureValid) {
    // Upstream fallback verification via Google tokeninfo endpoint
    try {
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (verifyRes.ok) {
        const info = (await verifyRes.json()) as { sub?: string; email?: string; aud?: string; email_verified?: string }
        if (info.sub === payload.sub) {
          signatureValid = true
        }
      }
    } catch {
      // Offline or network error
    }
  }

  if (!signatureValid) {
    throw new Error('Google token signature verification failed')
  }

  return {
    sub: payload.sub.trim(),
    email: payload.email.trim().toLowerCase(),
    name: payload.name,
    picture: payload.picture,
    email_verified: true,
  }
}

/**
 * Evaluates whether a verified Google identity matches the explicit server-configured bootstrap admin
 * "FIRST_LOGIN_WINS_FORBIDDEN"
 * "EXPLICIT_SERVER_SIDE_CONFIGURED_GOOGLE_IDENTITY"
 */
export function isBootstrapAdmin(profile: VerifiedGoogleProfile, env: AuthEnv): boolean {
  const configuredSub = env.BOOTSTRAP_ADMIN_GOOGLE_SUB?.trim()
  if (configuredSub && profile.sub === configuredSub) {
    return true
  }
  const configuredEmail = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  if (configuredEmail && profile.email === configuredEmail) {
    return true
  }
  return false
}

// Internal session token secret (default fallback or server env)
const DEFAULT_AUTH_SECRET = 'gtar_d1_auth_internal_secret_dev_only'

/**
 * Generate HMAC-SHA256 session token
 */
export async function createSessionToken(
  user: UserRecord,
  secret = DEFAULT_AUTH_SECRET,
  durationMs = 30 * 24 * 60 * 60 * 1000
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Date.now()
  const payload = {
    uid: user.id,
    sub: user.google_sub,
    email: user.email,
    role: user.role,
    status: user.access_status,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + durationMs) / 1000),
  }

  const encoder = new TextEncoder()
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)))
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const message = `${headerB64}.${payloadB64}`

  let sigB64: string
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
    sigB64 = base64UrlEncode(new Uint8Array(sig))
  } else {
    // Node crypto fallback
    const cryptoNode = await import('node:crypto')
    const hmac = cryptoNode.createHmac('sha256', secret)
    hmac.update(message)
    sigB64 = hmac.digest('base64url')
  }

  return `${message}.${sigB64}`
}

/**
 * Verify HMAC-SHA256 session token
 */
export async function verifySessionToken(
  token: string,
  secret = DEFAULT_AUTH_SECRET,
  now = Date.now()
): Promise<{ uid: string; sub: string; email: string; role: string; status: string } | null> {
  if (!token || typeof token !== 'string') return null
  const parts = token.trim().split('.')
  if (parts.length !== 3) return null

  const encoder = new TextEncoder()
  const message = `${parts[0]}.${parts[1]}`
  let validSig = false

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      )
      const rawSig = base64UrlDecode(parts[2])
      const sigBytes = new Uint8Array(rawSig.length)
      for (let i = 0; i < rawSig.length; i++) {
        sigBytes[i] = rawSig.charCodeAt(i)
      }
      validSig = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(message))
    } catch {
      return null
    }
  } else {
    try {
      const cryptoNode = await import('node:crypto')
      const hmac = cryptoNode.createHmac('sha256', secret)
      hmac.update(message)
      const expectedSig = hmac.digest('base64url')
      validSig = parts[2] === expectedSig
    } catch {
      return null
    }
  }

  if (!validSig) return null

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= now) {
      return null
    }
    if (!payload.uid || !payload.sub) {
      return null
    }
    return {
      uid: String(payload.uid),
      sub: String(payload.sub),
      email: String(payload.email || ''),
      role: String(payload.role || 'member'),
      status: String(payload.status || 'pending'),
    }
  } catch {
    return null
  }
}

/**
 * D1 Database Operations
 */
export async function findUserByGoogleSub(db: D1Database, googleSub: string): Promise<UserRecord | null> {
  const stmt = db.prepare('SELECT * FROM users WHERE google_sub = ? LIMIT 1').bind(googleSub)
  return (await stmt.first<UserRecord>()) || null
}

export async function findUserById(db: D1Database, id: string): Promise<UserRecord | null> {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(id)
  return (await stmt.first<UserRecord>()) || null
}

export async function insertUser(db: D1Database, user: UserRecord): Promise<void> {
  const stmt = db
    .prepare(
      `INSERT INTO users (id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user.id,
      user.google_sub,
      user.email,
      user.display_name,
      user.picture_url,
      user.role,
      user.access_status,
      user.created_at,
      user.updated_at,
      user.last_login_at
    )
  await stmt.run()
}

export async function updateUserLoginProfile(
  db: D1Database,
  id: string,
  profile: { email: string; display_name?: string | null; picture_url?: string | null },
  nowIso: string
): Promise<void> {
  const stmt = db
    .prepare(
      `UPDATE users
       SET email = ?, display_name = COALESCE(?, display_name), picture_url = COALESCE(?, picture_url), updated_at = ?, last_login_at = ?
       WHERE id = ?`
    )
    .bind(profile.email, profile.display_name || null, profile.picture_url || null, nowIso, nowIso, id)
  await stmt.run()
}

export async function listAllUsers(db: D1Database): Promise<UserRecord[]> {
  const stmt = db.prepare(
    `SELECT id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at
     FROM users
     ORDER BY created_at DESC`
  )
  const res = await stmt.all<UserRecord>()
  return res.results || []
}

export async function getPendingUsersCount(db: D1Database): Promise<number> {
  const stmt = db.prepare(`SELECT count(*) as count FROM users WHERE access_status = 'pending'`)
  const res = await stmt.first<{ count: number }>()
  return Number(res?.count || 0)
}

export async function updateUserAccessStatus(
  db: D1Database,
  id: string,
  status: 'active' | 'denied',
  nowIso: string
): Promise<boolean> {
  const stmt = db
    .prepare(`UPDATE users SET access_status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, nowIso, id)
  const res = await stmt.run()
  return res.success !== false
}

/**
 * Authenticates request and enforces admin privileges against authoritative D1 record
 */
export async function authenticateAdminRequest(
  request: Request,
  env: AuthEnv
): Promise<{ user: UserRecord } | { error: string; status: number }> {
  if (!env.DB) {
    return { error: 'Database binding DB is missing', status: 500 }
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or malformed Authorization header', status: 401 }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return { error: 'Empty bearer token', status: 401 }
  }

  let callerId: string | null = null

  // 1. Try session token first
  const sessionData = await verifySessionToken(token, env.AUTH_SECRET || DEFAULT_AUTH_SECRET)
  if (sessionData) {
    callerId = sessionData.uid
  } else {
    // 2. Try Google ID token
    try {
      const verified = await verifyGoogleIdToken(token, env)
      const user = await findUserByGoogleSub(env.DB, verified.sub)
      if (user) {
        callerId = user.id
      }
    } catch {
      // Invalid token
    }
  }

  if (!callerId) {
    return { error: 'Invalid or expired session token', status: 401 }
  }

  // 3. Query authoritative D1 user record
  const user = await findUserById(env.DB, callerId)
  if (!user) {
    return { error: 'User record not found in authoritative database', status: 401 }
  }

  if (user.role !== 'admin' || user.access_status !== 'active') {
    return { error: 'Forbidden: Admin access required', status: 403 }
  }

  return { user }
}

/**
 * Cloud Songbook Sync Types & Operations
 */
export interface UserSongbookRecord {
  user_id: string
  version: number
  data_json: string
  checksum: string
  updated_at: string
}

/**
 * Authenticates request and enforces active member/admin access against authoritative D1 record
 */
export async function authenticateUserRequest(
  request: Request,
  env: AuthEnv
): Promise<{ user: UserRecord } | { error: string; status: number }> {
  if (!env.DB) {
    return { error: 'Database binding DB is missing', status: 500 }
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or malformed Authorization header', status: 401 }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return { error: 'Empty bearer token', status: 401 }
  }

  let callerId: string | null = null

  // 1. Try session token first
  const sessionData = await verifySessionToken(token, env.AUTH_SECRET || DEFAULT_AUTH_SECRET)
  if (sessionData) {
    callerId = sessionData.uid
  } else {
    // 2. Try Google ID token
    try {
      const verified = await verifyGoogleIdToken(token, env)
      const user = await findUserByGoogleSub(env.DB, verified.sub)
      if (user) {
        callerId = user.id
      }
    } catch {
      // Invalid token
    }
  }

  if (!callerId) {
    return { error: 'Invalid or expired session token', status: 401 }
  }

  // 3. Query authoritative D1 user record
  const user = await findUserById(env.DB, callerId)
  if (!user) {
    return { error: 'User record not found in authoritative database', status: 401 }
  }

  if (user.access_status !== 'active') {
    return { error: 'Forbidden: Active account approval required', status: 403 }
  }

  return { user }
}

export async function findUserSongbook(db: D1Database, userId: string): Promise<UserSongbookRecord | null> {
  const stmt = db.prepare('SELECT user_id, version, data_json, checksum, updated_at FROM user_songbooks WHERE user_id = ? LIMIT 1').bind(userId)
  return (await stmt.first<UserSongbookRecord>()) || null
}

export async function upsertUserSongbook(
  db: D1Database,
  userId: string,
  dataJson: string,
  checksum: string,
  updatedAt: string
): Promise<{ version: number; checksum: string; updated_at: string }> {
  const existing = await findUserSongbook(db, userId)
  const nextVersion = (existing?.version || 0) + 1
  const stmt = db.prepare(
    `INSERT INTO user_songbooks (user_id, version, data_json, checksum, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       version = ?,
       data_json = excluded.data_json,
       checksum = excluded.checksum,
       updated_at = excluded.updated_at`
  ).bind(userId, nextVersion, dataJson, checksum, updatedAt, nextVersion)
  await stmt.run()
  return { version: nextVersion, checksum, updated_at: updatedAt }
}

