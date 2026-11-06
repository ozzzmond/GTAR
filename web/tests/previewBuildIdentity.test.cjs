const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }

test('Cloudflare feature preview header shows build SHA on desktop and mobile without DEV features', async () => {
  const saved = { ...process.env }
  const dom = new JSDOM('', { url: 'https://abcdef0.gtar-web.pages.dev' })
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
  try {
    process.env.CF_PAGES = '1'
    process.env.CF_PAGES_BRANCH = 'fix/example'
    process.env.CF_PAGES_COMMIT_SHA = 'abcdef0123456789abcdef0123456789abcdef01'
    const { loadConfigFromFile } = await import('vite')
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.resolve(__dirname, '../vite.config.ts'))
    const defines = loaded.config.define
    assert.equal(defines.__GTAR_PROD_VERSION__, 'null')
    assert.equal(defines['import.meta.env.VITE_APP_ENV'], '"production"')
    assert.equal(JSON.parse(defines.__GTAR_DEV_VERSION__), '1.0.143-dev.2')
    assert.equal(defines.__GTAR_DEV_PROVENANCE__, 'null')
    assert.equal(defines.__GTAR_STAGE_CAST2_ENABLED__, 'true')
    const emitted = []
    const releasePlugin = loaded.config.plugins.find(plugin => plugin?.name === 'gtar-release-identity')
    releasePlugin.generateBundle.call({ emitFile: asset => emitted.push(asset) })
    assert.deepEqual(emitted, [])
    assert.deepEqual(JSON.parse(defines.__GTAR_PREVIEW_IDENTITY__), { tagStatus: 'UNTAGGED', commitSha: 'abcdef0', branch: 'fix/example' })
    Object.assign(globalThis, { __GTAR_PREVIEW_IDENTITY__: JSON.parse(defines.__GTAR_PREVIEW_IDENTITY__) })
    for (const key of Object.keys(require.cache)) if (key.includes(`${path.sep}src${path.sep}`)) delete require.cache[key]
    const { Header } = require('../src/components/Header.tsx')
    const html = renderToStaticMarkup(React.createElement(Header, {
      activeView: 'songbook', onViewChange() {}, song: { id: 1, title: 'Test', rawContent: '', format: 'PLAIN' },
      searchQuery: '', onSearchQueryChange() {}, onOpenWebsiteUrlSource() {}, onOpenStageTools() {},
      onToggleTheme() {}, onOpenStageSettings() {}, onOpenImportModal() {}, onOpenBackupRestoreModal() {},
    }))
    const headerDom = new JSDOM(html)
    assert.equal(headerDom.window.document.querySelector('[data-testid="header-preview-identity"]')?.textContent, "PREVIEW \u00b7 UNTAGGED \u00b7 SHA: abcdef0")
    assert.equal(headerDom.window.document.querySelector('[data-testid="header-prod-version-compact"]')?.textContent, "PREVIEW \u00b7 UNTAGGED \u00b7 SHA: abcdef0")
    headerDom.window.close()
    assert.doesNotMatch(html, /v1\.1\.108|dev-header-diagnostics|>DEV</)
    assert.equal(require('../src/utils/env.ts').isDevEnv, false)
    const { formatPreviewIdentity } = require('../src/utils/headerFormatters.ts')
    assert.equal(formatPreviewIdentity(globalThis.__GTAR_PREVIEW_IDENTITY__), 'PREVIEW · UNTAGGED · SHA: abcdef0')
  } finally {
    process.env = saved
    dom.window.close()
    delete globalThis.window; delete globalThis.document; delete globalThis.localStorage
    delete globalThis.__GTAR_PREVIEW_IDENTITY__
    for (const key of Object.keys(require.cache)) if (key.includes(`${path.sep}src${path.sep}`)) delete require.cache[key]
  }
})

test('unversioned backup default creates, verifies and parses without changing restore compatibility', t => {
  const dom = new JSDOM('', { url: 'https://preview.gtar-web.pages.dev' })
  globalThis.localStorage = dom.window.localStorage
  t.after(() => { dom.window.close(); delete globalThis.localStorage })
  const { GTAR_APP_VERSION } = require('../src/types/gtar.ts')
  assert.equal(GTAR_APP_VERSION, '0.0.0-unversioned')
  const { buildVerifiedBackup, parseBackupJson } = require('../src/utils/jsonBackup.ts')
  const backup = buildVerifiedBackup([{ id: 's1', title: 'Identity test', rawContent: 'lyrics', format: 'PLAIN' }], [])
  assert.equal(JSON.parse(backup.json).version, '0.0.0-unversioned')
  const parsed = parseBackupJson(backup.json)
  assert.equal(parsed.metadata.version, '0.0.0-unversioned')
  assert.equal(parsed.isValid, true)
  assert.equal(parsed.songs[0].title, 'Identity test')
  assert.equal(parsed.songs[0].rawContent, 'lyrics')
  const legacy = parseBackupJson(backup.json.replace('0.0.0-unversioned', '1.1.108'))
  assert.equal(legacy.isValid, true)
  assert.deepEqual(legacy.songs, parsed.songs)
})

test('preview detection excludes DEV, local builds, and fail-closed main', async () => {
  const saved = { ...process.env }
  const { loadConfigFromFile } = await import('vite')
  const load = mode => loadConfigFromFile({ command: 'build', mode }, path.resolve(__dirname, '../vite.config.ts'))
  try {
    process.env.CF_PAGES = '1'
    process.env.CF_PAGES_BRANCH = 'dev'
    // Deliberate mismatch bypasses remote tag verification; DEV stays DEV with unverified provenance.
    process.env.CF_PAGES_COMMIT_SHA = '0000000000000000000000000000000000000000'
    const dev = (await load('production')).config.define
    assert.equal(dev.__GTAR_PREVIEW_IDENTITY__, 'null')
    assert.equal(dev['import.meta.env.VITE_APP_ENV'], '"debug"')
    assert.equal(JSON.parse(dev.__GTAR_DEV_PROVENANCE__).tagStatus, 'UNVERIFIED')
    process.env.CF_PAGES_BRANCH = 'main'
    delete process.env.CF_PAGES_COMMIT_SHA
    await assert.rejects(load('production'), /Release full commit SHA must equal build HEAD/)
    delete process.env.CF_PAGES
    process.env.CF_PAGES_BRANCH = 'fix/local'
    const local = (await load('development')).config.define
    assert.equal(local.__GTAR_PREVIEW_IDENTITY__, 'null')
  } finally { process.env = saved }
})
