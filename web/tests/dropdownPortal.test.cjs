const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

for (const width of [320, 1280]) test(`portal actions, viewport bounds and dismissal at ${width}px`, async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 600 })
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.hasAttribute('data-dropdown-portal')
      ? { width: 176, height: 120 }
      : { left: width - 32, right: width - 4, top: 550, bottom: 578, width: 28, height: 28 }
  }
  let selected = 0, deleted = 0
  const root = createRoot(document.getElementById('root'))
  const click = async element => { assert.ok(element); await act(async () => element.click()) }
  const portal = () => document.querySelector('[data-dropdown-portal]')
  const find = id => document.querySelector(`[data-testid="${id}"]`)
  try {
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(SongbookHomeView, {
      songs: [{ id: 'song-1', title: 'Fixture', artist: '', rawContent: '' }],
      setlists: [{ id: 'set-1', name: 'Fixture set', songs: [{ id: 'song-1', title: 'Fixture' }] }],
      activeSongIndex: 0, onSelectSong: () => selected++, onNewSong() {}, onOpenSetlists() {},
      onDeleteSong: () => deleted++, onDeleteSetlist: () => deleted++, onRenameSetlist() {},
      onSongMembershipChange() {}, onCreateSetlistForSong() {},
    }))))
    for (const id of ['song-menu-0', 'setlist-menu-set-1']) {
      const trigger = find(id)
      await click(trigger)
      assert.equal(portal().parentElement, document.body, 'portal escapes card overflow')
      assert.equal(portal().style.position, 'fixed')
      assert.equal(portal().style.zIndex, '25', 'below modal/drawer z-50')
      assert.equal(portal().style.left, `${width - 184}px`)
      assert.equal(portal().style.top, '424px', 'flips above bottom-edge anchor')
      await act(async () => portal().dispatchEvent(new window.Event('scroll')))
      assert.ok(portal(), 'internal menu scrolling remains available')
      portal().querySelector('button').focus()
      await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      assert.equal(portal(), null)
      assert.equal(document.activeElement, trigger)
      for (const [target, type] of [[window, 'scroll'], [trigger.parentElement, 'scroll'], [window, 'resize']]) {
        await click(trigger)
        await act(async () => target.dispatchEvent(new window.Event(type)))
        assert.equal(portal(), null, `${type} dismisses stale position`)
      }
      await click(trigger)
      await click(document.body)
      assert.equal(portal(), null, 'outside click dismisses')
      await click(trigger)
      await click(trigger)
      assert.equal(portal(), null, 'trigger toggles closed')
    }
    await click(find('song-menu-0'))
    await click(find('setlist-menu-set-1'))
    assert.equal(document.querySelectorAll('[data-dropdown-portal]').length, 1)
    await click(find('menu-delete-set-1'))
    assert.equal(portal(), null)
    assert.match(document.body.textContent, /Delete setlist\?/)
    assert.equal(deleted, 0, 'action retains confirmation guard')
    assert.equal(selected, 0, 'menu clicks do not select card')
    await click(find('song-menu-0'))
    const deleteSong = [...portal().querySelectorAll('button')].find(button => button.textContent.includes('Delete Song'))
    await click(deleteSong)
    assert.match(document.body.textContent, /Delete this song\?/)
    assert.equal(deleted, 0)
    Object.defineProperty(window, 'innerWidth', { value: 240 })
    await click(find('song-menu-0'))
    assert.equal(portal().style.left, '56px', 'reopen measures responsive width')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    Object.assign(global, previous)
  }
})

