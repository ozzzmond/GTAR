const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

function loadTs(relPath, extraCache = {}) {
  const full = path.resolve(__dirname, '..', relPath)
  const cache = { ...extraCache }
  const load = (target) => {
    const resolved = path.resolve(target)
    if (cache[resolved]) return cache[resolved].exports
    const source = fs.readFileSync(resolved, 'utf8')
    const out = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
      fileName: resolved,
    })
    const mod = { exports: {} }
    cache[resolved] = mod
    const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', out.outputText)
    const localRequire = (id) => {
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(resolved), id)
        for (const ext of ['', '.ts', '.tsx', '.js', '.cjs']) {
          if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return load(base + ext)
        }
      }
      return require(id)
    }
    fn(localRequire, mod, mod.exports, resolved, path.dirname(resolved))
    return mod.exports
  }
  return load(full)
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.HTMLElement = dom.window.HTMLElement
  global.Node = dom.window.Node
  global.Event = dom.window.Event
  global.CustomEvent = dom.window.CustomEvent
  global.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  return dom
}

test('formatDefaultSetlistName uses local calendar date in MM-DD-YYYY with leading zeros and no time', () => {
  const { formatDefaultSetlistName } = loadTs('src/utils/setlistSongs.ts')
  // Single-digit month and day -> leading zeros
  const jan5 = new Date(2026, 0, 5, 23, 59, 59)
  assert.equal(formatDefaultSetlistName(jan5), '01-05-2026')
  // Double-digit month and day
  const nov28 = new Date(2026, 10, 28, 9, 44, 0)
  assert.equal(formatDefaultSetlistName(nov28), '11-28-2026')
  assert.doesNotMatch(formatDefaultSetlistName(nov28), /\d{2}:\d{2}/)
  // Local date vs UTC boundary: 2026-03-01 23:30 local vs 2026-03-02 UTC (or vice versa)
  const boundary = new Date(2026, 2, 1, 23, 45, 0)
  const expectedMonth = String(boundary.getMonth() + 1).padStart(2, '0')
  const expectedDay = String(boundary.getDate()).padStart(2, '0')
  const expectedYear = String(boundary.getFullYear()).padStart(4, '0')
  assert.equal(formatDefaultSetlistName(boundary), `${expectedMonth}-${expectedDay}-${expectedYear}`)
})

test('GH649: Add new setlist opens Import Setlist dialog with Create New Setlist first; meatball removed; sort retained', async () => {
  const dom = setupDom()
  const { SongbookHomeView } = loadTs('src/components/SongbookHomeView.tsx')
  const { formatDefaultSetlistName } = loadTs('src/utils/setlistSongs.ts')
  const root = createRoot(document.getElementById('root'))
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => Array.from(document.querySelectorAll(sel))
  const click = async (el) => { await act(async () => el.click()) }

  const createdSetlists = []
  let nextId = 1
  const makeProps = (setlists) => ({
    songs: [],
    setlists,
    folders: [],
    view: { type: 'ALL_SETLISTS' },
    onSelectView: () => {},
    onSelectSong: () => {},
    onNewSong: () => {},
    onNewSetlist: () => {
      const sl = { id: `sl-new-${nextId++}`, name: formatDefaultSetlistName(), createdAt: Date.now(), songs: [] }
      createdSetlists.push(sl)
    },
    onCreateSetlistForSong: () => true,
    onDeleteSong: () => {},
    onRequestTrashSetlist: () => {},
  })

  const initialSetlists = [
    { id: 'sl-b', name: 'Bravo', createdAt: 2000, songs: [] },
    { id: 'sl-a', name: 'Alpha', createdAt: 1000, songs: [] },
  ]

  await act(async () => root.render(React.createElement(SongbookHomeView, makeProps(initialSetlists))))

  // 1. Meatball menu removed
  assert.equal($('[data-testid="workspace-scope-menu-btn"]'), null)
  assert.equal($('[data-testid="workspace-scope-menu"]'), null)

  // 2. Sort dropdown retained with all sort modes
  const sortSelect = $('[data-testid="setlist-sort-select"]')
  assert.ok(sortSelect)
  assert.deepEqual(Array.from(sortSelect.options).map(o => o.value), ['manual', 'title_asc', 'title_desc', 'newest', 'oldest'])
  await act(async () => {
    sortSelect.value = 'title_asc'
    sortSelect.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  assert.deepEqual($$('[data-testid^="workspace-setlist-card-"]').map(el => el.getAttribute('data-testid')),
    ['workspace-setlist-card-sl-a', 'workspace-setlist-card-sl-b'])

  // 3. Add new setlist opens Import Setlist dialog
  await click($('[data-testid="setlists-add-new"]'))
  const dialog = $('[data-testid="setlist-import-dialog"]')
  assert.ok(dialog, 'Import Setlist dialog opens')

  // 4. Create New Setlist is first option above existing import options
  const createBtn = $('[data-testid="create-new-setlist-btn"]')
  const pasteInput = $('[data-testid="paste-share-link-input"]')
  const qrScanner = $('[data-testid="import-qr-scanner"]')
  const jsonFileBtn = $('[data-testid="choose-setlist-json-file"]')
  assert.ok(createBtn && pasteInput && qrScanner && jsonFileBtn)
  assert.ok(createBtn.compareDocumentPosition(pasteInput) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
  assert.ok(pasteInput.compareDocumentPosition(qrScanner) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
  assert.ok(qrScanner.compareDocumentPosition(jsonFileBtn) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
  assert.match(createBtn.className, /min-h-11/)

  // 5. Clicking Create New Setlist invokes existing creation handler and closes dialog; same-day creation does not overwrite
  await click(createBtn)
  assert.equal($('[data-testid="setlist-import-dialog"]'), null)
  await click($('[data-testid="setlists-add-new"]'))
  await click($('[data-testid="create-new-setlist-btn"]'))
  assert.equal(createdSetlists.length, 2)
  assert.notEqual(createdSetlists[0].id, createdSetlists[1].id)
  assert.match(createdSetlists[0].name, /^\d{2}-\d{2}-\d{4}$/)
  assert.equal(createdSetlists[0].name, createdSetlists[1].name)

  await act(async () => root.unmount())
  dom.window.close()
})
