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

export interface PromptMomentNotification {
  isDisplayed: () => boolean
  isNotDisplayed: () => boolean
  getNotDisplayedReason?: () => string
  isSkippedMoment: () => boolean
  getSkippedReason?: () => string
  isDismissedMoment: () => boolean
  getDismissedReason?: () => string
  getMomentType?: () => string
}

export interface GsiButtonConfiguration {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  logo_alignment?: 'left' | 'center'
  width?: number | string
  locale?: string
  click_listener?: () => void
}

export interface GISIdInitConfig {
  client_id: string
  callback: (response: { credential?: string; select_by?: string }) => void
  auto_select?: boolean
  cancel_on_tap_outside?: boolean
  prompt_parent_id?: string
  itp_support?: boolean
}

interface GIS {
  accounts: {
    id?: {
      initialize(config: GISIdInitConfig): void
      prompt(momentListener?: (notification: PromptMomentNotification) => void): void
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

function isValidAccessStatus(value: unknown): value is AccessStatus {
  return value === 'active' || value === 'pending' || value === 'denied'
}

function normalizeAccessStatus(primary: unknown, secondary?: unknown): AccessStatus | undefined {
  if (isValidAccessStatus(primary) && isValidAccessStatus(secondary) && primary !== secondary) {
    return undefined
  }
  if (isValidAccessStatus(primary)) return primary
  if (isValidAccessStatus(secondary)) return secondary
  return undefined
}

export class ServerSessionError extends Error {
  status?: number
  isDefinitiveAuthFailure: boolean
  isTransient: boolean

  constructor(
    message: string,
    options: { status?: number; isDefinitiveAuthFailure: boolean; isTransient: boolean }
  ) {
    super(message)
    this.name = 'ServerSessionError'
    this.status = options.status
    this.isDefinitiveAuthFailure = options.isDefinitiveAuthFailure
    this.isTransient = options.isTransient
  }
}

export class GooglePromptSuppressedError extends Error {
  reason: string
  isSuppressed: true

  constructor(message: string, reason = 'unknown') {
    super(message)
    this.name = 'GooglePromptSuppressedError'
    this.reason = reason
    this.isSuppressed = true
  }
}

export class GooglePromptDismissedError extends Error {
  reason: string
  isDismissed: true

  constructor(message: string, reason = 'unknown') {
    super(message)
    this.name = 'GooglePromptDismissedError'
    this.reason = reason
    this.isDismissed = true
  }
}

export function isPromptSuppressed(err: unknown): boolean {
  if (err instanceof GooglePromptSuppressedError) return true
  if (err && typeof err === 'object' && 'isSuppressed' in err) {
    return (err as { isSuppressed?: unknown }).isSuppressed === true
  }
  return false
}

export function isPromptDismissed(err: unknown): boolean {
  if (err instanceof GooglePromptDismissedError) return true
  if (err && typeof err === 'object' && 'isDismissed' in err) {
    return (err as { isDismissed?: unknown }).isDismissed === true
  }
  return false
}

export function isPromptSuppressedOrDismissed(err: unknown): boolean {
  return isPromptSuppressed(err) || isPromptDismissed(err)
}

export function isDefinitiveAuthError(err: unknown): boolean {
  if (err instanceof ServerSessionError) {
    return err.isDefinitiveAuthFailure
  }
  if (err && typeof err === 'object' && 'isDefinitiveAuthFailure' in err) {
    return (err as { isDefinitiveAuthFailure?: unknown }).isDefinitiveAuthFailure === true
  }
  return false
}

export function isTransientAuthError(err: unknown): boolean {
  if (err instanceof ServerSessionError) {
    return err.isTransient
  }
  if (err && typeof err === 'object' && 'isTransient' in err) {
    return (err as { isTransient?: unknown }).isTransient === true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return /network|failed to fetch|fetch failed|load failed|timeout|abort|offline|temporarily unavailable/i.test(msg)
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

  // Authoritative role and access status mapping (never defaults missing access_status to active)
  const role: UserRole =
    u.role === 'admin' || obj.role === 'admin'
      ? 'admin'
      : 'member'

  const access_status: AccessStatus | undefined = normalizeAccessStatus(obj.access_status, u.access_status)

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

/**
 * Returns true if the session carries a server-verifiable credential:
 * either an issued GTAR sessionToken or a Google idToken paired with a server-assigned user.id.
 * Client-only OAuth access tokens (session.token) are NOT server-verifiable.
 */
export function hasServerCredentials(session: GoogleSession | null | undefined): boolean {
  if (!session || typeof session !== 'object') return false
  const hasSessionToken = typeof session.sessionToken === 'string' && session.sessionToken.trim().length > 0
  const hasIdTokenWithServerId =
    typeof session.idToken === 'string' &&
    session.idToken.trim().length > 0 &&
    typeof session.user?.id === 'string' &&
    session.user.id.trim().length > 0
  return hasSessionToken || hasIdTokenWithServerId
}

/**
 * Returns true if the session was issued/verified by the GTAR server and contains
 * explicit server access status metadata (never a legacy client-only OAuth fallback session).
 */
export function isServerBackedSession(session: GoogleSession | null | undefined): session is GoogleSession {
  if (!session || !validSession(session)) return false
  if (!hasServerCredentials(session)) return false
  const resolvedStatus = normalizeAccessStatus(session.access_status, session.user?.access_status)
  return resolvedStatus !== undefined
}

/**
 * Returns true only when the session has server-verifiable credentials AND explicit
 * server approval (access_status === 'active').
 */
export function hasServerApproval(session: GoogleSession | null | undefined): boolean {
  if (!isServerBackedSession(session)) return false
  const resolvedStatus = normalizeAccessStatus(session.access_status, session.user?.access_status)
  return resolvedStatus === 'active'
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
  const access_status: AccessStatus | undefined = normalizeAccessStatus(extras?.access_status, user.access_status)

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
  if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
    throw new ServerSessionError('Google credential token is required', {
      status: 400,
      isDefinitiveAuthFailure: true,
      isTransient: false,
    })
  }

  let res: Response
  try {
    res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error during server authentication'
    throw new ServerSessionError(msg, { isDefinitiveAuthFailure: false, isTransient: true })
  }

  if (!res.ok) {
    let errMessage = 'Server authentication failed'
    try {
      const errData = await res.json()
      if (errData?.error) errMessage = errData.error
    } catch { /* ignore */ }
    const isDefinitive = res.status === 401 || res.status === 403 || res.status === 400
    throw new ServerSessionError(errMessage, {
      status: res.status,
      isDefinitiveAuthFailure: isDefinitive,
      isTransient: !isDefinitive,
    })
  }

  let data: {
    success?: boolean
    user?: {
      id?: string
      google_sub?: string
      email?: string
      display_name?: string | null
      picture_url?: string | null
      role?: UserRole
      access_status?: AccessStatus
    }
    sessionToken?: string
    error?: string
  }
  try {
    data = await res.json()
  } catch {
    throw new ServerSessionError('Malformed server authentication response', {
      status: res.status,
      isDefinitiveAuthFailure: false,
      isTransient: true,
    })
  }

  const u = data?.user
  if (
    data?.success === false ||
    !u ||
    typeof u.id !== 'string' ||
    !u.id.trim() ||
    typeof u.google_sub !== 'string' ||
    !u.google_sub.trim() ||
    typeof u.email !== 'string' ||
    !u.email.trim() ||
    (u.role !== 'admin' && u.role !== 'member') ||
    !isValidAccessStatus(u.access_status) ||
    typeof data.sessionToken !== 'string' ||
    !data.sessionToken.trim()
  ) {
    throw new ServerSessionError(data?.error || 'Invalid server authentication response', {
      status: res.status,
      isDefinitiveAuthFailure: true,
      isTransient: false,
    })
  }

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
  if (!sessionTokenOrIdToken || typeof sessionTokenOrIdToken !== 'string' || !sessionTokenOrIdToken.trim()) {
    throw new ServerSessionError('Missing server session token', {
      status: 401,
      isDefinitiveAuthFailure: true,
      isTransient: false,
    })
  }

  let res: Response
  try {
    res = await fetch('/api/auth/session', {
      headers: {
        Authorization: `Bearer ${sessionTokenOrIdToken}`,
      },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error during server recheck'
    throw new ServerSessionError(msg, { isDefinitiveAuthFailure: false, isTransient: true })
  }

  if (!res.ok) {
    let errMessage = 'Server recheck failed'
    try {
      const errData = await res.json()
      if (errData?.error) errMessage = errData.error
    } catch { /* ignore */ }
    const isDefinitive = res.status === 401 || res.status === 403
    throw new ServerSessionError(errMessage, {
      status: res.status,
      isDefinitiveAuthFailure: isDefinitive,
      isTransient: !isDefinitive,
    })
  }

  let data: {
    success?: boolean
    user?: {
      id?: string
      google_sub?: string
      email?: string
      display_name?: string | null
      picture_url?: string | null
      role?: UserRole
      access_status?: AccessStatus
    }
    error?: string
  }
  try {
    data = await res.json()
  } catch {
    throw new ServerSessionError('Malformed server recheck response', {
      status: res.status,
      isDefinitiveAuthFailure: false,
      isTransient: true,
    })
  }

  if (data?.success === false) {
    throw new ServerSessionError(data?.error || 'Session rejected by server', {
      status: res.status,
      isDefinitiveAuthFailure: true,
      isTransient: false,
    })
  }

  if (!data || typeof data !== 'object' || !('user' in data)) {
    throw new ServerSessionError('Incomplete server recheck response', {
      status: res.status,
      isDefinitiveAuthFailure: false,
      isTransient: true,
    })
  }

  const u = data.user
  if (
    !u ||
    typeof u.id !== 'string' ||
    !u.id.trim() ||
    typeof u.google_sub !== 'string' ||
    !u.google_sub.trim() ||
    typeof u.email !== 'string' ||
    !u.email.trim() ||
    (u.role !== 'admin' && u.role !== 'member') ||
    !isValidAccessStatus(u.access_status)
  ) {
    throw new ServerSessionError('Invalid server session user record', {
      status: res.status,
      isDefinitiveAuthFailure: true,
      isTransient: false,
    })
  }

  return {
    id: u.id,
    google_sub: u.google_sub,
    email: u.email,
    display_name: u.display_name ?? null,
    picture_url: u.picture_url ?? null,
    role: u.role,
    access_status: u.access_status,
  }
}

/**
 * Revoke session on Cloudflare Pages Functions server (/api/auth/logout).
 * Idempotent. Returns true if remote server confirmed revocation, false otherwise.
 */
export async function logoutFromServer(sessionTokenOrIdToken: string): Promise<boolean> {
  if (!sessionTokenOrIdToken || typeof sessionTokenOrIdToken !== 'string') {
    return false
  }
  try {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenOrIdToken.trim()}`,
      },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    })
    if (!res.ok) {
      return false
    }
    const data = (await res.json()) as { success?: boolean; revoked?: boolean }
    return data?.success === true && data?.revoked === true
  } catch {
    return false
  }
}

let loading: Promise<void> | undefined

export type CredentialResponse = { credential?: string; select_by?: string }
export type CredentialListener = (response: CredentialResponse) => void

const credentialListeners = new Set<CredentialListener>()
let isGisInitialized = false
let gisInitializedClientId: string | null = null

export function addCredentialListener(listener: CredentialListener): () => void {
  credentialListeners.add(listener)
  return () => {
    credentialListeners.delete(listener)
  }
}

export function clearCredentialListeners(): void {
  credentialListeners.clear()
}

function dispatchCredentialResponse(response: CredentialResponse): void {
  for (const listener of Array.from(credentialListeners)) {
    try {
      listener(response)
    } catch (err) {
      console.warn('[googleAuth] Error in credential listener:', err)
    }
  }
}

export function resetGoogleIdentityLoader(): void {
  loading = undefined
  credentialListeners.clear()
  isGisInitialized = false
  gisInitializedClientId = null
}

export function loadGoogleIdentity(forceRetry = false): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.accounts?.id) {
    return Promise.resolve()
  }
  if (forceRetry) {
    loading = undefined
    if (typeof document !== 'undefined') {
      const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]')
      if (existing) {
        existing.remove()
      }
    }
  }
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      if (typeof document === 'undefined') {
        resolve()
        return
      }
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      const timeout = setTimeout(() => {
        script.remove()
        loading = undefined
        reject(new Error('Google sign-in unavailable. Try again.'))
      }, 15000)
      script.onload = () => {
        clearTimeout(timeout)
        resolve()
      }
      script.onerror = () => {
        clearTimeout(timeout)
        script.remove()
        loading = undefined
        reject(new Error('Google sign-in unavailable. Local editing is available.'))
      }
      document.head.appendChild(script)
    })
  }
  return loading
}

/**
 * #238: Google Identity Services is initialized once per page (again only for another client id);
 * Google documents initialize() as call-once. Credentials always go to dispatchCredentialResponse:
 * callers register their handlers with addCredentialListener, which returns the cleanup.
 */
export function initializeGoogleIdentity(config: Omit<GISIdInitConfig, 'callback'>): boolean {
  if (typeof window === 'undefined' || !window.google?.accounts?.id?.initialize) {
    return false
  }
  if (isGisInitialized && gisInitializedClientId === config.client_id) return true
  try {
    window.google.accounts.id.initialize({
      ...config,
      callback: dispatchCredentialResponse,
    })
    isGisInitialized = true
    gisInitializedClientId = config.client_id
    return true
  } catch (err) {
    console.warn('[googleAuth] Failed to initialize GIS:', err)
    return false
  }
}

export function renderGoogleButton(
  parent: HTMLElement | null,
  options?: GsiButtonConfiguration
): boolean {
  if (!parent || typeof window === 'undefined' || !window.google?.accounts?.id?.renderButton) {
    return false
  }
  try {
    const defaultOptions: GsiButtonConfiguration = {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: 300,
    }
    window.google.accounts.id.renderButton(parent, { ...defaultOptions, ...options })
    return true
  } catch (err) {
    console.warn('[googleAuth] Failed to render Google button:', err)
    return false
  }
}

export function promptGoogleOneTap(
  momentListener?: (notification: PromptMomentNotification) => void
): boolean {
  if (typeof window === 'undefined' || !window.google?.accounts?.id?.prompt) {
    return false
  }
  try {
    window.google.accounts.id.prompt(momentListener)
    return true
  } catch (err) {
    console.warn('[googleAuth] Failed to prompt One Tap:', err)
    return false
  }
}

export function cancelGoogleOneTap(): void {
  if (typeof window === 'undefined' || !window.google?.accounts?.id?.cancel) {
    return
  }
  try {
    window.google.accounts.id.cancel()
  } catch {
    /* ignore */
  }
}

export interface RequestCredentialOptions {
  timeoutMs?: number
  onPromptMoment?: (notification: PromptMomentNotification) => void
}

/**
 * Requests server-verifiable Google ID token (JWT) via Google Identity Services
 */
export function requestGoogleCredential(
  clientId: string,
  options?: RequestCredentialOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.google?.accounts?.id) {
      reject(new Error('Google sign-in is still loading. Try again.'))
      return
    }

    let settled = false
    const timeoutMs = options?.timeoutMs ?? 60000
    const timeout = setTimeout(() => {
      finish(() => {
        reject(new Error('Sign-in timeout. Please click sign-in again.'))
      })
    }, timeoutMs)

    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      removeListener()
      action()
    }

    const onCredential = (response: CredentialResponse) => {
      finish(() => {
        if (response.credential) {
          resolve(response.credential)
        } else {
          reject(new Error('No credential returned from Google.'))
        }
      })
    }

    const removeListener = addCredentialListener(onCredential)

    try {
      initializeGoogleIdentity({
        client_id: clientId,
        auto_select: false,
        cancel_on_tap_outside: true,
      })

      window.google.accounts.id.prompt((notification) => {
        if (settled) return
        options?.onPromptMoment?.(notification)

        if (notification.isNotDisplayed()) {
          const reason = typeof notification.getNotDisplayedReason === 'function'
            ? notification.getNotDisplayedReason()
            : 'suppressed'
          finish(() => {
            reject(new GooglePromptSuppressedError('Google One Tap prompt was not displayed: ' + reason, reason))
          })
          return
        }

        if (notification.isSkippedMoment()) {
          const reason = typeof notification.getSkippedReason === 'function'
            ? notification.getSkippedReason()
            : 'skipped'
          finish(() => {
            reject(new GooglePromptSuppressedError('Google One Tap prompt was skipped: ' + reason, reason))
          })
          return
        }

        if (notification.isDismissedMoment()) {
          const reason = typeof notification.getDismissedReason === 'function'
            ? notification.getDismissedReason()
            : 'dismissed'
          finish(() => {
            reject(new GooglePromptDismissedError('Google One Tap prompt was dismissed: ' + reason, reason))
          })
          return
        }
      })
    } catch (err) {
      finish(() => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    }
  })
}

export interface RequestSessionOptions {
  prompt?: string
  hint?: string
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
