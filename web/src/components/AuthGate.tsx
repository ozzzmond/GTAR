import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { allowLocalBypass, getUserRole, type UserRole } from '../utils/authPolicy'
import {
  loadGoogleIdentity,
  getStoredSessionStatus,
  requestGoogleSession,
  refreshGoogleSession,
  renewDurableSession,
  saveGoogleSession,
  validSession,
  verifyGoogleSession,
  type GoogleSession,
} from '../utils/googleAuth'
import devLogo from '../assets/dev-logo.png'
import prodLogo from '../assets/prod-logo.png'
import { isDevEnv } from '../utils/env'
import { DebugLogsModal } from './DebugLogsModal'
import { Terminal } from 'lucide-react'

const isDevLogsEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_LOGS === 'true'

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
  const [isExpiredOffline, setIsExpiredOffline] = useState(false)
  const [isDebugLogsOpen, setIsDebugLogsOpen] = useState(false)
  const epoch = useRef(0)
  const refreshing = useRef(false)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const configuredEmails = import.meta.env.VITE_AUTHORIZED_EMAILS as string | undefined

  const isPresentationRoute =
    typeof window !== 'undefined' &&
    ((typeof window.location?.pathname === 'string' && window.location.pathname.includes('/stage/present')) ||
      (typeof window.location?.search === 'string' && window.location.search.includes('view=present')) ||
      (typeof window.location?.hash === 'string' && window.location.hash.includes('present')))

  const role: UserRole = useMemo(() => {
    if (bypass && canBypass) return 'SUPER_ADMIN'
    if (!session?.user?.email) return 'NONE'
    return getUserRole(session.user.email, import.meta.env.VITE_ROOT_ADMIN_EMAIL, configuredEmails)
  }, [session, bypass, configuredEmails])

  const canBypass = allowLocalBypass(import.meta.env.DEV, typeof window !== 'undefined' ? (window.location?.hostname || '') : '')
  const isAuthorized = role !== 'NONE'
  const permitted = !!session && validSession(session) && isAuthorized
  const isSuperAdmin = role === 'SUPER_ADMIN'

  const signOut = useCallback(() => {
    epoch.current++
    saveGoogleSession(null)
    setSession(null)
    setBypass(false)
    setChecking(false)
    setBusy(false)
    setError('')
    setIsExpiredOffline(false)
  }, [])

  // Asynchronous non-blocking background recheck
  const backgroundRecheck = useCallback(async (current: GoogleSession, generation: number) => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const currentRole = getUserRole(current.user.email, import.meta.env.VITE_ROOT_ADMIN_EMAIL, configuredEmails)
      if (currentRole === 'NONE') {
        if (generation === epoch.current) {
          signOut()
          setError('Access revoked. Your account is not on the authorized whitelist.')
        }
        return
      }

      if (current.token) {
        try {
          const verified = await verifyGoogleSession(current)
          if (generation !== epoch.current) return
          if (verified.user.email.toLowerCase() !== current.user.email.toLowerCase()) {
            signOut()
            setError('Session identity mismatch. Please sign in again.')
            return
          }
          const renewed = renewDurableSession(verified)
          saveGoogleSession(renewed)
          setSession(renewed)
          return
        } catch (err) {
          if (generation !== epoch.current) return
          const msg = err instanceof Error ? err.message : String(err)
          if (/network|failed to fetch|load failed|timeout/i.test(msg)) {
            void import('../utils/logger').then(({ appLogger }) => {
              appLogger.warn('AuthGate', 'Background session recheck deferred due to transient network error.', msg)
            })
            return
          }
        }
      }

      if (typeof window !== 'undefined' && window.google && clientId) {
        try {
          const renewed = await refreshGoogleSession(clientId, current)
          if (generation !== epoch.current) return
          if (renewed.user.email.toLowerCase() !== current.user.email.toLowerCase()) {
            signOut()
            setError('Session identity mismatch. Please sign in again.')
            return
          }
          const durable = renewDurableSession(renewed)
          saveGoogleSession(durable)
          setSession(durable)
        } catch (err) {
          if (generation !== epoch.current) return
          void import('../utils/logger').then(({ appLogger }) => {
            appLogger.warn('AuthGate', 'Silent GIS background refresh deferred; local durable session remains active.', String(err))
          })
        }
      }
    } finally {
      refreshing.current = false
    }
  }, [clientId, configuredEmails, signOut])

  // Mount session initialization
  useEffect(() => {
    const generation = ++epoch.current
    const status = getStoredSessionStatus()

    if (status.isMalformed) {
      saveGoogleSession(null)
      if (generation === epoch.current) {
        setError('Corrupt session data detected. Please sign in again.')
        setChecking(false)
      }
      return
    }

    if (status.isExpired) {
      const isOffline =
        typeof window !== 'undefined' && window.navigator && typeof window.navigator.onLine === 'boolean'
          ? window.navigator.onLine === false
          : typeof navigator !== 'undefined' && navigator.onLine === false

      if (generation === epoch.current) {
        if (isOffline) {
          setIsExpiredOffline(true)
          setError('Your 30-day offline stage session has expired. Reconnect to the internet once to renew.')
        } else {
          setError('Your session has expired. Please sign in again.')
        }
        setChecking(false)
      }
      return
    }

    if (!status.session) {
      if (generation === epoch.current) {
        setChecking(false)
      }
      return
    }

    const candidate = status.session
    const candidateRole = getUserRole(candidate.user.email, import.meta.env.VITE_ROOT_ADMIN_EMAIL, configuredEmails)
    if (candidateRole === 'NONE') {
      saveGoogleSession(null)
      if (generation === epoch.current) {
        setError('Access revoked. Your account is not on the authorized whitelist.')
        setChecking(false)
      }
      return
    }

    // Unlock immediately from local durable session
    if (generation === epoch.current) {
      setSession(candidate)
      setChecking(false)
    }

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
    if (!isOffline && clientId) {
      void backgroundRecheck(candidate, generation)
    }

    return () => { epoch.current++ }
  }, [configuredEmails, clientId, backgroundRecheck])

  // Load Google Identity Services SDK
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

  // Periodic offline-resilient event listeners & re-checks
  useEffect(() => {
    if (!session || !clientId) return

    const onRecheck = () => {
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (!validSession(session)) {
        if (isOffline) {
          // Live stage performance offline resilience: preserve active session while offline
          return
        }
        if (isPresentationRoute) {
          signOut()
        }
      } else if (!isOffline) {
        void backgroundRecheck(session, epoch.current)
      }
    }

    window.addEventListener('online', onRecheck)
    window.addEventListener('focus', onRecheck)
    document.addEventListener('visibilitychange', onRecheck)
    return () => {
      window.removeEventListener('online', onRecheck)
      window.removeEventListener('focus', onRecheck)
      document.removeEventListener('visibilitychange', onRecheck)
    }
  }, [session, clientId, signOut, isPresentationRoute, backgroundRecheck])

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
    setBusy(true); setError(''); setIsExpiredOffline(false)
    try {
      const next = await requestGoogleSession(clientId)
      if (generation !== epoch.current) return
      const nextRole = getUserRole(next.user.email, import.meta.env.VITE_ROOT_ADMIN_EMAIL, configuredEmails)
      if (nextRole === 'NONE') {
        saveGoogleSession(null)
        setError(`Access denied. Account ${next.user.email} is not authorized.`)
        return
      }
      saveGoogleSession(next)
      setBypass(false)
      setSession(next)
    } catch (failure) {
      if (generation === epoch.current) {
        const errorMsg = failure instanceof Error ? failure.message : 'Sign-in failed.'
        setError(errorMsg)
        void import('../utils/logger').then(({ appLogger }) => {
          appLogger.error('AuthGate', `Google sign-in attempt failed: ${errorMsg}`, failure instanceof Error ? failure : undefined)
        })
      }
    } finally {
      if (generation === epoch.current) {
        setBusy(false)
        setChecking(false)
      }
    }
  }

  if (permitted || (bypass && canBypass)) return <AuthContext.Provider value={{ session: permitted ? session : null, signOut, signIn, ready, bypass, role, isSuperAdmin }}>
    {bypass && <div className="bg-amber-500 text-black px-4 py-2 text-sm">Local development bypass · Cloud auth bypassed <button className="underline ml-3" onClick={signOut}>Exit bypass</button></div>}
    {children}
  </AuthContext.Provider>

  return <main className="min-h-screen flex items-center justify-center bg-[#002B36] text-[#FDF6E3] p-6">
    <section className="w-full max-w-md rounded-3xl bg-[#073642] border border-[#1A4A55] p-8 text-center shadow-2xl">
      <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-[#002B36] border border-[#1A4A55] p-1 shadow-inner flex items-center justify-center">
        <img
          src={isDevEnv ? devLogo : prodLogo}
          alt={isDevEnv ? 'GTAR Dev Logo' : 'GTAR Logo'}
          className="w-full h-full object-contain rounded-xl"
        />
      </div>
      <h1 className="text-3xl font-bold">GTAR</h1>
      <p className="text-[#93A1A1] mt-2">Songbook &amp; Live Stage Companion</p>
      <h2 className="text-lg font-semibold mt-8">Owner Access</h2>
      <p className="text-sm text-[#93A1A1] mt-2 mb-6">
        Access is restricted to authorized owners. Sign in with your approved Google account.
      </p>
      {isExpiredOffline && (
        <div className="p-3 mb-4 rounded-xl bg-[#B58900]/15 border border-[#B58900]/40 text-[#EEE8D5] text-xs text-left">
          <p className="font-bold text-[#B58900] mb-1">Offline Session Expired</p>
          <p>Your 30-day offline stage session has expired. Reconnect to the internet once to renew.</p>
        </div>
      )}
      {checking ? <p role="status">Verifying your session...</p> : (
        <button disabled={!ready || busy} className="w-full rounded-xl bg-[#2AA198] text-[#002B36] font-bold py-3 disabled:opacity-50 cursor-pointer" onClick={() => void signIn()}>
          {busy ? 'Signing in...' : 'Sign In with Google'}
        </button>
      )}
      <p role="status" className="text-sm text-amber-200 mt-4">{error || (!clientId ? 'Google sign-in is not configured. Contact the app owner.' : '')}</p>
      {canBypass && !checking && <button className="mt-6 text-sm underline text-[#93A1A1] cursor-pointer" onClick={() => { signOut(); setBypass(true) }}>Continue offline (local development)</button>}
      {isDevLogsEnabled && (
        <div className="mt-6 pt-4 border-t border-[#1A4A55]/60 flex justify-center">
          <button
            type="button"
            title="View Debug Logs"
            aria-label="View Debug Logs"
            className="px-3.5 py-1.5 rounded-xl bg-[#002B36] hover:bg-[#1A4A55] text-[#2AA198] hover:text-[#35B8AD] border border-[#1A4A55] hover:border-[#2AA198]/60 text-xs font-mono font-medium flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-95"
            onClick={() => setIsDebugLogsOpen(true)}
          >
            <Terminal className="w-3.5 h-3.5 text-[#2AA198]" />
            <span>View Debug Logs</span>
          </button>
        </div>
      )}
      {isDevLogsEnabled && isDebugLogsOpen && (
        <DebugLogsModal isOpen={isDebugLogsOpen} onClose={() => setIsDebugLogsOpen(false)} />
      )}
    </section>
  </main>
}
