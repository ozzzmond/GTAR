// #516 PR B: Manage Sources panel behavior, persistence, empty state, validation and accessibility.
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
const { ManageSourcesModal } = require('../src/components/ManageSourcesModal.tsx')
const settings = require('../src/utils/onlineSourceSettings.ts')

const q = selector => document.querySelector(selector)
const qa = selector => [...document.querySelectorAll(selector)]
const stored = () => JSON.parse(localStorage.getItem(settings.ONLINE_SOURCE_SETTINGS_KEY))
const byLabel = label => qa('button, a, input').find(el => el.getAttribute('aria-label') === label)

async function mount(props = {}) {
  localStorage.clear()
  if (props.seed) localStorage.setItem(settings.ONLINE_SOURCE_SETTINGS_KEY, JSON.stringify(props.seed))
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  const calls = { closed: 0 }
  await act(async () => {
    root.render(React.createElement(ManageSourcesModal, {
      isOpen: props.isOpen ?? true,
      onClose: () => { calls.closed += 1 },
      onlineSourcesEnabled: props.onlineSourcesEnabled ?? true,
    }))
  })
  return { root, calls }
}
async function click(el) { await act(async () => { el.click() }) }
async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}
async function submitForm() { await act(async () => { q('[data-testid="manage-sources-form"]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) }) }
async function addWebsite(name, url) {
  const [nameInput, urlInput] = qa('[data-testid="manage-sources-form"] input')
  await type(nameInput, name)
  await type(urlInput, url)
  await submitForm()
}

test('#516 modal renders an accessible dialog with default UG source, mode choices and supported list', async () => {
  const { root } = await mount()
  try {
    const dialog = q('[role="dialog"]')
    assert.equal(dialog.getAttribute('aria-modal'), 'true')
    assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Manage Sources')
    assert.ok(q('[data-testid="manage-source-ultimate-guitar"]'))
    assert.match(q('[data-testid="manage-source-ultimate-guitar"]').textContent, /Search provider: results appear in GTAR/)
    assert.deepEqual(qa('input[type="radio"]').map(radio => radio.checked), [true, false])
    assert.match(dialog.textContent, /All enabled supported search providers/)
    assert.match(dialog.textContent, /Primary provider only/)
    assert.match(dialog.textContent, /Supported Song Sources/)
    assert.match(dialog.textContent, /not an endorsement/)
    assert.doesNotMatch(dialog.textContent, /Verified/i)
    assert.ok(byLabel('Add WorshipChords'))
    assert.equal(byLabel('Add Ultimate Guitar'), undefined)
  } finally { await act(async () => root.unmount()) }
})

test('#516 closed modal renders nothing and Escape or the close button close it', async () => {
  const closedRender = await mount({ isOpen: false })
  assert.equal(q('[role="dialog"]'), null)
  await act(async () => closedRender.root.unmount())
  const { root, calls } = await mount()
  try {
    await act(async () => { q('[role="dialog"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    assert.equal(calls.closed, 1)
    await click(byLabel('Close Manage Sources'))
    assert.equal(calls.closed, 2)
    assert.equal(document.activeElement, byLabel('Close Manage Sources'))
  } finally { await act(async () => root.unmount()) }
})

test('#516 global status explains when Online song sources is off', async () => {
  const off = await mount({ onlineSourcesEnabled: false })
  assert.match(q('[data-testid="manage-sources-global-status"]').textContent, /Off.*no online search runs.*Local search always works/)
  await act(async () => off.root.unmount())
  const on = await mount({ onlineSourcesEnabled: true })
  assert.match(q('[data-testid="manage-sources-global-status"]').textContent, /On\./)
  await act(async () => on.root.unmount())
})

test('#516 removing UG shows the empty state, persists, and can be re-added manually', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Remove Ultimate Guitar'))
    assert.ok(q('[data-testid="manage-sources-empty"]'))
    assert.match(q('[data-testid="manage-sources-empty"]').textContent, /Local search still works/)
    assert.deepEqual(stored().sources, [])
    assert.ok(byLabel('Add Ultimate Guitar'))
    await click(byLabel('Add Ultimate Guitar'))
    assert.equal(q('[data-testid="manage-sources-empty"]'), null)
    assert.deepEqual(stored().sources.map(source => source.id), ['ultimate-guitar'])
  } finally { await act(async () => root.unmount()) }
})

test('#516 a saved empty list is not replaced by defaults when the panel opens again', async () => {
  const { root } = await mount({ seed: { version: 1, mode: 'all', sources: [] } })
  try {
    assert.ok(q('[data-testid="manage-sources-empty"]'))
    assert.equal(q('[data-testid="manage-source-ultimate-guitar"]'), null)
  } finally { await act(async () => root.unmount()) }
})

test('#516 custom website shortcut: add, open link, edit and remove', async () => {
  const { root } = await mount()
  try {
    await addWebsite('Church Chords', 'chords.example.org/songs')
    assert.equal(stored().sources.at(-1).url, 'https://chords.example.org/songs')
    const link = byLabel('Open Church Chords in a new tab')
    assert.equal(link.getAttribute('href'), 'https://chords.example.org/songs')
    assert.equal(link.getAttribute('target'), '_blank')
    assert.match(link.getAttribute('rel'), /noopener/)
    assert.match(link.getAttribute('rel'), /noreferrer/)
    assert.match(q('[data-testid="manage-source-custom-2"]').textContent, /Website shortcut: opens in your browser/)

    await click(byLabel('Edit Church Chords'))
    assert.match(q('#manage-sources-custom-heading').textContent, /Edit website shortcut/)
    assert.equal(qa('[data-testid="manage-sources-form"] input')[1].value, 'https://chords.example.org/songs')
    await type(qa('[data-testid="manage-sources-form"] input')[0], 'Renamed Site')
    await submitForm()
    assert.equal(stored().sources.at(-1).name, 'Renamed Site')
    assert.match(q('#manage-sources-custom-heading').textContent, /Add custom website URL/)

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
      assert.equal(q('input[type="url"]').getAttribute('aria-invalid'), 'true')
      assert.equal(q('input[type="url"]').getAttribute('aria-describedby'), alert.id)
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
    assert.deepEqual(qa('[data-testid^="manage-source-"]:not([data-testid="manage-sources-empty"])').map(li => li.getAttribute('data-testid')), ['manage-source-custom-2', 'manage-source-ultimate-guitar'])
    assert.equal(byLabel('Move Second up').disabled, true)
  } finally { await act(async () => root.unmount()) }
})

test('#516 enable toggle and search mode persist; primary badge marks the first enabled provider', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Enable Ultimate Guitar'))
    assert.equal(stored().sources[0].enabled, false)
    assert.match(q('[data-testid="manage-source-ultimate-guitar"]').textContent, /Disabled/)
    assert.match(q('[data-testid="manage-sources-modal"]').textContent, /No search provider is enabled/)
    await click(byLabel('Enable Ultimate Guitar'))
    await click(qa('input[type="radio"]')[1])
    assert.equal(stored().mode, 'primary')
    assert.match(q('[data-testid="manage-source-ultimate-guitar"]').textContent, /Primary/)
    await click(qa('input[type="radio"]')[0])
    assert.equal(stored().mode, 'all')
  } finally { await act(async () => root.unmount()) }
})

test('#516 supported WorshipChords is added as an external shortcut, not a search provider', async () => {
  const { root } = await mount()
  try {
    await click(byLabel('Add WorshipChords'))
    const row = q('[data-testid="manage-source-worshipchords"]')
    assert.match(row.textContent, /Website shortcut/)
    assert.doesNotMatch(row.textContent, /Search provider/)
    assert.equal(stored().sources.at(-1).kind, 'shortcut')
    assert.equal(byLabel('Add WorshipChords'), undefined)
  } finally { await act(async () => root.unmount()) }
})

test('#516 restore defaults needs a confirm step and only then resets list, order and mode', async () => {
  const { root } = await mount()
  try {
    await click(qa('input[type="radio"]')[1])
    await addWebsite('Extra', 'extra.example.org')
    await click(byLabel('Remove Ultimate Guitar'))
    await click(qa('button').find(button => button.textContent === 'Restore Defaults'))
    assert.ok(q('[role="group"][aria-label="Confirm restore defaults"]'))
    await click(qa('button').find(button => button.textContent === 'Keep my list'))
    assert.deepEqual(stored().sources.map(source => source.name), ['Extra'])
    await click(qa('button').find(button => button.textContent === 'Restore Defaults'))
    await click(qa('button').find(button => button.textContent === 'Restore defaults'))
    assert.deepEqual(stored().sources.map(source => source.id), ['ultimate-guitar'])
    assert.equal(stored().mode, 'all')
  } finally { await act(async () => root.unmount()) }
})

test('#516 every interactive control has an accessible name and the status region is polite', async () => {
  const { root } = await mount()
  try {
    await addWebsite('Named', 'named.example.org')
    for (const el of qa('[role="dialog"] button, [role="dialog"] a, [role="dialog"] input')) {
      const name = el.getAttribute('aria-label') || el.textContent.trim() || (el.labels && [...el.labels].map(label => label.textContent.trim()).join(''))
      assert.ok(name, `unnamed control: ${el.outerHTML.slice(0, 80)}`)
    }
    assert.equal(q('[data-testid="manage-sources-status"]').getAttribute('aria-live'), 'polite')
    assert.match(q('[data-testid="manage-sources-status"]').textContent, /Website shortcut added/)
  } finally { await act(async () => root.unmount()) }
})

test('#516 Header exposes Manage Sources under Advanced Tools without a second Web Sources entry', () => {
  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.match(header, /data-testid="settings-manage-sources"/)
  assert.match(header, /<ManageSourcesModal[\s\S]*?onlineSourcesEnabled=\{onlineSourcesEnabled\}/)
  assert.match(header, /showManageSources/)
  assert.doesNotMatch(header, /data-testid="profile-web-sources"/)
  const modal = fs.readFileSync(path.join(__dirname, '../src/components/ManageSourcesModal.tsx'), 'utf8')
  assert.match(modal, /sm:max-w-lg/)
  assert.match(modal, /overflow-y-auto/)
  assert.match(modal, /min-h-11/)
})
