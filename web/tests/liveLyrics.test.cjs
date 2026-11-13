const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function(request, parent, ...args) {
  try { return resolve.call(this, request, parent, ...args) } catch (error) {
    if (request.startsWith('.') && parent) for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const file = path.resolve(path.dirname(parent.filename), request + ext)
      if (fs.existsSync(file)) return file
    }
    throw error
  }
}
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename)
const { parseGtarSong, splitSongLinesForColumns } = require('../src/utils/songParser.ts')
const { projectLyrics, matchLiveLyrics, matchLiveLyricRanges, lyricTokens } = require('../src/utils/liveLyrics.ts')
const React = require('react'), { act } = React
const { SongLineRenderer } = require('../src/components/SongLineRenderer.tsx')
const { renderToStaticMarkup } = require('react-dom/server')

const chart = '{title: Synthetic}\n{key: C}\n{original_key: C}\n{comment: Verse}\nC         G\nMorning light fills the sky\n[D]We sing [G]together\n{comment: Chorus}\nMorning light fills the sky\nWe sing together'

test('read-only projection excludes chords, TAB, headings and metadata; complete lines allow different wraps and all duplicates', () => {
  const parsed = parseGtarSong(chart, 3), before = JSON.stringify(parsed)
  const projection = projectLyrics(parsed.lines)
  assert.equal(projection.length, 4)
  assert.equal(matchLiveLyricRanges(projection, 'Morning light fills the sky We sing together').length, 2)
  assert.equal(matchLiveLyricRanges(projection, 'We sing together').length, 2)
  const expected = projection.map(line => line.anchorId)
  assert.deepEqual([...matchLiveLyrics(projection, 'Morning light\nfills the sky!\nWe sing together')], expected)
  assert.equal(matchLiveLyrics(projection, 'light fills the sky').size, 0)
  assert.equal(matchLiveLyrics(projection, 'We sing together Morning light fills the sky').size, 0, 'no crossing section boundaries')
  for (const text of ['', '   ', 'C G D', 'Verse', 'Synthetic', 'Unmatched words']) assert.equal(matchLiveLyrics(projection, text).size, 0)
  assert.deepEqual(lyricTokens('ＤＯＮ’Ｔ — café, 你好!'), ['dont', 'café', '你好'])
  assert.notDeepEqual(lyricTokens('café'), lyricTokens('cafe'))
  const tab = projectLyrics([{ type: 'TAB', content: 'Morning light fills the sky' }, { type: 'CHORD_ROW', raw: 'C G', chords: ['C', 'G'] }, { type: 'LYRIC', lyrics: 'Amen' }])
  assert.deepEqual([...matchLiveLyrics(tab, 'amen')], [2])
  assert.equal(JSON.stringify(parsed), before)
})

test('both columns highlight all visible chord/lyric anchors while preserving chord interactions and typography', () => {
  const lines = parseGtarSong(chart, 2).lines
  const ids = matchLiveLyrics(projectLyrics(lines), 'Morning light fills the sky We sing together')
  const [first, second] = splitSongLinesForColumns(lines)
  const render = (active) => renderToStaticMarkup(React.createElement('div', {},
    React.createElement(SongLineRenderer, { lines: first, fontSizePx: 24, activeLineIds: active }),
    React.createElement(SongLineRenderer, { lines: second, fontSizePx: 24, lineOffset: first.length, activeLineIds: active })))
  const normal = render(undefined), highlighted = render(ids)
  assert.equal((highlighted.match(/data-live-lyric="true"/g) || []).length, 4)
  assert.equal(highlighted.replaceAll(' data-live-lyric="true"', ''), normal)
  const indices = [...highlighted.matchAll(/data-line-index="(\d+)"/g)].map(m => Number(m[1]))
  assert.equal(new Set(indices).size, indices.length)
  assert.match(highlighted, /role="button"/)
})

