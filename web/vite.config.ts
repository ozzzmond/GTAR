import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, type Plugin } from 'vite'
import https from 'node:https'
import url from 'node:url'
import os from 'node:os'

const UG_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Referer: 'https://www.ultimate-guitar.com/',
}

function fetchHttps(targetUrl: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    https
      .get(targetUrl, { headers: UG_HEADERS }, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 200, data }))
      })
      .on('error', reject)
  })
}

function extractJsStore(html: string): any {
  const marker = 'data-content="'
  const idx = html.indexOf(marker)
  if (idx === -1) return null
  const end = html.indexOf('">', idx + marker.length)
  if (end === -1) return null
  const jsonStr = html
    .substring(idx + marker.length, end)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  try {
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

function sanitizeUgMarkup(content: string): string {
  return content
    .replace(/\[ch\](.*?)\[\/ch\]/gi, '$1')
    .replace(/\[\/?tab\]/gi, '')
    .trim()
}

function ugScraperPlugin(): Plugin {
  return {
    name: 'ug-scraper-plugin',
    configureServer(server) {
      server.middlewares.use('/api/ug-search', async (req, res) => {
        try {
          const parsedUrl = url.parse(req.url || '', true)
          const q = String(parsedUrl.query.q || '').trim()
          if (!q) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, results: [] }))
            return
          }

          const target = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`
          const { status, data } = await fetchHttps(target)
          if (status !== 200) {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: `Search HTTP ${status}` }))
            return
          }

          const storeJson = extractJsStore(data)
          const rawResults =
            storeJson?.store?.page?.data?.results || storeJson?.data?.results || []

          const results = rawResults
            .filter(
              (r: any) =>
                r.song_name &&
                r.tab_url &&
                (r.type === 'Chords' || r.tab_url.includes('-chords-') || r.type === 'Tab')
            )
            .map((r: any, i: number) => ({
              id: r.id || i,
              songName: String(r.song_name).trim(),
              artistName: String(r.artist_name || '').trim(),
              type: r.type || 'Chords',
              version: Number(r.version) || 1,
              votes: Number(r.votes) || 0,
              rating: Number(r.rating) || 0,
              tabUrl: String(r.tab_url).trim(),
              tonality: r.tonality_name || undefined,
            }))
            .sort((a: any, b: any) => b.votes - a.votes || b.rating - a.rating)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, results }))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: err.message }))
        }
      })

      server.middlewares.use('/api/ug-tab', async (req, res) => {
        try {
          const parsedUrl = url.parse(req.url || '', true)
          const tabUrl = String(parsedUrl.query.url || '').trim()
          if (!tabUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: 'Missing tab url' }))
            return
          }

          const { status, data } = await fetchHttps(tabUrl)
          if (status !== 200) {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: `Tab fetch HTTP ${status}` }))
            return
          }

          const storeJson = extractJsStore(data)
          const tabData = storeJson?.store?.page?.data || storeJson?.data
          const wikiTab = tabData?.tab_view?.wiki_tab || tabData?.tab
          let rawContent = wikiTab?.content || ''

          if (!rawContent) {
            const preMatch = data.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
            if (preMatch && preMatch[1]) {
              rawContent = preMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
            }
          }

          if (!rawContent) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: 'No chord sheet text in tab' }))
            return
          }

          const cleanContent = sanitizeUgMarkup(rawContent)
          const title = tabData?.tab?.song_name || 'Unknown'
          const artist = tabData?.tab?.artist_name || ''
          const key =
            tabData?.tab_view?.meta?.tonality || tabData?.tab?.tonality_name || 'G'
          const capoNum = tabData?.tab_view?.meta?.capo || tabData?.tab?.capo || 0
          const capoStr = capoNum > 0 ? `Capo ${capoNum}` : 'No Capo'

          const formatted = `{title: ${title}}
{artist: ${artist}}
{key: ${key}}
{capo: ${capoStr}}
{tempo: 120}

${cleanContent}`

          const sheet = {
            title,
            artist,
            key,
            capo: capoStr,
            bpm: '120',
            format:
              cleanContent.includes('[') && cleanContent.includes(']')
                ? 'CHORD_PRO'
                : 'TWO_LINE',
            rawContent: formatted,
            sourceUrl: tabUrl,
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, sheet }))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: err.message }))
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
      src: '/pwa-dev-icon.svg',
      sizes: '192x192 512x512',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: '/pwa-dev-icon.svg',
      sizes: '192x192 512x512',
      type: 'image/svg+xml',
      purpose: 'maskable',
    },
  ]
  const prodIcons = [
    {
      src: '/favicon.svg',
      sizes: '192x192 512x512',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: '/favicon.svg',
      sizes: '192x192 512x512',
      type: 'image/svg+xml',
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
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true,
        },
        includeAssets: isDev
          ? ['favicon.svg', 'icons.svg', 'pwa-dev-icon.svg']
          : ['favicon.svg', 'icons.svg'],
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


