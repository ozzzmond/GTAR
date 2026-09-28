export const GOOGLE_SCOPES = 'openid email profile'
export const DURABLE_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
export const SESSION_STORAGE_KEY = 'gtar_auth_session'
export const LEGACY_STORAGE_KEY = 'gtar_google_session'

export type UserRole = 'admin' | 'member'
export type AccessStatus = 'pending' | 'active' | 'denied'

export interface GoogleUser {
  id?: string // GTAR internal UUID
  sub: string // Google sub
  email: string
  name?: string
  picture?: string
  email_verified?: boolean
  role?: UserRole
  access_status?: AccessStatus
}

export interface GoogleSession {
  version: 1
  user: GoogleUser
  authenticatedAt: number
  lastVerifiedAt: number
  localExpiresAt: number
  expiresAt: number // alias for localExpiresAt for backwards compatibility
  token?: string
  idToken?: string
  sessionToken?: string
  role?: UserRole
  access_status?: AccessStatus
}

interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  error?: string
}

interface TokenClientOptions {
  prompt?: string
  hint?: string
}

interface TokenClient {
  requestAccessToken(options?: TokenClientOptions): void
}

interface GISIdInitConfig {
  client_id: string
  callback: (response: { credential?: string; select_by?: string }) => void
  auto_select?: boolean
  cancel_on_tap_outside?: boolean
}

interface GIS {
  accounts: {
    id?: {
      initialize(config: GISIdInitConfig): void
      prompt(momentListener?: (notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean; isDismissedMoment: () => boolean }) => void): void
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void
      cancel(): void
    }
    oauth2: {
      initTokenClient(config: {
        client_id: string
        scope: string
        include_granted_scopes: boolean
        callback: (response: TokenResponse) => void
        error_callback: () => void
      }): TokenClient
    }
  }
}

declare global {
  interface Window {
    google?: GIS
  }
}

export function parseStoredSession(raw: unknown): { session: GoogleSession | null; isExpired: boolean } {
  if (!raw || typeof raw !== 'object') return { session: null, isExpired: false }
  const obj = raw as Record<string, unknown>

  if (!obj.user || typeof obj.user !== 'object') return { session: null, isExpired: false }
  const u = obj.user as Record<string, unknown>
  if (typeof u.sub !== 'string' || !u.sub.trim()) return { session: null, isExpired: false }
  if (typeof u.email !== 'string' || !u.email.trim()) return { session: null, isExpired: false }

  const now = Date.now()
  let localExpiresAt: number
  if (typeof obj.localExpiresAt === 'number' && Number.isFinite(obj.localExpiresAt)) {
    localExpiresAt = obj.localExpiresAt
  } else if (typeof obj.expiresAt === 'number' && Number.isFinite(obj.expiresAt)) {
    localExpiresAt = obj.expiresAt
  } else {
    return { session: null, isExpired: false }
  }

  const authenticatedAt =
    typeof obj.authenticatedAt === 'number' && Number.isFinite(obj.authenticatedAt)
      ? obj.authenticatedAt
      : now
  const lastVerifiedAt =
    typeof obj.lastVerifiedAt === 'number' && Number.isFinite(obj.lastVerifiedAt)
      ? obj.lastVerifiedAt
      : authenticatedAt

  // Authoritative role and access status mapping (backward-compatible: defaults to active for existing sessions)
  const role: UserRole =
    u.role === 'admin' || obj.role === 'admin'
      ? 'admin'
      : 'member'

  const access_status: AccessStatus =
    u.access_status === 'denied' || obj.access_status === 'denied'
      ? 'denied'
      : u.access_status === 'pending' || obj.access_status === 'pending'
      ? 'pending'
      : 'active'

  const session: GoogleSession = {
    version: 1,
    user: {
      id: typeof u.id === 'string' ? u.id : undefined,
      sub: String(u.sub).trim(),
      email: String(u.email).trim().toLowerCase(),
      name: typeof u.name === 'string' ? u.name : undefined,
      picture: typeof u.picture === 'string' ? u.picture : undefined,
      email_verified: u.email_verified !== false,
      role,
      access_status,
    },
    authenticatedAt,
    lastVerifiedAt,
    localExpiresAt,
    expiresAt: localExpiresAt,
    token: typeof obj.token === 'string' ? obj.token : undefined,
    idToken: typeof obj.idToken === 'string' ? obj.idToken : undefined,
    sessionToken: typeof obj.sessionToken === 'string' ? obj.sessionToken : undefined,
    role,
    access_status,
  }

  if (localExpiresAt <= now) {
    return { session, isExpired: true }
  }

  return { session, isExpired: false }
}

export function validSession(session: GoogleSession | null): session is GoogleSession {
  if (!session) return false
  const parsed = parseStoredSession(session)
  return parsed.session !== null && !parsed.isExpired
}