test('fullscreen assisted session follows current only, clears stale matches, requires reconfirmation and leaves chart/keys/scroll untouched', async t => {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  const descriptors = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const { createRoot } = require('react-dom/client')
  const { ExtensionHost } = require('../src/extensions/host/ExtensionHost.ts')
  const { ExtensionHostContext } = require('../src/extensions/host/ExtensionHostContext.ts')
  const { useLiveLyrics } = require('../src/utils/useLiveLyrics.ts')
  const { LiveLyricsControl } = require('../src/components/LiveLyrics.tsx')
  const { AuthContext } = require('../src/utils/authContext.ts')
  const { bandSync } = require('../src/utils/bandSync.ts'), { stageCast } = require('../src/utils/stageCast.ts')
  const outgoing = []
  for (const [object, method] of [[bandSync, 'broadcastScroll'], [bandSync, 'broadcastSong'], [stageCast, 'broadcastScroll'], [stageCast, 'broadcastState']]) t.mock.method(object, method, (...args) => outgoing.push(args))
  const writes = [], logs = []
  let ctx
  const manifest = { id: 'propresenter-follower', name: 'Fixture', version: '1', contractVersion: 1, summary: '', settings: [], capabilities: [] }
  const entry = { manifest, checkAvailability: () => ({ available: true }), load: async () => ({ manifest, checkAvailability: () => ({ available: true }), activate: value => { ctx = value; return () => {} } }) }
  const host = new ExtensionHost([entry], { getItem: () => null, setItem: (...args) => writes.push(args) }, undefined, message => logs.push(message))
  await host.enable(manifest.id)
  let song = Object.freeze({ id: 1, title: 'Synthetic', rawContent: chart, key: 'C', originalKey: 'C', confirmedChartKey: 'C', transposeOffset: 3 })
  const before = JSON.stringify(song), lines = parseGtarSong(chart, 3).lines
  let fullscreen = false, suspended = false, account = 'one', navigation = 'library', live
  const snapshot = { live: true, presentation: { uuid: 'presentation-a', title: 'Synthetic presentation', slideIndex: 0 }, current: { uuid: 'slide-a', text: 'Morning light fills the sky' } }
  const { useExtensionHost } = require('../src/extensions/host/useExtensionHost.ts')
  function HeaderObserver() { assert.equal(useExtensionHost(), host); return null }
  function Harness() {
    live = useLiveLyrics(song, lines, fullscreen, suspended, navigation)
    return React.createElement('div', { id: 'viewport' }, !fullscreen && React.createElement(HeaderObserver), fullscreen && React.createElement(LiveLyricsControl, { live, songTitle: song.title }), React.createElement(SongLineRenderer, { lines, fontSizePx: 24, activeLineIds: live.activeLineIds }))
  }
  const root = createRoot(document.getElementById('root'))
  const render = async () => act(async () => root.render(React.createElement(ExtensionHostContext.Provider, { value: host }, React.createElement(AuthContext.Provider, { value: { session: { user: { sub: account } } } }, React.createElement(Harness)))))
  const emit = async value => act(async () => ctx.publishFollowSnapshot(value))
  const confirm = async () => act(async () => { document.querySelector('button').click() })
  const count = () => document.querySelectorAll('[data-live-lyric="true"]').length
  try {
    await emit(snapshot); await render()
    assert.equal(count(), 0); assert.equal(document.querySelector('button'), null)
    fullscreen = true; await render()
    assert.equal(count(), 0); assert.equal(live.canConfirm, true)
    assert.equal(ctx.signal.aborted, false, 'Header unmount must preserve inherited follower')
    await confirm(); assert.equal(count(), 2)
    const viewport = document.getElementById('viewport'); viewport.scrollTop = 37
    await emit({ ...snapshot, current: { uuid: 'slide-b', text: 'We sing together' }, next: { text: 'Morning light fills the sky' } })
    assert.equal(count(), 2)
    assert.deepEqual([...live.activeLineIds], projectLyrics(lines).filter(p => p.tokens[0] === 'we').map(p => p.anchorId))
    assert.equal(viewport.scrollTop, 37)
    for (const text of ['', 'Unmatched content']) {
      await emit({ ...snapshot, current: { uuid: 'slide-b', text } }); assert.equal(count(), 0)
      assert.equal(live.status, text ? 'Slide not matched' : 'Blank slide')
    }
    await emit(snapshot); assert.equal(count(), 2)
    for (const invalidate of [
      async () => { fullscreen = false; await render(); fullscreen = true; await render() },
      async () => { account = 'two'; await render(); account = 'one'; await render() },
      async () => { navigation = 'setlist'; await render() },
      async () => { song = Object.freeze({ ...song, id: '1' }); await render(); song = Object.freeze({ ...song, id: 1 }); await render() },
      async () => { suspended = true; await render(); suspended = false; await render() },
      async () => { await emit({ ...snapshot, live: false }); await emit(snapshot) },
      async () => { await emit({ ...snapshot, presentation: { ...snapshot.presentation, uuid: 'presentation-b' } }); await emit(snapshot) },
    ]) {
      await invalidate(); assert.equal(count(), 0); assert.equal(live.confirmed, false)
      await confirm(); assert.equal(count(), 2)
    }
    await act(async () => host.disable(manifest.id)); assert.equal(count(), 0)
    assert.equal(JSON.stringify(song), before)
    assert.equal(viewport.scrollTop, 37)
    assert.deepEqual(outgoing, []); assert.deepEqual(logs, [])
    assert.equal(JSON.stringify(writes).includes('Morning'), false)
  } finally {
    await act(async () => root.unmount()); host.dispose(); dom.window.close()
    for (const [key, descriptor] of descriptors) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  }
})



test('Stage wiring uses native fullscreen and all overlay/sync guards; provider excludes TV receiver startup', () => {
  const stage = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')
  const app = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8')
  assert.match(stage, /useLiveLyrics\(song, parsedSong.lines, isFullscreen,/)
  assert.match(stage, /isAnyOverlayActive \|\| syncState.role !== 'OFF' \|\| isCastActive/)
  assert.match(stage, /isFullscreen && <LiveLyricsControl/)
  assert.match(app, /<ExtensionHostProvider><LibraryStartupReadyInner \/><\/ExtensionHostProvider>/)
  assert.match(app, /if \(isPresentationRoute\) \{\s*return <StagePresentationView \/>/)
})
