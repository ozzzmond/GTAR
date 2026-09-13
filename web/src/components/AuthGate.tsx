import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authorizedEmail, allowLocalBypass, getUserRole, type UserRole } from '../utils/authPolicy'
import { loadGoogleIdentity, readGoogleSession, requestGoogleSession, refreshGoogleSession, saveGoogleSession, validSession, verifyGoogleSession, type GoogleSession } from '../utils/googleAuth'
import { GtaLogoIcon } from './GtaLogoIcon'

interface AuthState {
  session: GoogleSession | null
  signOut: () => void
  signIn: () => Promise<void>
  ready: boolean
  bypass: boolean
  role: UserRole
  isSuperAdmin: boolean
}
const AuthContext = createContext<AuthState | null>(null)
export function useGoogleAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('Authentication boundary is required.')
  return auth
}
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GoogleSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [bypass, setBypass] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const epoch = useRef(0)
  const refreshing = useRef(false)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const permitted = !!session && validSession(session) && authorizedEmail(session.user.email, import.meta.env.VITE_AUTHORIZED_EMAILS)
  const canBypass = allowLocalBypass(import.meta.env.DEV, window.location.hostname)

  const role: UserRole = useMemo(() => {
    if (bypass && canBypass) return 'SUPER_ADMIN'
    return getUserRole(session?.user?.email, import.meta.env.VITE_ROOT_ADMIN_EMAIL, import.meta.env.VITE_AUTHORIZED_EMAILS)
  }, [session, bypass, canBypass])

  const isSuperAdmin = role === 'SUPER_ADMIN'
  const signOut = useCallback(() => {
    epoch.current++
    saveGoogleSession(null)
    setSession(null); setBypass(false); setChecking(false); setBusy(false); setError('')
  }, [])

  // Attempt silent renewal in the background without user prompts
  const silentRefresh = useCallback(async () => {
    if (!clientId || refreshing.current) return
    const current = session ?? readGoogleSession()
    if (!current || !current.user?.email) return
    const generation = epoch.current
    const accountSub = current.user.sub
    refreshing.current = true
    try {
      const renewed = await refreshGoogleSession(clientId, current)
      // Epoch/account guards: late responses after sign-out or account switch must not re-authenticate
      if (generation !== epoch.current || !readGoogleSession() || renewed.user.sub !== accountSub) {
        return
      }
      saveGoogleSession(renewed)
      setSession(renewed)
    } catch (err) {
      if (generation !== epoch.current) return
      // If offline/network outage during gig, do NOT kick the user out of stage view.
      // If GIS explicitly rejected or unauthorized, sign out.
      const isOffline = typeof window !== 'undefined' && window.navigator ? window.navigator.onLine === false : (typeof navigator !== 'undefined' && navigator.onLine === false)
      if (isOffline) {
        return
      }
      if (err instanceof Error && (err.message.includes('popup blocked') || err.message.includes('Google sign-in failed') || err.message.includes('verified'))) {
        signOut()
      }
    } finally {
      refreshing.current = false
    }
  }, [clientId, session, signOut])

  useEffect(() => {
    const generation = ++epoch.current
    const cached = readGoogleSession()
    if (!cached) { saveGoogleSession(null); setChecking(false) }
    else void verifyGoogleSession(cached).then(verified => {
      if (generation !== epoch.current) return
      saveGoogleSession(verified); setSession(verified)
    }).catch(() => {
      if (generation !== epoch.current) return
      saveGoogleSession(null); setError('Unable to verify your session. Please sign in again.')
    }).finally(() => { if (generation === epoch.current) setChecking(false) })
    return () => { epoch.current++ }
  }, [])

  useEffect(() => {
    if (!clientId) return
    let active = true
    void loadGoogleIdentity().then(() => { if (active) setReady(true) }).catch(() => { if (active) setError('Google sign-in is unavailable. Check your connection and reload.') })
    return () => { active = false }
  }, [clientId])

  // Silent refresh 5 minutes before expiry, plus offline-resilient event listeners
  useEffect(() => {
    if (!session || !clientId) return
    // Refresh 5 minutes before expiry
    const refreshDelay = Math.max(0, session.expiresAt - Date.now() - 300000)
    const refreshTimer = setTimeout(() => { void silentRefresh() }, refreshDelay)

    const onRecheck = () => {
      const isOffline = typeof window !== 'undefined' && window.navigator ? window.navigator.onLine === false : (typeof navigator !== 'undefined' && navigator.onLine === false)
      if (!validSession(session)) {
        if (isOffline) {
          // Live stage performance offline resilience: preserve authenticated stage view
          return
        }
        signOut()
      }
    }
    window.addEventListener('online', onRecheck)
    window.addEventListener('focus', onRecheck)
    document.addEventListener('visibilitychange', onRecheck)
    return () => {
      clearTimeout(refreshTimer)
      window.removeEventListener('online', onRecheck)
      window.removeEventListener('focus', onRecheck)
      document.removeEventListener('visibilitychange', onRecheck)
    }
  }, [session, clientId, silentRefresh, signOut])

  useEffect(() => {
    if (!permitted && !(bypass && canBypass)) return
    let active = true
    let pause: (() => void) | undefined
    void import('../utils/logger').then(({ appLogger }) => {
      if (!active) return
      appLogger.resume()
      pause = () => appLogger.suspend()
    })
    return () => { active = false; pause?.() }
  }, [permitted, bypass, canBypass])

  const signIn = async () => {
    if (!clientId || busy) return
    const generation = ++epoch.current
    setBusy(true); setError('')
    try {
      const next = await requestGoogleSession(clientId)
      if (generation !== epoch.current) return
      saveGoogleSession(next); setBypass(false); setSession(next)
    } catch (failure) { if (generation === epoch.current) setError(failure instanceof Error ? failure.message : 'Sign-in failed.') }
    finally { if (generation === epoch.current) { setBusy(false); setChecking(false) } }
  }

  const copyRequestInfo = () => {
    if (!session) return
    const info = `Access Request:
Email: ${session.user.email}
Time: ${new Date().toISOString()}
User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`
    void navigator.clipboard?.writeText(info).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  if (permitted || (bypass && canBypass)) return <AuthContext.Provider value={{ session: permitted ? session : null, signOut, signIn, ready, bypass, role, isSuperAdmin }}>
    {bypass && <div className="bg-amber-500 text-black px-4 py-2 text-sm">Local development bypass · Drive sync disabled <button className="underline ml-3" onClick={signOut}>Exit bypass</button></div>}
    {children}
  </AuthContext.Provider>

  const denied = !!session && !permitted
  return <main className="min-h-screen flex items-center justify-center bg-[#002B36] text-[#FDF6E3] p-6">
    <section className="w-full max-w-md rounded-3xl bg-[#073642] border border-[#1A4A55] p-8 text-center shadow-2xl">
      <GtaLogoIcon className="w-16 h-16 mx-auto text-[#2AA198] mb-4" />
      <h1 className="text-3xl font-bold">GTAR</h1>
      <p className="text-[#93A1A1] mt-2">Songbook &amp; Live Stage Companion</p>
      <h2 className="text-lg font-semibold mt-8">{denied ? 'Access Denied: Pending Owner Approval' : 'Owner Access'}</h2>
      <p className="text-sm text-[#93A1A1] mt-2 mb-6">
        {denied ?
          `Account ${session.user.email} is signed in, but has not been approved by the songbook owner.` :
          'Access is restricted to authorized owners. Sign in with your approved Google account.'}
      </p>
      {checking ? <p role="status">Verifying your session...</p> : denied ? (
        <div className="space-y-3">
          <button className="w-full rounded-xl bg-[#2AA198] text-[#002B36] font-bold py-3 hover:bg-[#268bd2] transition-colors" onClick={copyRequestInfo}>
            {copied ? 'Copied Request Info!' : 'Copy Request Info'}
          </button>
          <button className="w-full rounded-xl bg-transparent border border-[#93A1A1] text-[#93A1A1] font-semibold py-3 hover:bg-[#002B36] transition-colors" onClick={signOut}>
            Sign Out / Switch Account
          </button>
        </div>
      ) : (
        <button disabled={!ready || busy} className="w-full rounded-xl bg-[#2AA198] text-[#002B36] font-bold py-3 disabled:opacity-50" onClick={() => void signIn()}>
          {busy ? 'Signing in...' : 'Sign In with Google'}
        </button>
      )}
      <p role="status" className="text-sm text-amber-200 mt-4">{error || (!clientId ? 'Google sign-in is not configured. Contact the app owner.' : '')}</p>
      {canBypass && !checking && <button className="mt-6 text-sm underline text-[#93A1A1]" onClick={() => { signOut(); setBypass(true) }}>Continue offline (local development)</button>}
    </section>
  </main>
}
