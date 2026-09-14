import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, type Plugin } from 'vite'
import https from 'node:https'
import url from 'node:url'
import os from 'node:os'

import {
  parseSearchResults,
  parseTabSheet,
  validateSearchQuery,
  validateTabUrl,
} from './src/utils/ugCore.ts'

const UG_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Referer: 'https://www.ultimate-guitar.com/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

function fetchHttps(targetUrl: string, timeoutMs = 8000): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = https
      .get(targetUrl, { headers: UG_HEADERS, timeout: timeoutMs }, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 200, data }))
      })
      .on('timeout', () => {
        req.destroy(new Error('ETIMEDOUT: Request timed out'))
      })
      .on('error', reject)
  })
}

function ugScraperPlugin(): Plugin {
  return {
    name: 'ug-scraper-plugin',
    configureServer(server) {
      server.middlewares.use('/api/ug-search', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        res.setHeader('Cache-Control', 'no-store')

        try {
          const parsedUrl = url.parse(req.url || '', true)
          const validation = validateSearchQuery(parsedUrl.query.q)

          if (!validation.valid) {
            res.writeHead(400)
            res.end(JSON.stringify({ success: false, error: validation.error }))
            return
          }

          if (!validation.query) {
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, results: [] }))
            return
          }

          const target = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(validation.query)}`
          const { status, data } = await fetchHttps(target)

          if (status === 404) {
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, results: [] }))
            return
          }

          if (status === 403) {
            res.writeHead(403)
            res.end(JSON.stringify({ success: false, error: 'Ultimate Guitar access restricted by WAF' }))
            return
          }

          if (status === 429) {
            res.writeHead(429)
            res.end(JSON.stringify({ success: false, error: 'Rate limit exceeded on Ultimate Guitar' }))
            return
          }

          if (status !== 200) {
            res.writeHead(502)
            res.end(JSON.stringify({ success: false, error: `Upstream error from Ultimate Guitar (HTTP ${status})` }))
            return
          }

          const results = parseSearchResults(data)
          res.writeHead(200)
          res.end(JSON.stringify({ success: true, results }))
        } catch (err: any) {
          const isTimeout = err?.code === 'ETIMEDOUT' || err?.message?.includes('timed out')
          const statusCode = isTimeout ? 504 : 502
          const errorMsg = isTimeout
            ? 'Gateway timeout contacting Ultimate Guitar'
            : (err?.message || 'Internal proxy error')
          res.writeHead(statusCode)
          res.end(JSON.stringify({ success: false, error: errorMsg }))
        }
      })

      server.middlewares.use('/api/ug-tab', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        res.setHeader('Cache-Control', 'no-store')

        try {
          const parsedUrl = url.parse(req.url || '', true)
          const validation = validateTabUrl(parsedUrl.query.url)

          if (!validation.valid || !validation.parsedUrl) {
            res.writeHead(validation.status)
            res.end(JSON.stringify({ success: false, error: validation.error }))
            return
          }

          const { status, data } = await fetchHttps(validation.parsedUrl.toString())

          if (status === 404) {
            res.writeHead(404)
            res.end(JSON.stringify({ success: false, error: 'Tab not found on Ultimate Guitar' }))
            return
          }

          if (status === 403) {
            res.writeHead(403)
            res.end(JSON.stringify({ success: false, error: 'Ultimate Guitar access restricted by WAF' }))
            return
          }

          if (status === 429) {
            res.writeHead(429)
            res.end(JSON.stringify({ success: false, error: 'Rate limit exceeded on Ultimate Guitar' }))
            return
          }

          if (status !== 200) {
            res.writeHead(502)
            res.end(JSON.stringify({ success: false, error: `Upstream error from Ultimate Guitar (HTTP ${status})` }))
            return
          }

          const parseResult = parseTabSheet(data, validation.parsedUrl.toString())
          if (!parseResult.success) {
            res.writeHead(parseResult.status)
            res.end(JSON.stringify({ success: false, error: parseResult.error }))
            return
          }

          res.writeHead(200)
          res.end(JSON.stringify({ success: true, sheet: parseResult.sheet }))
        } catch (err: any) {
          const isTimeout = err?.code === 'ETIMEDOUT' || err?.message?.includes('timed out')
          const statusCode = isTimeout ? 504 : 502
          const errorMsg = isTimeout
            ? 'Gateway timeout contacting Ultimate Guitar'
            : (err?.message || 'Internal proxy error')
          res.writeHead(statusCode)
          res.end(JSON.stringify({ success: false, error: errorMsg }))
        }
      })

      // DEV-only local LAN IP discovery endpoint for Chromecast / Smart TV receiver
      server.middlewares.use('/api/dev-lan-ip', (_req, res) => {
        try {
          const interfaces = os.networkInterfaces()
          let lanIp: string | null = null
          for (const name of Object.keys(interfaces)) {
            const ifaceList = interfaces[name] || []
            for (const iface of ifaceList) {
              if (iface.family === 'IPv4' && !iface.internal) {
                lanIp = iface.address
                break
              }
            }
            if (lanIp) break
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, lanIp }))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: err.message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDebug = mode === 'debug' || process.env.VITE_APP_ENV === 'debug' || process.env.CF_PAGES_BRANCH === 'dev'
  // isDev covers both standard dev server (mode='development') and the debug variant
  const isDev = mode === 'development' || isDebug
  const appEnv = isDebug ? 'debug' : 'production'

  // PWA manifest icon sets
  const devIcons = [
    {
      src: '/pwa-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/pwa-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/pwa-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ]
  const prodIcons = [
    {
      src: '/pwa-prod-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/pwa-prod-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/pwa-prod-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ]

  return {
    define: {
      'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),
    },
    plugins: [
      tailwindcss(),
      react(),
      ugScraperPlugin(),
      {
        name: 'html-branding-transform',
        transformIndexHtml(html: string) {
          if (isDev) {
            return html
              .replace(/<title>.*?<\/title>/, '<title>GTAR-Dev Live Stage Companion</title>')
              .replace(/href="\/favicon\.png"/, 'href="/favicon.png"')
              .replace(/href="\/apple-touch-icon\.png"/, 'href="/apple-touch-icon.png"')
              .replace(/href="\/favicon\.ico"/, 'href="/favicon.ico"')
          } else {
            return html
              .replace(/<title>.*?<\/title>/, '<title>GTAR Live Stage Companion</title>')
              .replace(/href="\/favicon\.png"/, 'href="/favicon-prod.png"')
              .replace(/href="\/apple-touch-icon\.png"/, 'href="/apple-touch-icon-prod.png"')
              .replace(/href="\/favicon\.ico"/, 'href="/favicon-prod.ico"')
          }
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true,
        },
        includeAssets: [
          'favicon.ico',
          'favicon.png',
          'favicon-prod.ico',
          'favicon-prod.png',
          'apple-touch-icon.png',
          'apple-touch-icon-prod.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-prod-192x192.png',
          'pwa-prod-512x512.png',
          'prod-logo.png',
          'dev-logo.png',
        ],
        manifest: {
          name: isDev ? 'GTAR-Dev Live Stage Companion' : 'GTAR Live Stage Companion',
          short_name: isDev ? 'GTAR-Dev' : 'GTAR',
          description: 'Professional Live Stage Teleprompter, Chord Transposer, BandSync, and Setlist Companion for Musicians',
          theme_color: isDev ? '#8B0000' : '#0f172a',
          background_color: isDev ? '#1a0000' : '#002B36',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          icons: isDev ? devIcons : prodIcons,
        },
        workbox: {
          globPatterns: [
            '**/*.{js,css,html,ico,png,jpg,jpeg,svg,gif,webp,json,woff,woff2,ttf,eot,otf,mp3,wav,webmanifest}',
          ],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 15,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ],
    server: {
      port: isDebug ? 5174 : 5173,
      host: isDebug ? '0.0.0.0' : false,
      proxy: {
        '/api/ug': {
          target: 'https://www.ultimate-guitar.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ug/, ''),
          headers: UG_HEADERS,
        },
        '/api/ug-tabs': {
          target: 'https://tabs.ultimate-guitar.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ug-tabs/, ''),
          headers: UG_HEADERS,
        },
      },
    },
  }
})


