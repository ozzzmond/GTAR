import { isPresentationLocation } from '../utils/presentationRoute'
import { AuthContext, useOptionalGoogleAuth } from '../utils/authContext'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { allowLocalBypass, type UserRole } from '../utils/authPolicy'
import {
  loadGoogleIdentity,
  getStoredSessionStatus,
  requestGoogleCredential,
  authenticateWithServer,
  recheckServerSession,
  logoutFromServer,
  saveGoogleSession,
  validSession,
  isServerBackedSession,
  hasServerApproval,
  isDefinitiveAuthError,
  isTransientAuthError,
  initializeGoogleIdentity,
  addCredentialListener,
  renderGoogleButton,
  cancelGoogleOneTap,
  isPromptSuppressedOrDismissed,
  type GoogleSession,
  type AccessStatus,
} from '../utils/googleAuth'
import { sharedCatalogService } from '../utils/sharedCatalogService'
import devLogo from '../assets/dev-logo.png'
import prodLogo from '../assets/prod-logo.png'
import { isDevEnv } from '../utils/env'
import { DebugLogsModal } from './DebugLogsModal'
import { Terminal, Clock, ShieldX, RefreshCw } from 'lucide-react'

const isDevLogsEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_LOGS === 'true'

export function useGoogleAuth() {
  const auth = useOptionalGoogleAuth()
  if (!auth) throw new Error('Authentication boundary is required.')
  return auth
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GoogleSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [ready, setReady] = useState(false)
  const [scriptLoadFailed, setScriptLoadFailed] = useState(false)
  const [bypass, setBypass] = useState(false)
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isExpiredOffline, setIsExpiredOffline] = useState(false)
  const [isDebugLogsOpen, setIsDebugLogsOpen] = useState(false)
  const [gisRendered, setGisRendered] = useState(false)
  const isMountedRef = useRef(true)
  const epoch = useRef(0)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Capturing the mount value would revive stale async work.
      epoch.current++
    }
  }, [])
  const refreshing = useRef(false)
  const lastRecheckTimestamp = useRef<number>(0)
  const lastManualCheckRef = useRef<number>(0)
  const inFlightCredentialRef = useRef<string | null>(null)
  const gisRenderedRef = useRef(false)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  const isPresentationRoute =
    typeof window !== 'undefined' && isPresentationLocation(window.location)

  const canBypass = allowLocalBypass(import.meta.env.DEV, typeof window !== 'undefined' ? (window.location?.hostname || '') : '')

  const accessStatus: AccessStatus = useMemo(() => {
    if (bypass && canBypass) return 'active'
    if (!session) return 'pending'
    if (session.access_status === 'denied' || session.user?.access_status === 'denied') return 'denied'
    if (hasServerApproval(session)) return 'active'
    return 'pending'
  }, [bypass, canBypass, session])

  const role: UserRole = useMemo(() => {
    if (bypass && canBypass) return 'SUPER_ADMIN'
    if (!session?.user?.email) return 'NONE'
    // Server D1 authoritative role has precedence
    if (session.role === 'admin') return 'SUPER_ADMIN'
    if (session.role === 'member') return 'USER'
    if (session.user.role === 'admin') return 'SUPER_ADMIN'
    if (session.user.role === 'member') return 'USER'
    // No server role: least privilege; the client never elevates from local data
    return 'USER'
  }, [session, bypass, canBypass])

  const isSuperAdmin = role === 'SUPER_ADMIN'
  const permitted = !!session && validSession(session) && hasServerApproval(session) && accessStatus === 'active'

  const sessionRef = useRef(session)
  sessionRef.current = session

  const signOut = useCallback(() => {
    epoch.current++
    inFlightCredentialRef.current = null
    cancelGoogleOneTap()
    gisRenderedRef.current = false
    setGisRendered(false)
    const cur = sessionRef.current
    const token = cur?.sessionToken || cur?.idToken
    const oldAccountId = cur?.user?.id || (cur?.user?.email ? cur.user.email.trim().toLowerCase() : null) || sharedCatalogService.getAccount()
    saveGoogleSession(null)
    if (oldAccountId) {
      sharedCatalogService.clearAccountCache(oldAccountId).catch((err) => {
        console.warn('[AuthGate] Failed to clear account catalog cache on signOut:', err)
      })
    }
    sharedCatalogService.setAccount(null)
    setSession(null)
    setBypass(false)
    setChecking(false)
    setCheckingStatus(false)
    setBusy(false)
    setError('')
    setStatusMessage('')
    setIsExpiredOffline(false)

    if (token) {
      logoutFromServer(token).catch((err) => {
        console.warn('[AuthGate] Remote session revocation failed or network error:', err)
      })
    }
  }, [])

  // Asynchronous non-blocking background recheck with authoritative server D1
  const backgroundRecheck = useCallback(async (current: GoogleSession, generation: number) => {
    // Pending or denied users must not be polled in background
    if (
      current.access_status === 'pending' ||
      current.access_status === 'denied' ||
      current.user?.access_status === 'pending' ||
      current.user?.access_status === 'denied'
    ) {
      return
    }

    const now = Date.now()
    if (now - lastRecheckTimestamp.current < 30_000) return
    if (refreshing.current) return
    refreshing.current = true
    lastRecheckTimestamp.current = now

    try {
      const token = current.sessionToken || current.idToken
      if (!token || !isServerBackedSession(current)) {
        if (generation === epoch.current) {
          const invalidAccountId =
            current.user?.id ||
            (current.user?.email ? current.user.email.trim().toLowerCase() : null) ||
            sharedCatalogService.getAccount()
          saveGoogleSession(null)
          if (invalidAccountId) {
            sharedCatalogService.clearAccountCache(invalidAccountId).catch(() => {})
          }
          sharedCatalogService.setAccount(null)
          setSession(null)
          setBypass(false)
          setError('Your session requires server verification. Please sign in again.')
        }
        return
      }

      try {
        const serverUser = await recheckServerSession(token)
        if (generation !== epoch.current) return

        if (
          (serverUser.google_sub && current.user?.sub && serverUser.google_sub.trim() !== current.user.sub.trim()) ||
          (serverUser.email && current.user?.email && serverUser.email.trim().toLowerCase() !== current.user.email.trim().toLowerCase())
        ) {
          const mismatchedAccountId =
            current.user?.id ||
            (current.user?.email ? current.user.email.trim().toLowerCase() : null) ||
            sharedCatalogService.getAccount()
          saveGoogleSession(null)
          if (mismatchedAccountId) {
            sharedCatalogService.clearAccountCache(mismatchedAccountId).catch(() => {})
          }
          sharedCatalogService.setAccount(null)
          setSession(null)
          setBypass(false)
          setError('Session identity mismatch. Please sign in again.')
          return
        }

        const isIdentical =
          current.access_status === serverUser.access_status &&
          current.role === serverUser.role &&
          current.user.id === serverUser.id &&
          current.user.name === (serverUser.display_name || current.user.name) &&
          current.user.picture === (serverUser.picture_url || current.user.picture)

        const updated: GoogleSession = {
          ...current,
          user: {
            ...current.user,
            id: serverUser.id,
            role: serverUser.role,
            access_status: serverUser.access_status,
            name: serverUser.display_name || current.user.name,
            picture: serverUser.picture_url || current.user.picture,
          },
          role: serverUser.role,
          access_status: serverUser.access_status,
          lastVerifiedAt: Date.now(),
        }

        if (current.access_status === 'active' && (serverUser.access_status === 'denied' || serverUser.access_status === 'pending')) {
          const revokedAccountId = serverUser.id || current.user?.id || (current.user?.email ? current.user.email.trim().toLowerCase() : null)
          if (revokedAccountId) {
            sharedCatalogService.clearAccountCache(revokedAccountId).catch(() => {})
          }
          sharedCatalogService.setAccount(null)
          setBypass(false)
        }

        saveGoogleSession(updated)
        if (!isIdentical) {
          setSession(updated)
        }
        return
      } catch (err) {
        if (generation !== epoch.current) return
        const msg = err instanceof Error ? err.message : String(err)
        if (!isDefinitiveAuthError(err) && isTransientAuthError(err)) {
          void import('../utils/logger').then(({ appLogger }) => {
            appLogger.warn('AuthGate', 'Background server recheck deferred due to transient network error.', msg)
          })
          return
        }
        if (isDefinitiveAuthError(err)) {
          const revokedAccountId =
            current.user?.id ||
            (current.user?.email ? current.user.email.trim().toLowerCase() : null) ||
            sharedCatalogService.getAccount()
          saveGoogleSession(null)
          if (revokedAccountId) {
            sharedCatalogService.clearAccountCache(revokedAccountId).catch(() => {})
          }
          sharedCatalogService.setAccount(null)
          setSession(null)
          setBypass(false)
          setError(msg || 'Your session is no longer valid. Please sign in again.')
          return
        }
        return
      }
    } finally {
      refreshing.current = false
    }
  }, [])

  // Explicit check status for pending users
  const checkStatus = useCallback(async () => {
    if (!session || checkingStatus || refreshing.current) return
    const now = Date.now()
    if (now - lastManualCheckRef.current < 3000) {
      return
    }
    lastManualCheckRef.current = now
    const generation = epoch.current
    refreshing.current = true
    setCheckingStatus(true)
    setStatusMessage('Checking approval status...')
    setError('')
    try {
      const token = session.sessionToken || session.idToken
      if (token && isServerBackedSession(session)) {
        const serverUser = await recheckServerSession(token)
        if (generation !== epoch.current) return
        const updated: GoogleSession = {
          ...session,
          user: {
            ...session.user,
            id: serverUser.id,
            role: serverUser.role,
            access_status: serverUser.access_status,
          },
          role: serverUser.role,
          access_status: serverUser.access_status,
          lastVerifiedAt: Date.now(),
        }
        saveGoogleSession(updated)
        setSession(updated)
        if (serverUser.access_status === 'active') {
          setStatusMessage('Access granted! Unlocking...')
        } else if (serverUser.access_status === 'denied') {
          setStatusMessage('')
          setError('Access has been denied by an administrator.')
        } else {
          setStatusMessage('Your account is still awaiting approval.')
        }
      } else {
        saveGoogleSession(null)
        sharedCatalogService.setAccount(null)
        setSession(null)
        setBypass(false)
        setStatusMessage('')
        setError('No active server token. Please sign in again to verify.')
      }
    } catch (err) {
      if (generation !== epoch.current) return
      const msg = err instanceof Error ? err.message : 'Unable to check status. Network unavailable.'
      if (isDefinitiveAuthError(err)) {
        saveGoogleSession(null)
        sharedCatalogService.setAccount(null)
        setSession(null)
        setBypass(false)
        setStatusMessage('')
        setError(msg || 'Your session is no longer valid. Please sign in again.')
        return
      }
      setError(msg)
      setStatusMessage('')
    } finally {
      refreshing.current = false
      if (generation === epoch.current) setCheckingStatus(false)
    }
  }, [session, checkingStatus])

  // Centralized session exchange with backend Cloudflare Pages server
  const exchangeCredential = useCallback(async (idToken: string, gen: number) => {
    if (!idToken || inFlightCredentialRef.current === idToken) return
    inFlightCredentialRef.current = idToken

    try {
      const serverSession = await authenticateWithServer(idToken)
      if (!isMountedRef.current || gen !== epoch.current || !serverSession) return
      if (!isServerBackedSession(serverSession)) {
        saveGoogleSession(null)
        throw new Error('Server authentication did not return a verifiable session.')
      }

      saveGoogleSession(serverSession)
      setBypass(false)
      setSession(serverSession)
    } catch (failure) {
      if (isMountedRef.current && gen === epoch.current) {
        const errorMsg = failure instanceof Error ? failure.message : 'Sign-in failed.'
        setError(errorMsg)
        void import('../utils/logger').then(({ appLogger }) => {
          appLogger.error('AuthGate', `Google sign-in attempt failed: ${errorMsg}`, failure instanceof Error ? failure : undefined)
        })
      }
    } finally {
      inFlightCredentialRef.current = null
      if (isMountedRef.current && gen === epoch.current) {
        setBusy(false)
        setChecking(false)
      }
    }
  }, [])

  const onGisCredentialResponse = useCallback((idToken: string) => {
    if (!idToken || inFlightCredentialRef.current === idToken) return
    const gen = ++epoch.current
    setBusy(true)
    setError('')
    setStatusMessage('')
    setIsExpiredOffline(false)
    void exchangeCredential(idToken, gen)
  }, [exchangeCredential])

  // Mount session initialization
  useEffect(() => {
    // Preserve incoming QR / deep-link share token during authentication workflow
    try {
      if (typeof window !== 'undefined' && window.location?.search) {
        const urlParams = new URLSearchParams(window.location.search)
        const shareParam = urlParams.get('share')
        if (shareParam) {
          if (/^[a-f0-9]{16,64}$/i.test(shareParam)) {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('gtar_pending_share_token', shareParam.toLowerCase())
            }
          } else {
            // Malformed token: clear any stored pending token and clean URL
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.removeItem('gtar_pending_share_token')
            }
            try {
              const cleanUrl = new URL(window.location.href)
              cleanUrl.searchParams.delete('share')
              window.history.replaceState({}, document.title, cleanUrl.pathname + (cleanUrl.search || ''))
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }

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
    if (!isServerBackedSession(candidate)) {
      saveGoogleSession(null)
      if (generation === epoch.current) {
        setSession(null)
        setError('Your session requires server verification. Please sign in again.')
        setChecking(false)
      }
      return
    }

    // Unlock immediately from local server-backed durable session
    if (generation === epoch.current) {
      setSession(candidate)
      setChecking(false)
    }

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
    if (
      !isOffline &&
      candidate.access_status !== 'pending' &&
      candidate.access_status !== 'denied' &&
      candidate.user?.access_status !== 'pending' &&
      candidate.user?.access_status !== 'denied'
    ) {
      // StrictMode replays mount effects before this microtask. Only the live
      // generation may start a request; otherwise its result would be discarded.
      void Promise.resolve().then(() => {
        if (generation === epoch.current) void backgroundRecheck(candidate, generation)
      })
    }

    // This is a generation counter, not a DOM ref: invalidate the current epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Capturing the mount value would revive stale async work.
    return () => { isMountedRef.current = false; epoch.current++ }
  }, [backgroundRecheck])

  // Load Google Identity Services SDK
  const loadSdk = useCallback((forceRetry = false) => {
    if (!clientId) return () => {}
    setScriptLoadFailed(false)
    let active = true
    loadGoogleIdentity(forceRetry)
      .then(() => {
        if (active) {
          setReady(true)
          setScriptLoadFailed(false)
        }
      })
      .catch((err) => {
        if (active) {
          setScriptLoadFailed(true)
          setError('Google sign-in is unavailable. Check your connection and reload.')
          void import('../utils/logger').then(({ appLogger }) => {
            appLogger.warn('AuthGate', 'Google Identity Services script load failed (offline or blocked).', String(err))
          })
        }
      })
    return () => { active = false }
  }, [clientId])

  useEffect(() => {
    return loadSdk()
  }, [loadSdk])

  // Initialize GIS and render persistent sign-in button container
  useEffect(() => {
    if (!ready || !clientId || session || bypass || checking) return
    const container = document.getElementById('google-signin-button')
    if (!container) return

    let removeListener: (() => void) | undefined
    try {
      removeListener = addCredentialListener((response) => {
        if (response?.credential) {
          onGisCredentialResponse(response.credential)
        }
      })
      initializeGoogleIdentity({
        client_id: clientId,
        callback: (response) => {
          if (response?.credential) {
            onGisCredentialResponse(response.credential)
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      })
      renderGoogleButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 320,
      })
      gisRenderedRef.current = true
      setGisRendered(container.children.length > 0)
    } catch (err) {
      void import('../utils/logger').then(({ appLogger }) => {
        appLogger.warn('AuthGate', 'Failed to render Google Identity Services button', String(err))
      })
    }
    return () => {
      removeListener?.()
    }
  }, [ready, clientId, session, bypass, checking, onGisCredentialResponse])

  // Periodic offline-resilient event listeners & re-checks
  useEffect(() => {
    if (!session || !clientId) return
    if (
      session.access_status === 'pending' ||
      session.access_status === 'denied' ||
      session.user?.access_status === 'pending' ||
      session.user?.access_status === 'denied'
    ) {
      return
    }

    const onRecheck = () => {
      const now = Date.now()
      if (now - lastRecheckTimestamp.current < 60_000) return

      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (!validSession(session) || !isServerBackedSession(session)) {
        if (isOffline && validSession(session)) {
          return
        }
        if (!isOffline || !isServerBackedSession(session) || isPresentationRoute) {
          signOut()
          setError('Your session has expired. Please sign in again.')
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

  // #204 S2: capture already runs from startup (main.tsx); here the signed-in account's
  // identifiers are registered so exports redact them.
  const sessionUserId = session?.user?.id
  const sessionUserSub = session?.user?.sub
  useEffect(() => {
    if (!sessionUserId && !sessionUserSub) return
    void import('../utils/logger').then(({ registerRedactedIdentifiers }) => registerRedactedIdentifiers(sessionUserId, sessionUserSub))
  }, [sessionUserId, sessionUserSub])

  const signIn = async () => {
    if (!clientId || busy) return
    if (bypass) {
      setBypass(false)
      return
    }
    const gen = ++epoch.current
    setBusy(true)
    setError('')
    setStatusMessage('')
    setIsExpiredOffline(false)

    try {
      const container = document.getElementById('google-signin-button')
      const renderedBtn = container?.querySelector('button, [role="button"]') as HTMLElement | null
      if (renderedBtn && typeof renderedBtn.click === 'function') {
        renderedBtn.click()
        return
      }

      const idToken = await requestGoogleCredential(clientId)
      if (gen !== epoch.current) return
      await exchangeCredential(idToken, gen)
    } catch (failure) {
      if (gen === epoch.current) {
        if (isPromptSuppressedOrDismissed(failure)) {
          // Google prompt was suppressed (cooldown) or dismissed; keep manual sign-in / GIS button ready
          setBusy(false)
          return
        }
        const errorMsg = failure instanceof Error ? failure.message : 'Sign-in failed.'
        setError(errorMsg)
        void import('../utils/logger').then(({ appLogger }) => {
          appLogger.error('AuthGate', `Google sign-in attempt failed: ${errorMsg}`, failure instanceof Error ? failure : undefined)
        })
        setBusy(false)
      }
    }
  }

  // Active / Approved access OR Local Dev Bypass: render application
  if (permitted || (bypass && canBypass)) {
    return (
      <AuthContext.Provider
        value={{
          session: permitted ? session : null,
          signOut,
          signIn,
          checkStatus,
          ready,
          bypass,
          role,
          isSuperAdmin,
          accessStatus,
        }}
      >
        {bypass && (
          <div className="bg-amber-500 text-black px-4 py-2 text-sm">
            Local development bypass · Cloud auth bypassed{' '}
            <button className="underline ml-3 cursor-pointer" onClick={signOut}>
              Exit bypass
            </button>
          </div>
        )}
        {children}
      </AuthContext.Provider>
    )
  }

  // Pending Access Approval Screen
  if (session && accessStatus === 'pending') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-app-base text-app-heading p-6">
        <section className="w-full max-w-md rounded-3xl bg-app-surface border border-app-border p-8 text-center shadow-2xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-app-accent/15 border border-app-accent/40 flex items-center justify-center text-app-accent">
            <Clock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold">Access Approval Pending</h1>
          <p className="text-xs text-app-muted mt-2 mb-4 font-mono truncate">{session.user.email}</p>
          <div className="p-4 mb-6 rounded-2xl bg-app-base border border-app-border text-xs text-app-muted text-left leading-relaxed">
            Your account has been registered successfully. An administrator must approve your account before you can access GTAR songbook and cloud features.
          </div>
          {statusMessage && (
            <p className="text-xs text-app-action mb-4 font-semibold">{statusMessage}</p>
          )}
          {error && (
            <p className="text-xs text-status-error mb-4 font-semibold">{error}</p>
          )}
          <div className="space-y-3">
            <button
              type="button"
              disabled={checkingStatus}
              onClick={() => void checkStatus()}
              className="w-full rounded-xl bg-app-action text-app-on-action font-bold py-3 disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${checkingStatus ? 'animate-spin' : ''}`} />
              <span>{checkingStatus ? 'Checking...' : 'Check Status'}</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="w-full rounded-xl bg-transparent hover:bg-app-base text-app-muted hover:text-app-heading border border-app-border py-2.5 text-xs font-semibold transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
          {isDevLogsEnabled && (
            <div className="mt-6 pt-4 border-t border-app-border/60 flex justify-center">
              <button
                type="button"
                title="View Debug Logs"
                aria-label="View Debug Logs"
                className="px-3.5 py-1.5 rounded-xl bg-app-base hover:bg-app-border text-app-action hover:text-app-action border border-app-border hover:border-app-action/60 text-xs font-mono font-medium flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-95"
                onClick={() => setIsDebugLogsOpen(true)}
              >
                <Terminal className="w-3.5 h-3.5 text-app-action" />
                <span>View Debug Logs</span>
              </button>
            </div>
          )}
          {isDevLogsEnabled && isDebugLogsOpen && (
            <DebugLogsModal isOpen={isDebugLogsOpen} onClose={() => setIsDebugLogsOpen(false)} />
          )}
        </section>
      </main>
    )
  }

  // Denied Access Screen
  if (session && accessStatus === 'denied') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-app-base text-app-heading p-6">
        <section className="w-full max-w-md rounded-3xl bg-app-surface border border-app-border p-8 text-center shadow-2xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#DC6E67]/15 border border-[#DC6E67]/40 flex items-center justify-center text-status-error">
            <ShieldX className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-xs text-app-muted mt-2 mb-4 font-mono truncate">{session.user.email}</p>
          <div className="p-4 mb-6 rounded-2xl bg-app-base border border-app-border text-xs text-app-muted text-left leading-relaxed">
            Access for this Google account has been denied by an administrator. Contact the application owner if you believe this is in error.
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full rounded-xl bg-app-base hover:bg-app-base/80 text-app-heading border border-app-border font-bold py-3 transition-colors cursor-pointer"
          >
            Sign Out
          </button>
          {isDevLogsEnabled && (
            <div className="mt-6 pt-4 border-t border-app-border/60 flex justify-center">
              <button
                type="button"
                title="View Debug Logs"
                aria-label="View Debug Logs"
                className="px-3.5 py-1.5 rounded-xl bg-app-base hover:bg-app-border text-app-action hover:text-app-action border border-app-border hover:border-app-action/60 text-xs font-mono font-medium flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-95"
                onClick={() => setIsDebugLogsOpen(true)}
              >
                <Terminal className="w-3.5 h-3.5 text-app-action" />
                <span>View Debug Logs</span>
              </button>
            </div>
          )}
          {isDevLogsEnabled && isDebugLogsOpen && (
            <DebugLogsModal isOpen={isDebugLogsOpen} onClose={() => setIsDebugLogsOpen(false)} />
          )}
        </section>
      </main>
    )
  }

  // Standard Login Screen
  return (
    <main className="min-h-screen flex items-center justify-center bg-app-base text-app-heading p-6">
      <section className="w-full max-w-md rounded-3xl bg-app-surface border border-app-border p-8 text-center shadow-2xl">
        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-app-base border border-app-border p-1 shadow-inner flex items-center justify-center">
          <img
            src={isDevEnv ? devLogo : prodLogo}
            alt={isDevEnv ? 'GTAR Dev Logo' : 'GTAR Logo'}
            className="w-full h-full object-contain rounded-xl"
          />
        </div>
        <h1 className="text-3xl font-bold">GTAR</h1>
        <p className="text-app-muted mt-2">Songbook &amp; Live Stage Companion</p>
        <h2 className="text-lg font-semibold mt-8">Owner Access</h2>
        <p className="text-sm text-app-muted mt-2 mb-6">
          Access is restricted to authorized owners. Sign in with your approved Google account.
        </p>
        {isExpiredOffline && (
          <div className="p-3 mb-4 rounded-xl bg-app-accent/15 border border-app-accent/40 text-app-text text-xs text-left">
            <p className="font-bold text-app-accent mb-1">Offline Session Expired</p>
            <p>Your 30-day offline stage session has expired. Reconnect to the internet once to renew.</p>
          </div>
        )}
        {checking ? (
          <p role="status">Verifying your session...</p>
        ) : busy ? (
          <p role="status" className="text-sm text-app-action font-semibold animate-pulse">
            Signing in with Google...
          </p>
        ) : (
          <div className="space-y-3">
            <div
              id="google-signin-button"
              className="w-full flex justify-center my-2 min-h-[44px]"
              aria-label="Google Sign-In"
            />
            {!gisRendered && !scriptLoadFailed && (
              <button
                disabled={!ready || busy}
                className="w-full rounded-xl bg-app-action text-app-on-action font-bold py-3 disabled:opacity-50 cursor-pointer"
                onClick={() => void signIn()}
              >
                {busy ? 'Signing in...' : 'Sign In with Google'}
              </button>
            )}
            {scriptLoadFailed && (
              <button
                type="button"
                className="mt-2 text-sm font-semibold underline text-app-action hover:text-app-action-hover cursor-pointer"
                onClick={() => {
                  setError('')
                  loadSdk(true)
                }}
              >
                Retry loading Google Sign-In
              </button>
            )}
          </div>
        )}
        <p role="status" className="text-sm text-status-warning mt-4">
          {error || (!clientId ? 'Google sign-in is not configured. Contact the app owner.' : '')}
        </p>
        {canBypass && !checking && (
          <button
            className="mt-6 text-sm underline text-app-muted cursor-pointer"
            onClick={() => {
              signOut()
              setBypass(true)
            }}
          >
            Continue offline (local development)
          </button>
        )}
        {isDevLogsEnabled && (
          <div className="mt-6 pt-4 border-t border-app-border/60 flex justify-center">
            <button
              type="button"
              title="View Debug Logs"
              aria-label="View Debug Logs"
              className="px-3.5 py-1.5 rounded-xl bg-app-base hover:bg-app-border text-app-action hover:text-app-action border border-app-border hover:border-app-action/60 text-xs font-mono font-medium flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-95"
              onClick={() => setIsDebugLogsOpen(true)}
            >
              <Terminal className="w-3.5 h-3.5 text-app-action" />
              <span>View Debug Logs</span>
            </button>
          </div>
        )}
        {isDevLogsEnabled && isDebugLogsOpen && (
          <DebugLogsModal isOpen={isDebugLogsOpen} onClose={() => setIsDebugLogsOpen(false)} />
        )}
      </section>
    </main>
  )
}
