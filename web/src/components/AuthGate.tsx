import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { allowLocalBypass, getUserRole, type UserRole } from '../utils/authPolicy'
import { loadGoogleIdentity, readGoogleSession, requestGoogleSession, refreshGoogleSession, saveGoogleSession, validSession, verifyGoogleSession, type GoogleSession } from '../utils/googleAuth'
import { GtaLogoIcon } from './GtaLogoIcon'
import { DebugLogsModal } from './DebugLogsModal'

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
  const [isDebugLogsOpen, setIsDebugLogsOpen] = useState(false)
  const epoch = useRef(0)
  const refreshing = useRef(false)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const isPresentationRoute =
    typeof window !== 'undefined' &&
    ((typeof window.location?.pathname === 'string' && window.location.pathname.includes('/stage/present')) ||
      (typeof window.location?.search === 'string' && window.location.search.includes('view=present')) ||
      (typeof window.location?.hash === 'string' && window.location.hash.includes('present')))
  const permitted = !!session && (isPresentationRoute ? validSession(session) : Boolean(session.user?.email))
  const canBypass = allowLocalBypass(import.meta.env.DEV, window.location.hostname)

  const role: UserRole = useMemo(() => {
    if (bypass && canBypass) return 'SUPER_ADMIN'
    if (!session?.user?.email) return 'NONE'
    const r = getUserRole(session.user.email, import.meta.env.VITE_ROOT_ADMIN_EMAIL)
    return r === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER'
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
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('popup blocked') || /network|failed to fetch|load failed/i.test(msg)) {
        // Never sign out on popup blocker or network failure; preserve active session
        return
      }
      if (err instanceof Error && (err.message.includes('Google sign-in failed') || err.message.includes('verified'))) {
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
      saveGoogleSession(verified)
      setSession(verified)
    }).catch(() => {
      if (generation !== epoch.current) return
      saveGoogleSession(null); setError('Unable to verify your session. Please sign in again.')
    }).finally(() => { if (generation === epoch.current) setChecking(false) })
    return () => { epoch.current++ }
  }, [])

  useEffect(() => {
    if (!clientId) return
    let active = true
    void loadGoogleIdentity().then(() => { if (active) setReady(true) }).catch((err) => {
      if (active) {
        setError('Google sign-in is unavailable. Check your connection and reload.')
        void import('../utils/logger').then(({ appLogger }) => {
          appLogger.warn('AuthGate', 'Google Identity Services script load failed (offline or blocked).', String(err))
        })
      }
    })
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
        if (isPresentationRoute) {
          signOut()
        }
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
  }, [session, clientId, silentRefresh, signOut, isPresentationRoute])

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
    } catch (failure) {
      if (generation === epoch.current) {
        const errorMsg = failure instanceof Error ? failure.message : 'Sign-in failed.'
        setError(errorMsg)
        void import('../utils/logger').then(({ appLogger }) => {
          appLogger.error('AuthGate', `Google sign-in attempt failed: ${errorMsg}`, failure instanceof Error ? failure : undefined)
        })
      }
    }
    finally { if (generation === epoch.current) { setBusy(false); setChecking(false) } }
  }

  if (permitted || (bypass && canBypass)) return <AuthContext.Provider value={{ session: permitted ? session : null, signOut, signIn, ready, bypass, role, isSuperAdmin }}>
    {bypass && <div className="bg-amber-500 text-black px-4 py-2 text-sm">Local development bypass · Cloud auth bypassed <button className="underline ml-3" onClick={signOut}>Exit bypass</button></div>}
    {children}
  </AuthContext.Provider>

  return <main className="min-h-screen flex items-center justify-center bg-[#002B36] text-[#FDF6E3] p-6">
    <section className="w-full max-w-md rounded-3xl bg-[#073642] border border-[#1A4A55] p-8 text-center shadow-2xl">
      <GtaLogoIcon className="w-16 h-16 mx-auto text-[#2AA198] mb-4" />
      <h1 className="text-3xl font-bold">GTAR</h1>
      <p className="text-[#93A1A1] mt-2">Songbook &amp; Live Stage Companion</p>
      <h2 className="text-lg font-semibold mt-8">Owner Access</h2>
      <p className="text-sm text-[#93A1A1] mt-2 mb-6">
        Access is restricted to authorized owners. Sign in with your approved Google account.
      </p>
      {checking ? <p role="status">Verifying your session...</p> : (
        <button disabled={!ready || busy} className="w-full rounded-xl bg-[#2AA198] text-[#002B36] font-bold py-3 disabled:opacity-50" onClick={() => void signIn()}>
          {busy ? 'Signing in...' : 'Sign In with Google'}
        </button>
      )}
      <p role="status" className="text-sm text-amber-200 mt-4">{error || (!clientId ? 'Google sign-in is not configured. Contact the app owner.' : '')}</p>
      {canBypass && !checking && <button className="mt-6 text-sm underline text-[#93A1A1]" onClick={() => { signOut(); setBypass(true) }}>Continue offline (local development)</button>}
      {import.meta.env.DEV && (
        <div className="mt-6 pt-4 border-t border-[#1A4A55]/60 flex justify-center">
          <button
            type="button"
            className="text-xs font-mono text-[#2AA198] hover:underline flex items-center gap-1.5 cursor-pointer"
            onClick={() => setIsDebugLogsOpen(true)}
          >
            <span>View Debug Logs</span>
          </button>
        </div>
      )}
      {import.meta.env.DEV && isDebugLogsOpen && (
        <DebugLogsModal isOpen={isDebugLogsOpen} onClose={() => setIsDebugLogsOpen(false)} />
      )}
    </section>
  </main>
}
