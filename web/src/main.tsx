import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import './components/StageCast2Panel.css'
import { AuthGate } from './components/AuthGate'
import { StageCast2Panel } from './components/StageCast2Panel'
import { cast2ReceiverRoute } from './utils/stageCast2Local'
import { applyThemeRuntime, hydrateThemeSettings } from './components/ThemeModal'

const initialTheme = hydrateThemeSettings()
applyThemeRuntime(initialTheme.mode, initialTheme.standalone)
// Root bootstrap is a singleton entrypoint, not a component refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components -- The lazy import is rendered by the existing guarded root.
const App = lazy(() => import('./App.tsx'))

import { isDevEnv } from './utils/env'
import { requestDurableStorage } from './utils/syncJournal'

// #204 S2: capture starts before sign-in, so sign-in and One Tap problems (#132) are recorded.
// Logs stay on this device. Off (the default) records only warnings and errors.
if (typeof window !== 'undefined') {
  void import('./utils/logger').then(({ appLogger }) => appLogger.resume())
}

// Best-effort request for durable browser storage (non-blocking, non-failing)
if (typeof window !== 'undefined') {
  requestDurableStorage().catch(() => {})
}

// #167 phase B0, DEV only: shadow-copy chart bodies to IndexedDB and verify them on load.
// Read-only with respect to the library; localStorage stays the source of truth. Never loaded in PROD.
if (typeof window !== 'undefined' && isDevEnv) {
  Promise.all([import('./utils/libraryBodyStore'), import('./utils/logger'), import('./utils/syncJournal'), import('./utils/libraryIndex')]).then(([store, { appLogger }, { peekPersistedLibrary }, { setLibraryBodyBackend }]) => {
    // #171 B1: IndexedDB access for the slim library index (used only when the DEV toggle is on).
    setLibraryBodyBackend(store.libraryBodyBackend())
    store.installLibraryBodyShadow({
      enabled: true,
      logger: appLogger,
      // Raw parse only: readPersistedLibrary() would move the cross-tab conflict baseline.
      readLibrary: () => peekPersistedLibrary() as Parameters<typeof store.shadowWriteBodies>[0] | null,
    })
  }).catch(() => { /* shadow copy is optional */ })
}


function applyEnvironmentBranding(isDev: boolean) {
  if (typeof document === 'undefined') return

  document.title = isDev ? 'GTAR-Dev Live Stage Companion' : 'GTAR Live Stage Companion'

  const iconHref = isDev ? '/favicon.png' : '/favicon-prod.png'
  const appleHref = isDev ? '/apple-touch-icon.png' : '/apple-touch-icon-prod.png'

  // Update or create standard favicon links
  const iconLinks = document.querySelectorAll<HTMLLinkElement>("link[rel='icon'], link[rel='shortcut icon']")
  if (iconLinks.length > 0) {
    iconLinks.forEach(link => {
      link.href = iconHref
      link.type = 'image/png'
    })
  } else {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/png'
    link.href = iconHref
    document.head.appendChild(link)
  }

  // Update apple-touch-icon
  const appleLink = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']")
  if (appleLink) {
    appleLink.href = appleHref
  }

  if (isDev) {
    // Blob manifests need absolute resource URLs and a stable installation identity.
    const devManifest = {
      id: new URL('/?app=gtar-dev', window.location.origin).href,
      name: 'GTAR-Dev Live Stage Companion',
      short_name: 'GTAR-Dev',
      start_url: new URL('/', window.location.origin).href,
      scope: new URL('/', window.location.origin).href,
      icons: [
        {
          src: new URL('/pwa-192x192.png', window.location.origin).href,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: new URL('/pwa-512x512.png', window.location.origin).href,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: new URL('/pwa-512x512.png', window.location.origin).href,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
      theme_color: '#8B0000',
      background_color: '#1a0000',
      display: 'standalone',
    }
    const blob = new Blob([JSON.stringify(devManifest)], { type: 'application/json' })
    const manifestUrl = URL.createObjectURL(blob)
    let manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!manifestLink) {
      manifestLink = document.createElement('link')
      manifestLink.rel = 'manifest'
      document.head.appendChild(manifestLink)
    }
    manifestLink.href = manifestUrl
    if (import.meta.hot) {
      import.meta.hot.dispose(() => URL.revokeObjectURL(manifestUrl))
    }
  }
}

applyEnvironmentBranding(isDevEnv)

// Register PWA Service Worker for offline stage caching & local testing
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onNeedReload() {
      // Protect active stage session: never force reload while user is on stage
      const isStageActive =
        window.location.pathname.includes('/stage') ||
        window.location.search.includes('view=present') ||
        window.location.hash.includes('present') ||
        Boolean((window as unknown as { __GTAR_STAGE_ACTIVE__?: boolean }).__GTAR_STAGE_ACTIVE__)

      if (isStageActive) {
        return
      }

      // Do not force an unprompted window reload during an active session.
      // The updated service worker is already installed and activated in the background;
      // subsequent normal app starts or manual navigations will use the updated build.
    },
    onRegisteredSW(_swScriptUrl, registration) {
      if (registration) {
        // Periodically check for updates (every hour)
        setInterval(() => {
          registration.update().catch(() => { })
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.warn('GTAR Service Worker registration error:', error)
    },
  })
}

// Singleton guard: createRoot must only be called once per page lifecycle.
// If Vite HMR re-evaluates this module without a full page navigation,
// reuse the existing root to prevent the duplicate-root React error and
// the resulting Node.removeChild DOMException.
const rootEl = document.getElementById('root')!
const _win = window as typeof window & { __GTAR_REACT_ROOT__?: ReturnType<typeof createRoot> }
if (!_win.__GTAR_REACT_ROOT__) {
  _win.__GTAR_REACT_ROOT__ = createRoot(rootEl)
}
_win.__GTAR_REACT_ROOT__.render(
  <StrictMode>
    {cast2ReceiverRoute ? <StageCast2Panel receiver /> : <AuthGate><Suspense fallback={<p role="status">Loading GTAR...</p>}><App /></Suspense></AuthGate>}
  </StrictMode>,
)
