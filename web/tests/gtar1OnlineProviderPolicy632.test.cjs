const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => {
    const src = fs.readFileSync(filename, 'utf8')
      .replaceAll('import.meta.env', '(globalThis.__GTAR_TEST_IMPORT_META_ENV__ || { DEV: false })')
    mod._compile(
      ts.transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText,
      filename
    )
  }
}

const E = require('../scripts/gtar1-export.cjs')
const { ugGate, _resetUgGateForTesting } = require('../functions/ugGate.ts')
const ugSearch = require('../functions/api/ug-search.ts')
const ugTab = require('../functions/api/ug-tab.ts')
const gsSearch = require('../functions/api/gs-search.ts')
const gsTab = require('../functions/api/gs-tab.ts')
const {
  createDefaultSettings,
  getProviderAvailability,
  isProviderPermitted,
  sanitizeSettings,
  setSourceEnabled,
} = require('../src/utils/onlineSourceSettings.ts')
const { UltimateGuitarProvider, GuitarSongsProvider } = require('../src/utils/onlineSearchProvider.ts')
const { getSearchableProviders } = require('../src/utils/onlineSearch.ts')

const IDS = { prod: '11111111-1111-4111-8111-111111111111', dev: '22222222-2222-4222-8222-222222222222' }

test('#632 environment matrix: GTAR_DEV and GTAR_PROD keep UG and GS enabled', async () => {
  const gtarWrangler = JSON.parse(fs.readFileSync(path.join(__dirname, '../wrangler.jsonc'), 'utf8'))
  assert.equal(gtarWrangler.vars?.UG_PROXY_MODE, undefined)
  assert.equal(gtarWrangler.env.production.vars?.UG_PROXY_MODE, undefined)
  assert.equal(gtarWrangler.env.preview.vars?.UG_PROXY_MODE, undefined)

  for (const branch of ['dev', 'main']) {
    _resetUgGateForTesting()
    assert.equal(await ugGate({ CF_PAGES: '1', CF_PAGES_BRANCH: branch }), null)
    const ugRes = await ugSearch.onRequestGet({
      request: new Request('https://gtar.local/api/ug-search?q='),
      env: { CF_PAGES: '1', CF_PAGES_BRANCH: branch },
    })
    assert.equal(ugRes.status, 200)
    const gsRes = await gsSearch.onRequestGet({
      request: new Request('https://gtar.local/api/gs-search?q='),
      env: { CF_PAGES: '1', CF_PAGES_BRANCH: branch },
    })
    assert.equal(gsRes.status, 200)
  }

  assert.equal(getProviderAvailability('ultimate-guitar').permitted, true)
  assert.equal(getProviderAvailability('guitarsongs').permitted, true)
})

test('#632 environment matrix: GTAR1_PRODUCTION enables UG and GS while GTAR1_DEMO disables both', async () => {
  const sourceWrangler = fs.readFileSync(path.join(__dirname, '../wrangler.jsonc'), 'utf8')
  const exportedWrangler = JSON.parse(E.patchWrangler(sourceWrangler, IDS))

  assert.equal(exportedWrangler.env.production.vars.UG_PROXY_MODE, 'enabled')
  assert.equal(exportedWrangler.env.preview.vars.UG_PROXY_MODE, 'disabled')
  assert.equal(exportedWrangler.vars.UG_PROXY_MODE, 'disabled')

  // GTAR1_PRODUCTION (main + env.production)
  _resetUgGateForTesting()
  const prodEnv = { ...exportedWrangler.env.production.vars, CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }
  assert.equal(await ugGate(prodEnv), null)
  assert.equal((await ugSearch.onRequestGet({ request: new Request('https://gtar1.local/api/ug-search?q='), env: prodEnv })).status, 200)
  assert.equal((await gsSearch.onRequestGet({ request: new Request('https://gtar1.local/api/gs-search?q='), env: prodEnv })).status, 200)

  // GTAR1_DEMO (demo + env.preview) blocks all 4 endpoints regardless of query/url
  _resetUgGateForTesting()
  const demoEnv = { ...exportedWrangler.env.preview.vars, CF_PAGES: '1', CF_PAGES_BRANCH: 'demo' }
  for (const [endpoint, url] of [
    [ugSearch, 'https://demo.gtar1.local/api/ug-search?q=oasis'],
    [ugTab, 'https://demo.gtar1.local/api/ug-tab?url=' + encodeURIComponent('https://tabs.ultimate-guitar.com/tab/1')],
    [gsSearch, 'https://demo.gtar1.local/api/gs-search?q=beatles'],
    [gsTab, 'https://demo.gtar1.local/api/gs-tab?url=' + encodeURIComponent('https://en.guitarsongs.club/song/127565')],
  ]) {
    const res = await endpoint.onRequestGet({ request: new Request(url), env: demoEnv })
    assert.equal(res.status, 503)
    assert.equal((await res.json()).error, 'ONLINE_SOURCES_DISABLED')
  }

  // Even if UG_PROXY_MODE were misconfigured to 'enabled' on demo branch, CF_PAGES_BRANCH=demo still fails closed
  const misconfiguredDemoEnv = { UG_PROXY_MODE: 'enabled', CF_PAGES: '1', CF_PAGES_BRANCH: 'demo' }
  assert.equal((await ugGate(misconfiguredDemoEnv)).status, 503)
})