export function isSessionExpired(session: GoogleSession | null): boolean {
  if (!session) return false
  const parsed = parseStoredSession(session)
  return parsed.isExpired
}

export function getStoredSessionStatus(): {
  session: GoogleSession | null
  isExpired: boolean
  isMalformed: boolean
} {
  try {
    let rawStr: string | null = null
    try {
      if (typeof localStorage !== 'undefined') {
        rawStr = localStorage.getItem(SESSION_STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
      }
    } catch { /* ignore */ }
    if (!rawStr) {
      try {
        if (typeof sessionStorage !== 'undefined') {
          rawStr = sessionStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(LEGACY_STORAGE_KEY)
        }
      } catch { /* ignore */ }
    }
    if (!rawStr) return { session: null, isExpired: false, isMalformed: false }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawStr)
    } catch {
      return { session: null, isExpired: false, isMalformed: true }
    }

    const { session, isExpired } = parseStoredSession(parsedJson)
    if (!session) {
      return { session: null, isExpired: false, isMalformed: true }
    }
    return { session, isExpired, isMalformed: false }
  } catch {
    return { session: null, isExpired: false, isMalformed: true }
  }
}

export function createDurableSession(
  user: GoogleUser,
  token?: string,
  now = Date.now(),
  extras?: {
    idToken?: string
    sessionToken?: string
    role?: UserRole
    access_status?: AccessStatus
  }
): GoogleSession {
  const localExpiresAt = now + DURABLE_SESSION_DURATION_MS
  const role: UserRole = extras?.role || user.role || 'member'
  const access_status: AccessStatus = extras?.access_status || user.access_status || 'active'

  return {
    version: 1,
    user: {
      id: user.id,
      sub: user.sub.trim(),
      email: user.email.trim().toLowerCase(),
      name: user.name,
      picture: user.picture,
      email_verified: user.email_verified !== false,
      role,
      access_status,
    },
    authenticatedAt: now,
    lastVerifiedAt: now,
    localExpiresAt,
    expiresAt: localExpiresAt,
    token,
    idToken: extras?.idToken,
    sessionToken: extras?.sessionToken,
    role,
    access_status,
  }
}

export function renewDurableSession(
  current: GoogleSession,
  now = Date.now()
): GoogleSession {
  const localExpiresAt = now + DURABLE_SESSION_DURATION_MS
  return {
    ...current,
    lastVerifiedAt: now,
    localExpiresAt,
    expiresAt: localExpiresAt,
  }
}

export function readGoogleSession(): GoogleSession | null {
  const status = getStoredSessionStatus()
  return status.session && !status.isExpired ? status.session : null
}

export function saveGoogleSession(session: GoogleSession | null) {
  try {
    if (session) {
      const serialized = JSON.stringify(session)
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SESSION_STORAGE_KEY, serialized)
          localStorage.setItem(LEGACY_STORAGE_KEY, serialized)
        }
      } catch { /* ignore */ }
    } else {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(SESSION_STORAGE_KEY)
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        }
      } catch { /* ignore */ }
    }
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SESSION_STORAGE_KEY)
        sessionStorage.removeItem(LEGACY_STORAGE_KEY)
      }
    } catch { /* ignore */ }
  } catch { /* In-memory sign-in still works */ }
}

