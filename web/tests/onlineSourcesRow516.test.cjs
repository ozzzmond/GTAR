// #516 PR B: Online song sources row (switch + expandable source list), help popover and result source labels.
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
async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}
async function submitForm() { await act(async () => { q('[data-testid="manage-sources-form"]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) }) }
async function addWebsite(name, url) {
  if (!q('[data-testid="manage-sources-form"]')) await click(buttonText('Website'))
  await type(byLabel('Name (optional)'), name)
  await type(byLabel('Website URL'), url)
  await submitForm()
}

test('#516 one row: switch toggles online search, the row expands the source list', async () => {
  const { root, calls } = await mount({ expand: false, enabled: false })
  try {
    const sw = q('[data-testid="settings-online-sources"]')
    assert.equal(sw.getAttribute('role'), 'switch')
    assert.equal(sw.getAttribute('aria-checked'), 'false')
    assert.equal(q('[data-testid="online-sources-panel"]'), null)
    await click(sw)
    assert.deepEqual(calls.toggled, [true])
    assert.equal(q('[data-testid="online-sources-panel"]'), null, 'switch does not expand')
    const expand = q('[data-testid="online-sources-expand"]')
    assert.equal(expand.getAttribute('aria-expanded'), 'false')
    await click(expand)
    assert.equal(expand.getAttribute('aria-expanded'), 'true')
    assert.ok(q('[data-testid="online-sources-panel"]'))
    assert.deepEqual(calls.toggled, [true], 'expanding does not toggle')
    await click(expand)
    assert.equal(q('[data-testid="online-sources-panel"]'), null)
  } finally { await act(async () => root.unmount()) }
})

test('#516 compact panel lists UG with mode choices and keeps instructions behind the help button', async () => {
  const { root } = await mount()
  try {
    assert.match(q('[data-testid="manage-source-ultimate-guitar"]').textContent, /Search/)
    assert.deepEqual(qa('[role="radio"]').map(radio => radio.getAttribute('aria-checked')), ['true', 'false'])
    assert.equal(q('[data-testid="online-sources-help"]'), null)
    assert.doesNotMatch(q('[data-testid="online-sources-panel"]').textContent, /curated|endorsement|Verified|shortcuts only/i)
    const help = byLabel('Help for sources')
    assert.equal(help.getAttribute('aria-expanded'), 'false')
    await click(help)
    assert.equal(help.getAttribute('aria-expanded'), 'true')
    assert.match(q('[data-testid="online-sources-help"]').textContent, /show results in GTAR/)
    assert.match(q('[data-testid="online-sources-help"]').textContent, /open in your browser/)
    await act(async () => { q('[data-testid="online-sources-help"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    assert.equal(q('[data-testid="online-sources-help"]'), null)
    await click(help)
    await click(help)
    assert.equal(q('[data-testid="online-sources-help"]'), null)
  } finally { await act(async () => root.unmount()) }
})

test('#516 removing UG shows the empty state, persists, and can be re-added manually', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Remove Ultimate Guitar'))
    assert.ok(q('[data-testid="manage-sources-empty"]'))
    assert.deepEqual(stored().sources, [])
    assert.ok(byLabel('Add Ultimate Guitar'))
    await click(byLabel('Add Ultimate Guitar'))
    assert.equal(q('[data-testid="manage-sources-empty"]'), null)
    assert.deepEqual(stored().sources.map(source => source.id), ['ultimate-guitar'])
  } finally { await act(async () => root.unmount()) }
})

test('#516 a saved empty list is not replaced by defaults when the row is opened again', async () => {
  const { root } = await mount({ seed: { version: 1, mode: 'all', sources: [] } })
  try {
    assert.ok(q('[data-testid="manage-sources-empty"]'))
    assert.equal(q('[data-testid="manage-source-ultimate-guitar"]'), null)
  } finally { await act(async () => root.unmount()) }
})

test('#516 website link: add, open, edit and remove', async () => {
  const { root } = await mount()
  try {
    assert.equal(q('[data-testid="manage-sources-form"]'), null, 'form hidden until Website is pressed')
    await addWebsite('Church Chords', 'chords.example.org/songs')
    assert.equal(stored().sources.at(-1).url, 'https://chords.example.org/songs')
    assert.equal(q('[data-testid="manage-sources-form"]'), null, 'form closes after adding')
    const link = byLabel('Open Church Chords in a new tab')
    assert.equal(link.getAttribute('href'), 'https://chords.example.org/songs')
    assert.equal(link.getAttribute('target'), '_blank')
    assert.match(link.getAttribute('rel'), /noopener/)
    assert.match(link.getAttribute('rel'), /noreferrer/)
    assert.match(q('[data-testid="manage-source-custom-2"]').textContent, /Link/)

    await click(byLabel('Edit Church Chords'))
    assert.equal(byLabel('Website URL').value, 'https://chords.example.org/songs')
    await type(byLabel('Name (optional)'), 'Renamed Site')
    await submitForm()
    assert.equal(stored().sources.at(-1).name, 'Renamed Site')
    await click(byLabel('Remove Renamed Site'))
    assert.equal(stored().sources.length, 1)
  } finally { await act(async () => root.unmount()) }
})

test('#516 unsafe or invalid website URLs are rejected with an accessible error', async () => {
  const { root } = await mount()
  try {
    for (const bad of ['javascript:alert(1)', 'ftp://files.example.org', 'https://user:pw@example.com', 'nope']) {
      await addWebsite('', bad)
      const alert = q('[role="alert"]')
      assert.ok(alert, `error for ${bad}`)
      assert.equal(byLabel('Website URL').getAttribute('aria-invalid'), 'true')
      assert.equal(byLabel('Website URL').getAttribute('aria-describedby'), alert.id)
      assert.equal(stored(), null)
    }
    await addWebsite('', 'https://ok.example.org')
    assert.equal(q('[role="alert"]'), null)
    await addWebsite('', 'https://ok.example.org')
    assert.match(q('[role="alert"]').textContent, /already/)
  } finally { await act(async () => root.unmount()) }
})

test('#516 priority buttons reorder deterministically and edges are disabled', async () => {
  const { root } = await mount()
  try {
    await addWebsite('Second', 'second.example.org')
    assert.equal(byLabel('Move Ultimate Guitar up').disabled, true)
    assert.equal(byLabel('Move Second down').disabled, true)
    await click(byLabel('Move Second up'))
    assert.deepEqual(stored().sources.map(source => source.name), ['Second', 'Ultimate Guitar'])
    assert.deepEqual(qa('[data-testid^="manage-source-custom"], [data-testid="manage-source-ultimate-guitar"]').map(li => li.getAttribute('data-testid')), ['manage-source-custom-2', 'manage-source-ultimate-guitar'])
    assert.equal(byLabel('Move Second up').disabled, true)
  } finally { await act(async () => root.unmount()) }
})

test('#516 enable checkbox and search mode persist; Primary tag marks the first enabled search source', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Enable Ultimate Guitar'))
    assert.equal(stored().sources[0].enabled, false)
    await click(byLabel('Enable Ultimate Guitar'))
    await click(qa('[role="radio"]')[1])
    assert.equal(stored().mode, 'primary')
    assert.deepEqual(qa('[role="radio"]').map(radio => radio.getAttribute('aria-checked')), ['false', 'true'])
    assert.match(q('[data-testid="manage-source-ultimate-guitar"]').textContent, /Primary/)
    await click(qa('[role="radio"]')[0])
    assert.equal(stored().mode, 'all')
    assert.match(q('[data-testid="manage-source-ultimate-guitar"]').textContent, /Search/)
  } finally { await act(async () => root.unmount()) }
})

test('#516 supported WorshipChords is added as a link source, not a search provider', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Add WorshipChords'))
    const row = q('[data-testid="manage-source-worshipchords"]')
    assert.match(row.textContent, /Link/)
    assert.doesNotMatch(row.textContent, /Search/)
    assert.equal(stored().sources.at(-1).kind, 'shortcut')
    assert.equal(byLabel('Add WorshipChords'), undefined)
  } finally { await act(async () => root.unmount()) }
})

test('#516 restore defaults needs a confirm step and only then resets list, order and mode', async () => {
  const { root } = await mount()
  try {
    await click(qa('[role="radio"]')[1])
    await addWebsite('Extra', 'extra.example.org')
    await click(byLabel('Remove Ultimate Guitar'))
    await click(buttonText('Restore Defaults'))
    assert.ok(q('[role="group"][aria-label="Confirm restore defaults"]'))
    await click(buttonText('Cancel'))
    assert.deepEqual(stored().sources.map(source => source.name), ['Extra'])
    await click(buttonText('Restore Defaults'))
    await click(buttonText('Restore defaults'))
    assert.deepEqual(stored().sources.map(source => source.id), ['ultimate-guitar'])
    assert.equal(stored().mode, 'all')
  } finally { await act(async () => root.unmount()) }
})

test('#516 every interactive control has an accessible name and the status region is polite', async () => {
  const { root } = await mount()
  try {
    await addWebsite('Named', 'named.example.org')
    await click(byLabel('Help for sources'))
    for (const el of qa('[data-testid="online-sources-row"] button, [data-testid="online-sources-row"] a, [data-testid="online-sources-row"] input')) {
      const name = el.getAttribute('aria-label') || el.textContent.trim() || (el.labels && [...el.labels].map(label => label.textContent.trim()).join(''))
      assert.ok(name, `unnamed control: ${el.outerHTML.slice(0, 80)}`)
    }
    assert.equal(q('[data-testid="manage-sources-status"]').getAttribute('aria-live'), 'polite')
    assert.match(q('[data-testid="manage-sources-status"]').textContent, /Website added/)
  } finally { await act(async () => root.unmount()) }
})

test('#516 online results show their source name on the right', async () => {
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

test('#516 Header uses one Online song sources row with no separate Manage Sources button', () => {
  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.match(header, /<OnlineSourcesRow rowClass=\{popoverItem\} enabled=\{onlineSourcesEnabled\} onToggle=\{setOnlineSourcesEnabled\} onOpenDialog=\{openOnlineSourcesDialog\} \/>/)
  assert.doesNotMatch(header, /settings-manage-sources|ManageSourcesModal|profile-web-sources/)
  assert.equal(fs.existsSync(path.join(__dirname, '../src/components/ManageSourcesModal.tsx')), false)
  const row = fs.readFileSync(path.join(__dirname, '../src/components/OnlineSourcesRow.tsx'), 'utf8')
  assert.match(row, /<AppModalSection title="Sources">/)
})

test('#516 search links render as a separate bottom section that opens in a new tab', async () => {
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  const links = [{ id: 'worshipchords', name: 'WorshipChords', href: 'https://worshipchords.com/?s=relentless' }]
  await act(async () => {
    root.render(React.createElement(SearchResults, {
      songs: [], setlists: [], online: [], searchLinks: links,
      onSelectSong() {}, onSelectSetlist() {}, onPreviewOnline() {},
    }))
  })
  try {
    const rows = qa('[data-testid="search-link-row"]')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].tagName, 'A')
    assert.equal(rows[0].getAttribute('href'), 'https://worshipchords.com/?s=relentless')
    assert.equal(rows[0].getAttribute('target'), '_blank')
    assert.equal(rows[0].getAttribute('rel'), 'noopener noreferrer')
    assert.match(rows[0].textContent, /Search on WorshipChords/)
    assert.match(rows[0].textContent, /opens in a new tab/)
    assert.equal(q('[data-testid="online-result-source"]'), null, 'not mixed into online results')
    assert.doesNotMatch(document.body.textContent, /Preview & Import a chart|Browse external song sources/)
  } finally { await act(async () => root.unmount()) }
})

test('#516 no search link rows without links', async () => {
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(SearchResults, { songs: [], setlists: [], online: [], onSelectSong() {}, onSelectSetlist() {}, onPreviewOnline() {} }))
  })
  try { assert.equal(qa('[data-testid="search-link-row"]').length, 0) } finally { await act(async () => root.unmount()) }
})