test('#632 unknown or invalid deployment identity fails closed at server and build layers', async () => {
  _resetUgGateForTesting()
  for (const badEnv of [
    { UG_PROXY_MODE: 'disabled' },
    { UG_PROXY_MODE: '' },
    { UG_PROXY_MODE: 'bogus' },
    { UG_PROXY_MODE: 'true' },
    { CF_PAGES_BRANCH: 'demo' },
    { CF_PAGES: '1', UG_PROXY_MODE: 'enabled', CF_PAGES_BRANCH: 'unknown-branch' },
    { CF_PAGES: '1', UG_PROXY_MODE: 'enabled' },
  ]) {
    const res = await ugGate(badEnv)
    assert.ok(res instanceof Response, JSON.stringify(badEnv))
    assert.equal(res.status, 503)
    assert.equal((await res.json()).error, 'ONLINE_SOURCES_DISABLED')
  }

  const viteSource = fs.readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8')
  const exportedVite = E.patchViteDemoFlag(E.patchBranding('web/vite.config.ts', E.patchViteConfig(viteSource)))
  assert.ok(exportedVite.includes("const gtar1OnlineProvidersDisabled = process.env.CF_PAGES_BRANCH !== 'main'"))
  assert.ok(exportedVite.includes("'import.meta.env.VITE_ONLINE_PROVIDERS_DISABLED': JSON.stringify(gtar1OnlineProvidersDisabled ? '1' : '')"))
})

test('#632 GTAR1 Demo UI and provider classes cannot activate either provider via settings manipulation', async () => {
  globalThis.__GTAR_TEST_IMPORT_META_ENV__ = { DEV: false, VITE_GTAR1_DEMO: '1', VITE_ONLINE_PROVIDERS_DISABLED: '1' }
  const originalFetch = global.fetch
  let fetchCalled = false
  try {
    assert.equal(getProviderAvailability('ultimate-guitar').permitted, false)
    assert.equal(getProviderAvailability('guitarsongs').permitted, false)

    const defaults = createDefaultSettings()
    assert.deepEqual(defaults.sources.map(s => [s.id, s.enabled]), [['ultimate-guitar', false], ['guitarsongs', false]])

    const tampered = sanitizeSettings({
      version: 1,
      sources: [
        { kind: 'provider', id: 'ultimate-guitar', providerId: 'ultimate-guitar', enabled: true },
        { kind: 'provider', id: 'guitarsongs', providerId: 'guitarsongs', enabled: true },
      ],
    })
    assert.deepEqual(tampered.sources.map(s => [s.id, s.enabled]), [['ultimate-guitar', false], ['guitarsongs', false]])

    const toggledUg = setSourceEnabled(defaults, 'ultimate-guitar', true)
    const toggledGs = setSourceEnabled(defaults, 'guitarsongs', true)
    assert.equal(toggledUg.sources.find(s => s.id === 'ultimate-guitar').enabled, false)
    assert.equal(toggledGs.sources.find(s => s.id === 'guitarsongs').enabled, false)

    assert.deepEqual(getSearchableProviders(tampered, undefined, isProviderPermitted), [])

    global.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }) }
    const ug = new UltimateGuitarProvider()
    const gs = new GuitarSongsProvider()
    await assert.rejects(() => ug.search('oasis'), err => err.code === 'DISABLED')
    await assert.rejects(() => gs.search('beatles'), err => err.code === 'DISABLED')
    await assert.rejects(() => ug.fetchSheet({ id: '1', songName: 'x', artistName: 'y', type: 'Chords', tabUrl: 'https://tabs.ultimate-guitar.com/tab/1' }), err => err.code === 'DISABLED')
    await assert.rejects(() => gs.fetchSheet({ id: 'guitarsongs:1', songName: 'x', artistName: 'y', type: 'Chords', tabUrl: 'https://en.guitarsongs.club/song/1' }), /not permitted/)
    assert.equal(fetchCalled, false)
  } finally {
    global.fetch = originalFetch
    delete globalThis.__GTAR_TEST_IMPORT_META_ENV__
  }
})
