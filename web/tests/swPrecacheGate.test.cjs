const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { readSource } = require('./helpers/sourceText.cjs')
const gate = require('../scripts/check-sw-precache.cjs')

const webRoot = path.resolve(__dirname, '..')

// Shape of the worker vite-plugin-pwa emits.
function swSource(urls) {
  const entries = urls.map(url => `{url:"${url}",revision:${url.startsWith('assets/') ? 'null' : '"0f"'}}`).join(',')
  return `define(["./workbox-835c8c05"],function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([${entries}],{}),e.cleanupOutdatedCaches(),e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//]}))});`
}

// #562: the 13 entries v1.2.2 and v1.2.3 shipped (includeAssets and manifest only).
const BROKEN_URLS = [
  'apple-touch-icon-prod.png', 'apple-touch-icon.png', 'dev-logo.png', 'favicon-prod.ico', 'favicon-prod.png',
  'favicon.ico', 'favicon.png', 'prod-logo.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-prod-192x192.png',
  'pwa-prod-512x512.png', 'manifest.webmanifest',
]
const ASSETS = Array.from({ length: 12 }, (_, i) => `assets/chunk-${i}.js`).concat('assets/index-a1b2.css')
const DIST_FILES = ['index.html', 'sw.js', 'workbox-835c8c05.js', ...BROKEN_URLS, ...ASSETS]

test('SW precache gate: rejects the #562 worker (icons only, no index.html, no hashed assets)', () => {
  const problems = gate.findPrecacheProblems({ swSource: swSource(BROKEN_URLS), distFiles: DIST_FILES })
  assert.ok(problems.includes('precache has no index.html entry'), problems.join('; '))
  assert.ok(problems.some(problem => problem.startsWith('precache has 13 entries; expected at least')), problems.join('; '))
  assert.ok(problems.some(problem => problem.startsWith('precache is missing 13 of 13 hashed assets')), problems.join('; '))
})

test('SW precache gate: accepts a worker that precaches index.html and every hashed asset', () => {
  const urls = ['index.html', ...BROKEN_URLS, ...ASSETS]
  assert.deepEqual(gate.findPrecacheProblems({ swSource: swSource(urls), distFiles: DIST_FILES }), [])
})

test('SW precache gate: each condition fails on its own', () => {
  const full = ['index.html', ...BROKEN_URLS, ...ASSETS]
  const check = urls => gate.findPrecacheProblems({ swSource: swSource(urls), distFiles: DIST_FILES })
  assert.deepEqual(check(full.filter(url => url !== 'index.html')), ['precache has no index.html entry'])
  assert.deepEqual(check(full.filter(url => url !== 'assets/chunk-3.js')), ['precache is missing 1 of 13 hashed assets: assets/chunk-3.js'])
  assert.deepEqual(
    gate.findPrecacheProblems({ swSource: swSource(['index.html', 'assets/a.js']), distFiles: ['index.html', 'assets/a.js'] }),
    [`precache has 2 entries; expected at least ${gate.MIN_PRECACHE_ENTRIES}`],
  )
  assert.deepEqual(gate.findPrecacheProblems({ swSource: 'self.skipWaiting()', distFiles: DIST_FILES }), ['sw.js has no precacheAndRoute manifest'])
})

