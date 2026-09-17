import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { AuthGate } from './components/AuthGate'
const App = lazy(() => import('./App.tsx'))

import { isDevEnv } from './utils/env'
import { requestDurableStorage } from './utils/syncJournal'

// Best-effort request for durable browser storage (non-blocking, non-failing)
if (typeof window !== 'undefined') {
  requestDurableStorage().catch(() => {})
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate><Suspense fallback={<p role="status">Loading GTAR...</p>}><App /></Suspense></AuthGate>
  </StrictMode>,
)