export async function verifyGoogleSession(session: GoogleSession): Promise<GoogleSession> {
  if (!validSession(session)) throw new Error('Google session expired. Sign in again.')
  if (!session.token) {
    return session
  }
  const profile = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${session.token}` },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })
  if (!profile.ok) throw new Error('Google session could not be verified. Sign in again.')
  const user = await profile.json()
  if (typeof user.sub !== 'string' || typeof user.email !== 'string' || user.email_verified !== true) {
    throw new Error('A verified Google email is required.')
  }
  return {
    ...session,
    user: {
      ...session.user,
      sub: user.sub,
      email: user.email.toLowerCase().trim(),
      name: user.name || session.user.name,
      picture: user.picture || session.user.picture,
      email_verified: true,
    },
    lastVerifiedAt: Date.now(),
    localExpiresAt: Date.now() + DURABLE_SESSION_DURATION_MS,
    expiresAt: Date.now() + DURABLE_SESSION_DURATION_MS,
  }
}

/**
 * Authenticate or register session against Cloudflare Pages Functions server (/api/auth/session).
 * Server verifies Google identity (JWT) and checks authoritative D1 database.
 */
export async function authenticateWithServer(
  idToken: string,
  now = Date.now()
): Promise<GoogleSession> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idToken }),
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })

  if (!res.ok) {
    let errMessage = 'Server authentication failed'
    try {
      const errData = await res.json()
      if (errData?.error) errMessage = errData.error
    } catch { /* ignore */ }
    throw new Error(errMessage)
  }

  const data = (await res.json()) as {
    success: boolean
    user: {
      id: string
      google_sub: string
      email: string
      display_name: string | null
      picture_url: string | null
      role: UserRole
      access_status: AccessStatus
    }
    sessionToken: string
  }

  const u = data.user
  return createDurableSession(
    {
      id: u.id,
      sub: u.google_sub,
      email: u.email,
      name: u.display_name || undefined,
      picture: u.picture_url || undefined,
      email_verified: true,
      role: u.role,
      access_status: u.access_status,
    },
    undefined,
    now,
    {
      idToken,
      sessionToken: data.sessionToken,
      role: u.role,
      access_status: u.access_status,
    }
  )
}

/**
 * Recheck current session status with server (/api/auth/session).
 */
export async function recheckServerSession(
  sessionTokenOrIdToken: string
): Promise<{
  id: string
  google_sub: string
  email: string
  display_name: string | null
  picture_url: string | null
  role: UserRole
  access_status: AccessStatus
}> {
  const res = await fetch('/api/auth/session', {
    headers: {
      Authorization: `Bearer ${sessionTokenOrIdToken}`,
    },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })

  if (!res.ok) {
    let errMessage = 'Server recheck failed'
    try {
      const errData = await res.json()
      if (errData?.error) errMessage = errData.error
    } catch { /* ignore */ }
    throw new Error(errMessage)
  }

  const data = (await res.json()) as {
    success: boolean
    user: {
      id: string
      google_sub: string
      email: string
      display_name: string | null
      picture_url: string | null
      role: UserRole
      access_status: AccessStatus
    }
  }

  return data.user
}

let loading: Promise<void> | undefined
export function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve()
  if (!loading) loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    const timeout = setTimeout(() => {
      script.remove()
      loading = undefined
      reject(new Error('Google sign-in unavailable. Try again.'))
    }, 15000)
    script.onload = () => { clearTimeout(timeout); resolve() }
    script.onerror = () => {
      clearTimeout(timeout)
      script.remove()
      loading = undefined
      reject(new Error('Google sign-in unavailable. Local editing is available.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export interface RequestSessionOptions {
  prompt?: string
  hint?: string
}

/**
 * Requests server-verifiable Google ID token (JWT) via Google Identity Services
 */
export function requestGoogleCredential(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.id) {
      reject(new Error('Google sign-in is still loading. Try again.'))
      return
    }

    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('Sign-in timeout. Please click sign-in again.'))
      }
    }, 60000)

    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          if (response.credential) {
            resolve(response.credential)
          } else {
            reject(new Error('No credential returned from Google.'))
          }
        },
        auto_select: false,
      })

      window.google.accounts.id.prompt((notification) => {
        if (settled) return
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // If One-Tap is suppressed, attempt fallback or wait for user interaction
        }
      })
    } catch (err) {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(err)
      }
    }
  })
}

// Request session via Google Identity Services (GIS oauth2 token client backwards compatibility)
export function requestGoogleSession(clientId: string, options?: RequestSessionOptions): Promise<GoogleSession> {
  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error('Google sign-in is still loading. Try again.'))
      return
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      include_granted_scopes: false,
      error_callback: () => reject(new Error('Sign-in cancelled or popup blocked.')),
      callback: async response => {
        try {
          if (response.error || !response.access_token || !Number.isFinite(Number(response.expires_in))) {
            throw new Error('Google sign-in failed.')
          }
          const profile = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${response.access_token}` },
            signal: AbortSignal.timeout(15000),
            cache: 'no-store',
          })
          if (!profile.ok) throw new Error('Google session could not be verified. Sign in again.')
          const user = await profile.json()
          if (typeof user.sub !== 'string' || typeof user.email !== 'string' || user.email_verified !== true) {
            throw new Error('A verified Google email is required.')
          }
          const session = createDurableSession(
            {
              sub: user.sub,
              email: user.email,
              name: user.name,
              picture: user.picture,
              email_verified: true,
            },
            response.access_token
          )
          resolve(session)
        } catch (error) {
          reject(error)
        }
      },
    })
    const reqOptions: TokenClientOptions = { prompt: options?.prompt ?? 'select_account' }
    if (options?.hint) reqOptions.hint = options.hint
    client.requestAccessToken(reqOptions)
  })
}

// Silently renews an existing session in the background
export async function refreshGoogleSession(clientId: string, currentSession: GoogleSession): Promise<GoogleSession> {
  const renewed = await requestGoogleSession(clientId, { prompt: '', hint: currentSession.user.email })
  return {
    ...renewed,
    authenticatedAt: currentSession.authenticatedAt,
    user: {
      ...currentSession.user,
      sub: renewed.user.sub || currentSession.user.sub,
      email: renewed.user.email || currentSession.user.email,
      name: renewed.user.name || currentSession.user.name,
      picture: renewed.user.picture || currentSession.user.picture,
      email_verified: true,
    },
  }
}
