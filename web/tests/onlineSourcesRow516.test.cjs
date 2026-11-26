// #632 simplified Online Song Sources row + two fixed provider checkboxes + result source labels.
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
const globalKeys = ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT', 'navigator']
const originalGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]))
after(() => {
  dom.window.close()
  for (const [key, descriptor] of originalGlobals) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key] }
})
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { OnlineSourcesRow } = require('../src/components/OnlineSourcesRow.tsx')
const { SearchResults } = require('../src/components/SearchResults.tsx')
const settings = require('../src/utils/onlineSourceSettings.ts')

const q = selector => document.querySelector(selector)
const qa = selector => [...document.querySelectorAll(selector)]
const stored = () => JSON.parse(localStorage.getItem(settings.ONLINE_SOURCE_SETTINGS_KEY))
const byLabel = label => qa('button, a, input').find(el => el.getAttribute('aria-label') === label)
const buttonText = text => qa('button').find(button => button.textContent.trim() === text)

async function mount(props = {}) {
  localStorage.clear()
  if (props.seed) localStorage.setItem(settings.ONLINE_SOURCE_SETTINGS_KEY, JSON.stringify(props.seed))
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  const calls = { toggled: [] }
  await act(async () => {
    root.render(React.createElement(OnlineSourcesRow, {
      rowClass: 'w-full min-h-11 px-3 py-2 rounded-xl flex items-center gap-2.5 border cursor-pointer mb-2',
      enabled: props.enabled ?? true,
      onToggle: next => { calls.toggled.push(next) },
    }))
  })
  if (props.expand !== false) await click(q('[data-testid="online-sources-expand"]'))
  return { root, calls }
}
async function click(el) { await act(async () => { el.click() }) }

test('#632 one row: switch toggles online search, the row opens the dialog', async () => {
  const { root, calls } = await mount({ expand: false, enabled: false })
  try {
    const sw = q('[data-testid="settings-online-sources"]')
    assert.equal(sw.getAttribute('role'), 'switch')
    assert.equal(sw.getAttribute('aria-checked'), 'false')
    assert.equal(q('[data-testid="online-sources-panel"]'), null)
    await click(sw)
    assert.deepEqual(calls.toggled, [true])
    assert.equal(q('[data-testid="online-sources-panel"]'), null, 'switch does not open dialog')
    const expand = q('[data-testid="online-sources-expand"]')
    assert.equal(expand.getAttribute('aria-expanded'), 'false')
    await click(expand)
    assert.equal(expand.getAttribute('aria-expanded'), 'true')
    assert.ok(q('[data-testid="online-sources-panel"]'))
    assert.deepEqual(calls.toggled, [true], 'opening dialog does not toggle switch')
    await click(expand)
    assert.equal(q('[data-testid="online-sources-panel"]'), null)
  } finally { await act(async () => root.unmount()) }
})

test('#632 dialog renders exactly two fixed providers, no mode radios, no add/order/delete/website controls', async () => {
  const { root } = await mount()
  try {
    const panel = q('[data-testid="online-sources-panel"]')
    const items = qa('[data-testid^="manage-source-"]')
    assert.deepEqual(items.map(el => el.getAttribute('data-testid')), [
      'manage-source-ultimate-guitar',
      'manage-source-guitarsongs',
    ])
    assert.equal(qa('[role="radio"]').length, 0)
    assert.equal(q('[data-testid="online-sources-add"]'), null)
    assert.equal(q('[data-testid="manage-sources-form"]'), null)
    assert.doesNotMatch(panel.textContent, /All Sources|Primary Only|WorshipChords|Website|Add a source/i)

    const ugCheckbox = byLabel('Enable Ultimate Guitar')
    const gsCheckbox = byLabel('Enable GuitarSongs.club')
    assert.equal(ugCheckbox.checked, true)
    assert.equal(ugCheckbox.disabled, false)
    assert.equal(gsCheckbox.checked, false)
    assert.equal(gsCheckbox.disabled, true)
    assert.match(q('[data-testid="provider-unavailable-guitarsongs"]').textContent, /Unavailable/)
  } finally { await act(async () => root.unmount()) }
})

test('#632 toggling Ultimate Guitar persists and Restore Defaults resets with confirm step', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Enable Ultimate Guitar'))
    assert.equal(stored().sources[0].enabled, false)
    await click(buttonText('Restore Defaults'))
    assert.ok(q('[role="group"][aria-label="Confirm restore defaults"]'))
    await click(buttonText('Cancel'))
    assert.equal(stored().sources[0].enabled, false)
    await click(buttonText('Restore Defaults'))
    await click(buttonText('Restore defaults'))
    assert.equal(stored().sources[0].enabled, true)
    assert.equal(stored().sources[1].enabled, false)
  } finally { await act(async () => root.unmount()) }
})

test('#632 every interactive control has an accessible name and status region is polite', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Help for sources'))
    for (const el of qa('[data-testid="online-sources-panel"] button, [data-testid="online-sources-panel"] input')) {
      const name = el.getAttribute('aria-label') || el.textContent.trim() || (el.labels && [...el.labels].map(label => label.textContent.trim()).join(''))
      assert.ok(name, `unnamed control: ${el.outerHTML.slice(0, 80)}`)
    }
    assert.equal(q('[data-testid="manage-sources-status"]').getAttribute('aria-live'), 'polite')
  } finally { await act(async () => root.unmount()) }
})

test('#632 online results show their source name on the right', async () => {
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  const result = (id, extra = {}) => ({ id, songName: 'Relentless', artistName: 'Hillsong United', type: 'Chords', version: 1, votes: 1, rating: 5, tabUrl: `https://example.com/${id}`, ...extra })
  await act(async () => {
    root.render(React.createElement(SearchResults, {
      songs: [], setlists: [], isSearchingOnline: false,
      online: [result('1', { providerId: 'ultimate-guitar', providerName: 'Ultimate Guitar' }), result('2')],
      onSelectSong() {}, onSelectSetlist() {}, onPreviewOnline() {},
    }))
  })
  try {
    const labels = qa('[data-testid="online-result-source"]')
    assert.deepEqual(labels.map(label => label.textContent), ['Ultimate Guitar'])
    assert.equal(qa('button[aria-label^="Preview Relentless"]').length, 2)
    assert.equal(byLabel('Preview Relentless online chords from Ultimate Guitar').contains(labels[0]), true)
  } finally { await act(async () => root.unmount()) }
})

test('#632 Header uses one Online song sources row with no separate Manage Sources button', () => {
  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.match(header, /<OnlineSourcesRow rowClass=\{popoverItem\} enabled=\{onlineSourcesEnabled\} onToggle=\{setOnlineSourcesEnabled\} onOpenDialog=\{openOnlineSourcesDialog\} \/>/)
  assert.doesNotMatch(header, /settings-manage-sources|ManageSourcesModal|profile-web-sources/)
  assert.equal(fs.existsSync(path.join(__dirname, '../src/components/ManageSourcesModal.tsx')), false)
  const row = fs.readFileSync(path.join(__dirname, '../src/components/OnlineSourcesRow.tsx'), 'utf8')
  assert.match(row, /<AppModalSection title="Sources">/)
})
