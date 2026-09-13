import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { AuthGate } from './components/AuthGate'
const App = lazy(() => import('./App.tsx'))

// Apply debug environment branding if active
const isDevApp = import.meta.env.DEV ||
  import.meta.env.VITE_APP_ENV === 'debug' ||
  (typeof window !== 'undefined' && window.location.hostname.includes('dev.gtar-web.pages.dev'))

if (isDevApp) {
  if (typeof document !== 'undefined') {
    document.title = 'GTAR-Dev Live Stage Companion'

    // Blob manifests need absolute resource URLs and a stable installation identity.
    const devManifest = {
      id: new URL('/?app=gtar-dev', window.location.origin).href,
      name: 'GTAR-Dev Live Stage Companion',
      short_name: 'GTAR-Dev',
      start_url: new URL('/', window.location.origin).href,
      scope: new URL('/', window.location.origin).href,
      icons: [{
        src: new URL('/pwa-dev-icon.svg', window.location.origin).href,
        sizes: 'any',
        type: 'image/svg+xml',
      }],
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
    try {
      const devFaviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="redGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E50914" />
      <stop offset="100%" stop-color="#8B0000" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="24" fill="url(#redGrad)" stroke="#FFFFFF" stroke-width="3"/>
  <circle cx="50" cy="42" r="22" fill="#002B36" stroke="#FFFFFF" stroke-width="2"/>
  <path d="M42 32 L62 42 L42 52 Z" fill="#2AA198" />
  <rect x="8" y="66" width="84" height="26" rx="6" fill="#FF1744" stroke="#FFFFFF" stroke-width="2.5"/>
  <text x="50" y="84" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="16" fill="#FFFFFF" text-anchor="middle" letter-spacing="2">DEV</text>
</svg>`
      const iconUrl = `data:image/svg+xml;base64,${btoa(devFaviconSvg)}`
      let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.type = 'image/svg+xml'
      link.href = iconUrl

    } catch { }
  }
} else {
  // Production: explicitly ensure favicon points to the GTAR teal guitar icon
  if (typeof document !== 'undefined') {
    try {
      let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.type = 'image/svg+xml'
      link.href = '/favicon.svg'
    } catch { }
  }
}

// Register PWA Service Worker for offline stage caching & local testing
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
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