test('#516 Header passes search links only while online sources are enabled', () => {
  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.match(header, /searchLinks=\{onlineSourcesEnabled \? getSearchLinks\(onlineSourceSettings, searchQuery\) : \[\]\}/)
})

test('#516 Website form takes an optional Search URL and rejects one without {query}', async () => {
  const { root } = await mount()
  try {
    await click(buttonText('Website'))
    await type(byLabel('Name (optional)'), 'Songs')
    await type(byLabel('Website URL'), 'songs.example.org')
    await type(byLabel('Search URL (optional)'), 'https://songs.example.org/')
    await submitForm()
    assert.match(q('#online-sources-form-error').textContent, /\{query\}/)
    assert.equal(localStorage.getItem(settings.ONLINE_SOURCE_SETTINGS_KEY), null, 'invalid form saves nothing')
    await type(byLabel('Search URL (optional)'), 'https://songs.example.org/?q={query}')
    await submitForm()
    assert.equal(stored().sources.at(-1).searchUrl, 'https://songs.example.org/?q={query}')
    await click(byLabel('Edit Songs'))
    assert.equal(byLabel('Search URL (optional)').value, 'https://songs.example.org/?q={query}')
    await type(byLabel('Search URL (optional)'), '')
    await submitForm()
    assert.equal('searchUrl' in stored().sources.at(-1), false)
  } finally { await act(async () => root.unmount()) }
})

test('#516 added WorshipChords keeps its curated search URL', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Add WorshipChords'))
    assert.equal(stored().sources.at(-1).searchUrl, 'https://worshipchords.com/?s={query}')
  } finally { await act(async () => root.unmount()) }
})

test('#516 search dropdown has no Import or Browse rows and Header no longer wires them', () => {
  const results = fs.readFileSync(path.join(__dirname, '../src/components/SearchResults.tsx'), 'utf8')
  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.doesNotMatch(results, /onOpenImport|onOpenSources|Browse external song sources|Import a chart/)
  assert.doesNotMatch(header, /onOpenImport=|onOpenSources=|onSearchWebExternal|onOpenWebsiteUrlSource|onOpenImportModal/)
  assert.match(results, /empty:hidden/, 'empty bottom block leaves no stray divider')
})
