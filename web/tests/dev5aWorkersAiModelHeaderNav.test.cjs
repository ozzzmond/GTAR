const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
      }).outputText,
      filename
    )
}
require.extensions['.png'] = module => { module.exports = '/assets/dev-logo.png' }

const { JSDOM } = require('jsdom')
const boot = new JSDOM('<html><body></body></html>')
global.window = boot.window; global.document = boot.window.document
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
boot.window.close(); delete global.window; delete global.document

const webDir = path.resolve(__dirname, '..')
const DEPRECATED_DEV5_MODEL = '@cf/meta/llama-3-8b-instruct'
const metadataPath = path.join(webDir, 'functions/api/songbook/metadata.ts')
const authCorePath = path.join(webDir, 'functions/lib/authCore.ts')

function loadMetadataWithAuthStub() {
  const authCore = require(authCorePath)
  const original = authCore.authenticateUserRequest
  authCore.authenticateUserRequest = async () => ({ user: { id: 'usr_1', role: 'member', access_status: 'active' } })
  delete require.cache[require.resolve(metadataPath)]
  const mod = require(metadataPath)
  return { mod, restore: () => { authCore.authenticateUserRequest = original } }
}

function metadataRequest(body) {
  return new Request('https://gtar.test/api/songbook/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: JSON.stringify(body),
  })
}

test('DEV5A_MODEL_HOTFIX: selected Workers AI model is not the retired DEV.5 model', () => {
  const { WORKERS_AI_MODEL, RETIRED_WORKERS_AI_MODELS } = require(metadataPath)
  assert.notEqual(WORKERS_AI_MODEL, DEPRECATED_DEV5_MODEL)
  assert.match(WORKERS_AI_MODEL, /^@cf\/[\w.-]+\/[\w.-]+$/)
  assert.ok(RETIRED_WORKERS_AI_MODELS.includes(DEPRECATED_DEV5_MODEL))
  assert.ok(!RETIRED_WORKERS_AI_MODELS.includes(WORKERS_AI_MODEL))
})

test('DEV5A_MODEL_BOUNDARY: model ID is centralized; single dispatch site uses resolver', () => {
  const src = fs.readFileSync(metadataPath, 'utf8')
  assert.equal((src.match(/@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast/g) || []).length, 1, 'default model literal defined once')
  assert.match(src, /env\.AI\.run\(modelId,/)
  assert.match(src, /const modelId = resolveWorkersAiModel\(env\)/)
  const repoFunctions = fs.readdirSync(path.join(webDir, 'functions'), { recursive: true }).filter(f => /\.ts$/.test(f))
  for (const f of repoFunctions) {
    assert.ok(!fs.readFileSync(path.join(webDir, 'functions', f), 'utf8').includes("'" + DEPRECATED_DEV5_MODEL + "'") || f.endsWith('metadata.ts'), f)
  }
})

test('DEV5A_MODEL_RESOLVER: env override honored only when valid and not retired', () => {
  const { resolveWorkersAiModel, WORKERS_AI_MODEL } = require(metadataPath)
  assert.equal(resolveWorkersAiModel(undefined), WORKERS_AI_MODEL)
  assert.equal(resolveWorkersAiModel({}), WORKERS_AI_MODEL)
  assert.equal(resolveWorkersAiModel({ WORKERS_AI_METADATA_MODEL: '  ' }), WORKERS_AI_MODEL)
  assert.equal(resolveWorkersAiModel({ WORKERS_AI_METADATA_MODEL: DEPRECATED_DEV5_MODEL }), WORKERS_AI_MODEL)
  assert.equal(resolveWorkersAiModel({ WORKERS_AI_METADATA_MODEL: 'https://evil.example/model' }), WORKERS_AI_MODEL)
  assert.equal(resolveWorkersAiModel({ WORKERS_AI_METADATA_MODEL: '@cf/vendor/new-model-1' }), '@cf/vendor/new-model-1')
})

test('DEV5A_REQUEST_PATH: endpoint dispatches resolved model via env.AI with structured messages and returns validated metadata', async () => {
  const { mod, restore } = loadMetadataWithAuthStub()
  try {
    const calls = []
    const env = {
      AI: {
        async run(model, inputs) {
          calls.push({ model, inputs })
          return { response: JSON.stringify({ status: 'ok', matchedTitle: 'Let It Be', matchedArtist: 'The Beatles', originalKey: 'C', tempo: 72, timeSignature: '4/4', year: '1970', confidence: 'high' }) }
        },
      },
    }
    const res = await mod.onRequestPost({ request: metadataRequest({ title: 'Let It Be', artist: 'The Beatles' }), env })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].model, mod.WORKERS_AI_MODEL)
    assert.notEqual(calls[0].model, DEPRECATED_DEV5_MODEL)
    assert.deepEqual(calls[0].inputs.messages.map(m => m.role), ['system', 'user'])
    assert.equal(body.success, true)
    assert.equal(body.status, 'ok')
    assert.equal(body.metadata.originalKey, 'C')
    assert.equal(body.metadata.source, `Workers AI (${mod.WORKERS_AI_MODEL})`)

    // Object-shaped `response` (JSON mode capable models) is accepted.
    env.AI.run = async () => ({ response: { status: 'ok', matchedTitle: 'Let It Be', matchedArtist: 'The Beatles', originalKey: 'C', confidence: 'high' } })
    const objRes = await (await mod.onRequestPost({ request: metadataRequest({ title: 'Let It Be', artist: 'The Beatles' }), env })).json()
    assert.equal(objRes.status, 'ok')
    assert.equal(objRes.metadata.originalKey, 'C')
  } finally {
    restore()
  }
})

