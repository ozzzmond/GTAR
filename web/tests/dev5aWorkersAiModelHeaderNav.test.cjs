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
