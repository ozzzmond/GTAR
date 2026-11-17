// Build gate for #562: a service worker without index.html and the hashed
// assets in its precache cannot start offline. `npm run build` runs this after
// `vite build` and fails instead of shipping that worker.
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

// Must equal workbox.globPatterns in vite.config.ts (swPrecacheGate.test.cjs checks it).
const PRECACHE_GLOB_PATTERNS = [
  '**/*.{js,css,html,ico,png,jpg,jpeg,svg,gif,webp,json,woff,woff2,ttf,eot,otf,mp3,wav,webmanifest}',
]
const PRECACHE_GLOB_IGNORES = ['**/node_modules/**/*', 'sw.js', 'workbox-*.js']
// The broken builds (v1.2.2, v1.2.3) had 13 entries; healthy builds have 50+.
const MIN_PRECACHE_ENTRIES = 20

function parsePrecacheUrls(swSource) {
  const start = swSource.indexOf('precacheAndRoute(')
  if (start === -1) return null
  const open = swSource.indexOf('[', start)
  let depth = 0
  let end = -1
  for (let i = open; i !== -1 && i < swSource.length; i++) {
    if (swSource[i] === '[') depth++
    else if (swSource[i] === ']' && --depth === 0) { end = i; break }
  }
  if (end === -1) return null
  return [...swSource.slice(open, end).matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map(match => match[1])
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')]
  })
}

function findPrecacheProblems({ swSource, distFiles, minEntries = MIN_PRECACHE_ENTRIES }) {
  const urls = parsePrecacheUrls(swSource)
  if (!urls) return ['sw.js has no precacheAndRoute manifest']
  const precached = new Set(urls.map(url => url.replace(/^\//, '')))
  const problems = []
  if (!precached.has('index.html')) problems.push('precache has no index.html entry')
  if (urls.length < minEntries) problems.push(`precache has ${urls.length} entries; expected at least ${minEntries}`)
  const assets = distFiles.filter(file => /^assets\/.+\.(js|css)$/.test(file))
  if (assets.length === 0) problems.push('dist has no hashed assets/*.js or assets/*.css')
  const missing = assets.filter(file => !precached.has(file))
  if (missing.length > 0) problems.push(`precache is missing ${missing.length} of ${assets.length} hashed assets: ${missing.slice(0, 5).join(', ')}`)
  return problems
}

// Same glob workbox-build runs for the service worker; any warning (pattern
// matched nothing, file over the size limit) means files were left out.
async function findGlobWarnings(distDir) {
  const pwaRequire = createRequire(require.resolve('vite-plugin-pwa'))
  const { getManifest } = pwaRequire('workbox-build')
  const { warnings } = await getManifest({
    globDirectory: distDir,
    globPatterns: PRECACHE_GLOB_PATTERNS,
    globIgnores: PRECACHE_GLOB_IGNORES,
  })
  return warnings.map(warning => `workbox warning: ${warning.replace(/\s+/g, ' ')}`)
}

async function checkDist(distDir) {
  const swPath = path.join(distDir, 'sw.js')
  if (!fs.existsSync(swPath)) return ['dist/sw.js was not generated']
  return [
    ...findPrecacheProblems({ swSource: fs.readFileSync(swPath, 'utf8'), distFiles: listFiles(distDir) }),
    ...await findGlobWarnings(distDir),
  ]
}

if (require.main === module) {
  const distDir = path.resolve(process.argv[2] || path.join(__dirname, '../dist'))
  checkDist(distDir).then(problems => {
    if (problems.length === 0) {
      console.log(`Service worker precache gate: OK (${parsePrecacheUrls(fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8')).length} entries)`)
      return
    }
    console.error(`Service worker precache gate failed:\n- ${problems.join('\n- ')}`)
    process.exitCode = 1
  }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = {
  PRECACHE_GLOB_PATTERNS,
  PRECACHE_GLOB_IGNORES,
  MIN_PRECACHE_ENTRIES,
  parsePrecacheUrls,
  findPrecacheProblems,
  findGlobWarnings,
  checkDist,
}