test('DEV5A_FAIL_CLOSED: missing binding 503, runtime error 500, identity mismatch ambiguous with null key', async () => {
  const { mod, restore } = loadMetadataWithAuthStub()
  try {
    const noAi = await mod.onRequestPost({ request: metadataRequest({ title: 'X' }), env: {} })
    assert.equal(noAi.status, 503)

    const failing = { AI: { async run() { throw new Error('5028: model deprecated') } } }
    const errRes = await mod.onRequestPost({ request: metadataRequest({ title: 'X' }), env: failing })
    assert.equal(errRes.status, 500)
    const errBody = await errRes.json()
    assert.equal(errBody.success, false)
    assert.equal(errBody.status, 'error')
    assert.match(errBody.error, /^Workers AI execution failed:/)

    const mismatch = { AI: { async run() { return { response: JSON.stringify({ status: 'ok', matchedTitle: 'Totally Different Track', matchedArtist: 'Someone Else', originalKey: 'G', confidence: 'high' }) } } } }
    const mmBody = await (await mod.onRequestPost({ request: metadataRequest({ title: 'Let It Be', artist: 'The Beatles' }), env: mismatch })).json()
    assert.equal(mmBody.status, 'ambiguous')
    assert.equal(mmBody.metadata.originalKey, null)
    assert.equal(mmBody.metadata.confidence, 'low')

    const garbage = { AI: { async run() { return { response: 'no json here' } } } }
    const gRes = await mod.onRequestPost({ request: metadataRequest({ title: 'X' }), env: garbage })
    assert.equal(gRes.status, 500)
  } finally {
    restore()
  }
})

