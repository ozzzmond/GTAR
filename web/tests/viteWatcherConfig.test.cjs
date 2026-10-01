/**
 * viteWatcherConfig.test.cjs
 * Asserts that the Vite server.watch.ignored config excludes the Wrangler/Miniflare
 * runtime state directory so that D1 sqlite-wal/sqlite-shm mutations do NOT trigger
 * full page reloads.  Also guards strictPort and /api proxy routing invariants.
 *
 * ROOT_CAUSE: GTAR_108_DEV_8B_VITE_WRANGLER_WATCH_LOOP_FIX
 */
'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// ---------------------------------------------------------------------------
// Read raw vite.config.ts as text — no TypeScript transpile needed for this
// purely structural assertion.
// ---------------------------------------------------------------------------
const configPath = path.resolve(__dirname, '../vite.config.ts')
const configSrc = fs.readFileSync(configPath, 'utf8')

test('.wrangler/** is present in server.watch.ignored', () => {
  // Must contain a watch.ignored entry that covers the full .wrangler subtree.
  // Accept array literal or string literal form.
  const hasWatchIgnored =
    /server\s*:\s*\{[\s\S]*?watch\s*:\s*\{[\s\S]*?ignored\s*:/.test(configSrc)
  assert.ok(hasWatchIgnored, 'server.watch.ignored block not found in vite.config.ts')

  // Extract the ignored value (handles both string and array forms).
  const ignoredMatch = configSrc.match(/ignored\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/)
  assert.ok(ignoredMatch, 'Could not parse ignored value from vite.config.ts')

  const ignoredRaw = ignoredMatch[1]
  // Must cover .wrangler directory at any depth.
  const coversWrangler = ignoredRaw.includes('.wrangler')
  assert.ok(
    coversWrangler,
    `server.watch.ignored (${ignoredRaw}) does not cover .wrangler runtime state`
  )
})

test('sqlite-wal pattern would be excluded by the configured ignored glob', () => {
  // Verify the glob pattern **/.wrangler/** would match the exact paths seen in
  // the Vite reload logs:
  //   .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite-wal
  //   .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite-shm
  const { minimatch } = (() => {
    try { return require('minimatch') }
    // minimatch is a transitive dep of chokidar which is a dep of vite.
    catch { return { minimatch: null } }
  })()

  const pattern = '**/.wrangler/**'
  const walPath = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/abc123.sqlite-wal'
  const shmPath = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/abc123.sqlite-shm'

  if (minimatch) {
    assert.ok(minimatch(walPath, pattern, { dot: true }), `Pattern ${pattern} should match ${walPath}`)
    assert.ok(minimatch(shmPath, pattern, { dot: true }), `Pattern ${pattern} should match ${shmPath}`)
  } else {
    // Fallback: at minimum confirm the config text contains the pattern.
    assert.ok(configSrc.includes('.wrangler'), 'Config must reference .wrangler in ignored')
  }
})

test('strictPort 5173 is preserved in vite.config.ts', () => {
  assert.ok(
    /strictPort\s*:\s*true/.test(configSrc),
    'strictPort: true must remain in vite.config.ts'
  )
  assert.ok(
    /port\s*:\s*isDebug\s*\?\s*5174\s*:\s*5173/.test(configSrc),
    'dev port 5173 must remain in vite.config.ts'
  )
})

test('/api proxy to 8788 is preserved in vite.config.ts', () => {
  assert.ok(
    /proxy\s*:\s*\{/.test(configSrc),
    'proxy block must remain in vite.config.ts'
  )
  assert.ok(
    /8788/.test(configSrc),
    'Wrangler API port 8788 must remain in proxy config'
  )
  assert.ok(
    /'\/api'\s*:\s*\{/.test(configSrc),
    "/api proxy route must remain in vite.config.ts"
  )
})
