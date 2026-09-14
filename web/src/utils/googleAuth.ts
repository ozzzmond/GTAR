export const GOOGLE_SCOPES = 'openid email profile'
const KEY = 'gtar_google_session'
export interface GoogleSession { token: string; expiresAt: number; user: { sub: string; email: string; picture?: string } }
interface TokenResponse { access_token: string; expires_in: number; scope: string; error?: string }
interface TokenClientOptions { prompt?: string; hint?: string }
interface TokenClient { requestAccessToken(options?: TokenClientOptions): void }
interface GIS { accounts: { oauth2: { initTokenClient(config: { client_id: string; scope: string; include_granted_scopes: boolean; callback: (response: TokenResponse) => void; error_callback: () => void }): TokenClient } } }
declare global { interface Window { google?: GIS } }
export function validSession(session: GoogleSession | null): session is GoogleSession { return !!session && session.expiresAt > Date.now() + 30000 }
export function readGoogleSession(): GoogleSession | null {
  try {
    let raw: string | null = null
    try { raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null } catch { /* ignore */ }
    if (!raw) {
      try { raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(KEY) : null } catch { /* ignore */ }
    }
    const value = JSON.parse(raw ?? 'null')
    if (validSession(value) && typeof value.token === 'string' && typeof value.user?.sub === 'string' && typeof value.user?.email === 'string') return value
  } catch { /* Storage unavailable or stale. */ }
  return null
}
export function saveGoogleSession(session: GoogleSession | null) {
  try {
    if (session) {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(session)) } catch { /* ignore */ }
    } else {
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY) } catch { /* ignore */ }
    }
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(KEY) } catch { /* ignore */ }
  } catch { /* In-memory sign-in still works. */ }
}
export async function verifyGoogleSession(session: GoogleSession): Promise<GoogleSession> {
  if (!validSession(session)) throw new Error('Google session expired. Sign in again.')
  const profile = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(15000), cache: 'no-store',
  })
  if (!profile.ok) throw new Error('Google session could not be verified. Sign in again.')
  const user = await profile.json()
  if (typeof user.sub !== 'string' || typeof user.email !== 'string' || user.email_verified !== true) throw new Error('A verified Google email is required.')
  return { ...session, user }
}
let loading: Promise<void> | undefined
export function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve()
  if (!loading) loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    const timeout = setTimeout(() => { script.remove(); loading = undefined; reject(new Error('Google sign-in unavailable. Try again.')) }, 15000)
    script.onload = () => { clearTimeout(timeout); resolve() }
    script.onerror = () => { clearTimeout(timeout); script.remove(); loading = undefined; reject(new Error('Google sign-in unavailable. Local editing is available.')) }
    document.head.appendChild(script)
  })
  return loading
}
export interface RequestSessionOptions {
  prompt?: string
  hint?: string
}
// Request session via Google Identity Services. Interactive prompt by default, or silent when prompt: '' and hint is provided.
export function requestGoogleSession(clientId: string, options?: RequestSessionOptions): Promise<GoogleSession> {
  return new Promise((resolve, reject) => {
    if (!window.google) { reject(new Error('Google sign-in is still loading. Try again.')); return }
    const client = window.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: GOOGLE_SCOPES, include_granted_scopes: false,
      error_callback: () => reject(new Error('Sign-in cancelled or popup blocked.')),
      callback: async response => {
        try {
          if (response.error || !response.access_token || !Number.isFinite(Number(response.expires_in))) throw new Error('Google sign-in failed.')
          const expiresAt = Date.now() + Number(response.expires_in) * 1000
          resolve(await verifyGoogleSession({ token: response.access_token, expiresAt, user: { sub: '', email: '' } }))
        } catch (error) { reject(error) }
      },
    })
    const reqOptions: TokenClientOptions = { prompt: options?.prompt ?? 'select_account' }
    if (options?.hint) reqOptions.hint = options.hint
    client.requestAccessToken(reqOptions)
  })
}
// Silently renews an existing session in the background without user prompts or 2FA alerts
export async function refreshGoogleSession(clientId: string, currentSession: GoogleSession): Promise<GoogleSession> {
  const renewed = await requestGoogleSession(clientId, { prompt: '', hint: currentSession.user.email })
  return {
    ...renewed,
    user: {
      sub: renewed.user.sub || currentSession.user.sub,
      email: renewed.user.email || currentSession.user.email,
      picture: renewed.user.picture || currentSession.user.picture,
    },
  }
}