test('DEV5A_NO_EXTERNAL_PROVIDERS: endpoint keeps zero MusicBrainz / external API key dependencies', () => {
  const src = fs.readFileSync(metadataPath, 'utf8')
  assert.doesNotMatch(src, /musicbrainz/i)
  assert.doesNotMatch(src, /API_KEY/)
  assert.doesNotMatch(src, /fetch\(/)
})

test('DEV5A_VIEW_HISTORY: navigateBack uses history.back only when a prior GTAR entry exists', () => {
  const vh = require(path.join(webDir, 'src/utils/viewHistory.ts'))
  let backCalls = 0
  const h = state => ({ state, back() { backCalls++ } })
  assert.equal(vh.navigateBack(h(null)), false)
  assert.equal(vh.navigateBack(h({ gtarView: 'stage', gtarDepth: 0 })), false)
  assert.equal(vh.navigateBack(h({ gtarView: 'bogus', gtarDepth: 3 })), false)
  assert.equal(backCalls, 0)
  assert.equal(vh.navigateBack(h({ gtarView: 'editor', gtarDepth: 2 })), true)
  assert.equal(backCalls, 1)
  assert.equal(vh.navigateBack(undefined), false)
  assert.equal(vh.navigateBack({ state: { gtarView: 'stage', gtarDepth: 1 }, back() { throw new Error('x') } }), false)
  assert.deepEqual(vh.buildViewHistoryState('trash', 4, { other: 1 }), { other: 1, gtarView: 'trash', gtarDepth: 4 })
})

test('DEV5A_APP_HISTORY_SYNC: App mirrors view changes to history and restores on popstate through the editor guard', () => {
  const app = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
  assert.match(app, /window\.history\.replaceState\(buildViewHistoryState\(activeView, 0,/)
  assert.match(app, /window\.history\.pushState\(buildViewHistoryState\(activeView, current\.gtarDepth \+ 1,/)
  assert.match(app, /addEventListener\('popstate', onPopState\)/)
  assert.match(app, /editorNavigationGuard\.current\(next\)/)
})

function renderHeader(props = {}) {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://gtar.test/' })
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true
  global.localStorage = dom.window.localStorage
  global.HTMLElement = dom.window.HTMLElement; global.Node = dom.window.Node
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.requestAnimationFrame = fn => setTimeout(fn, 0)
  delete require.cache[require.resolve(path.join(webDir, 'src/components/Header.tsx'))]
  const { Header } = require(path.join(webDir, 'src/components/Header.tsx'))
  const viewChanges = []
  const root = createRoot(document.getElementById('root'))
  act(() => {
    root.render(React.createElement(Header, {
      activeView: 'songbook',
      onViewChange(v) { viewChanges.push(v) },
      onOpenWebsiteUrlSource() {}, onOpenStageTools() {}, onToggleTheme() {}, onOpenStageSettings() {},
      onOpenImportModal() {}, onOpenBackupRestoreModal() {}, searchQuery: '', onSearchQueryChange() {},
      ...props,
    }))
  })
  return { dom, root, viewChanges }
}

function renderStageView(props = {}) {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  global.window = dom.window
  global.document = dom.window.document
  global.IS_REACT_ACT_ENVIRONMENT = true
  global.localStorage = dom.window.localStorage
  global.HTMLElement = dom.window.HTMLElement
  global.Node = dom.window.Node
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.requestAnimationFrame = fn => setTimeout(fn, 0)
  const root = createRoot(document.getElementById('root'))
  const { StageView } = require('../src/components/StageView.tsx')
  const song = { id: 'test', title: 'Test', rawContent: '[C]Hello' }
  act(() => {
    root.render(React.createElement(StageView, {
      song,
      songs: [song],
      activeSongIndex: 0,
      onSelectSongIndex() {},
      transposeOffset: 0,
      onTransposeChange() {},
      ...props,
    }))
  })
  return { dom, root }
}

test('DEV5A_BACK_CONTROL: Back renders in Stage BOX, accessible, and invokes browser history only', () => {
  const { dom, root } = renderStageView()
  try {
    const back = document.querySelector('[data-testid="toolbar-back"]')
    assert.ok(back)
    assert.equal(back.getAttribute('aria-label'), 'Back')
    assert.equal(back.getAttribute('type'), 'button')
    assert.equal(back.tagName, 'BUTTON')
    assert.ok(back.classList.contains('ui-button'), 'shares stage control touch target / theme tokens')
    assert.doesNotMatch(back.className, /(bg|text|border)-(red|blue|green|yellow|slate|gray|cyan|amber|sky)-\d/)
    assert.doesNotMatch(back.className, /#[0-9a-f]{3,6}/i)

    let backCalls = 0
    let pushCalls = 0
    window.history.back = () => { backCalls++ }
    window.history.pushState = () => { pushCalls++ }
    // No prior GTAR entry: fail safe (no-op)
    act(() => { back.click() })
    assert.equal(backCalls, 0)
    // Prior GTAR entry: delegates to browser Back
    window.history.replaceState({ gtarView: 'stage', gtarDepth: 1 }, '')
    act(() => { back.click() })
    assert.equal(backCalls, 1)
    assert.equal(pushCalls, 0)
    assert.equal(window.location.href, 'https://gtar.test/')
  } finally {
    act(() => root.unmount()); dom.window.close(); delete global.window; delete global.document
  }
})

test('DEV5A_BACK_NOT_HARDCODED: Back handler source references no GTAR view route', () => {
  const stage = fs.readFileSync(path.join(webDir, 'src/components/StageView.tsx'), 'utf8')
  const backBlock = stage.match(/<button[\s\S]*?data-testid="toolbar-back"[\s\S]*?<\/button>/)[0]
  assert.match(backBlock, /navigateBack\(\)/)
  assert.doesNotMatch(backBlock, /onViewChange|'songbook'|'stage'|'editor'|'trash'|onNavigateHome/)
  const vh = fs.readFileSync(path.join(webDir, 'src/utils/viewHistory.ts'), 'utf8')
  assert.match(vh, /history\.back\(\)/)
  assert.doesNotMatch(vh, /pushState|location\.(href|assign|replace)/)
})

test('DEV5A_TOOLBAR_LAYOUT: actions preserved in Header and Stage BOX (#333, #359)', () => {
  const { dom, root } = renderHeader()
  try {
    const labels = [...document.querySelectorAll('.toolbar-icon-btn')].map(b => b.getAttribute('aria-label'))
    assert.deepEqual(labels, [], 'Theme, Trash, More removed from Header toolbar in #359')
    assert.ok(document.querySelector('button[aria-label="GTAR home"]'), 'GTAR home preserved')
  } finally {
    act(() => root.unmount()); dom.window.close(); delete global.window; delete global.document
  }
})

test('ISSUE107_TOOLTIP: #359 retired toolbar hover tooltips; header action buttons retain accessible names', () => {
  const { dom, root } = renderHeader()
  try {
    assert.equal(document.querySelector('[role="tooltip"]'), null, 'no hover tooltips rendered')
    const homeBtn = document.querySelector('button[aria-label="GTAR home"]')
    assert.ok(homeBtn, 'GTAR home button has accessible name')
  } finally {
    act(() => root.unmount()); dom.window.close(); delete global.window; delete global.document
  }
})