test('SW precache gate: the installed workbox-build glob matches the production pattern without warnings', async () => {
  // Regression for #562: minimatch 11 under glob <= 13 matched zero files.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-sw-gate-'))
  try {
    fs.mkdirSync(path.join(dir, 'assets'))
    for (const file of ['index.html', 'manifest.webmanifest', 'favicon.png', 'assets/index-a1b2.js', 'assets/index-a1b2.css']) {
      fs.writeFileSync(path.join(dir, file), file)
    }
    assert.deepEqual(await gate.findGlobWarnings(dir), [])

    fs.rmSync(path.join(dir, 'index.html'))
    fs.rmSync(path.join(dir, 'manifest.webmanifest'))
    fs.rmSync(path.join(dir, 'favicon.png'))
    fs.rmSync(path.join(dir, 'assets'), { recursive: true })
    const warnings = await gate.findGlobWarnings(dir)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /doesn't match any files/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('SW precache gate: checkDist reports a missing worker and a dist workbox would warn about', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-sw-gate-'))
  try {
    assert.deepEqual(await gate.checkDist(dir), ['dist/sw.js was not generated'])
    fs.mkdirSync(path.join(dir, 'assets'))
    const urls = ['index.html', ...BROKEN_URLS, ...ASSETS]
    for (const file of urls) fs.writeFileSync(path.join(dir, file), file)
    fs.writeFileSync(path.join(dir, 'sw.js'), swSource(urls))
    assert.deepEqual(await gate.checkDist(dir), [])
    fs.writeFileSync(path.join(dir, 'sw.js'), swSource(BROKEN_URLS))
    assert.equal((await gate.checkDist(dir)).includes('precache has no index.html entry'), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('SW precache gate: npm run build runs the gate, on the same glob workbox uses', () => {
  const pkg = JSON.parse(readSource(path.join(webRoot, 'package.json')))
  const viteConfig = readSource(path.join(webRoot, 'vite.config.ts'))
  assert.equal(pkg.scripts.build, 'tsc -b && vite build && node scripts/check-sw-precache.cjs')
  assert.equal(gate.PRECACHE_GLOB_PATTERNS.length, 1)
  assert.ok(viteConfig.includes(`globPatterns: [\n            '${gate.PRECACHE_GLOB_PATTERNS[0]}',\n          ],`), 'gate glob must equal workbox.globPatterns')
})

test('SW precache gate: the CLI exits non-zero on the #562 worker and zero on a complete one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-sw-gate-'))
  const run = () => spawnSync(process.execPath, [path.join(webRoot, 'scripts/check-sw-precache.cjs'), dir], { encoding: 'utf8' })
  try {
    fs.mkdirSync(path.join(dir, 'assets'))
    const urls = ['index.html', ...BROKEN_URLS, ...ASSETS]
    for (const file of urls) fs.writeFileSync(path.join(dir, file), file)
    fs.writeFileSync(path.join(dir, 'sw.js'), swSource(BROKEN_URLS))
    const broken = run()
    assert.equal(broken.status, 1)
    assert.match(broken.stderr, /Service worker precache gate failed:\n- precache has no index\.html entry/)
    fs.writeFileSync(path.join(dir, 'sw.js'), swSource(urls))
    const fixed = run()
    assert.equal(fixed.status, 0, fixed.stderr)
    assert.match(fixed.stdout, /precache gate: OK \(27 entries\)/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Service worker: Cloudflare /cdn-cgi/ navigations are not answered with cached index.html', () => {
  const viteConfig = readSource(path.join(webRoot, 'vite.config.ts'))
  assert.ok(viteConfig.includes('navigateFallbackDenylist: [/^\\/api\\//, /^\\/cdn-cgi\\//]'), 'navigateFallbackDenylist must exclude /api/ and /cdn-cgi/')
})

test('SW precache gate: minimatch stays on the patched 11.x line and workbox-build globs with a compatible glob', () => {
  const pkg = JSON.parse(readSource(path.join(webRoot, 'package.json')))
  const lock = JSON.parse(readSource(path.join(webRoot, 'package-lock.json')))
  assert.equal(pkg.overrides.minimatch, '^11.0.8', 'PR#476 minimatch override must stay (GHSA-g3hv-75wg-m249 is unpatched below 11.0.1)')
  assert.equal(pkg.overrides['workbox-build'].glob, '^14.0.6')
  const minimatchVersions = Object.entries(lock.packages)
    .filter(([name]) => name === 'node_modules/minimatch' || name.endsWith('/node_modules/minimatch'))
    .map(([, entry]) => entry.version)
  assert.ok(minimatchVersions.length > 0)
  for (const version of minimatchVersions) assert.match(version, /^11\./, `minimatch ${version} is on a line without the advisory fix`)
  assert.match(lock.packages['node_modules/glob'].version, /^14\./, 'glob <= 13 reads minimatch internals that changed in 11')
})
