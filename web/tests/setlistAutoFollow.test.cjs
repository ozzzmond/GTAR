const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file)
const { SetlistAutoFollower, resolveSetlistPresentation, projectFollowSetlist, normalizePresentationTitle } = require('../src/utils/setlistAutoFollow.ts')
const songs = [
  { id: 1, title: 'Amazing Grace (My Chains Are Gone)', key: 'C', originalKey: 'C', confirmedChartKey: 'C', transposeOffset: 3, rawContent: 'Synthetic chart one' },
  { id: 2, title: 'Hosanna', key: 'D', originalKey: 'D', confirmedChartKey: 'D', transposeOffset: -2, rawContent: 'Synthetic chart two' },
  { id: 3, title: 'What a Beautiful Name', key: 'E', originalKey: 'E', confirmedChartKey: 'E', transposeOffset: 1, rawContent: 'Synthetic chart three' },
]
function context(entries = songs) {
  const list = { id: 'active', name: 'QA', songs: entries.map((song, i) => ({ id: song.id, entryId: `entry-${i}`, position: i, title: song.title })) }
  return { list, projection: projectFollowSetlist('active', 'setlist', list, entries) }
}
function fixture(t, ctx = context([songs[2], songs[0], songs[1]]).projection) {
  let next = 0, refreshes = 0
  const timers = new Map(), selections = []
  const controller = new SetlistAutoFollower(fn => { timers.set(++next, fn); return next }, id => timers.delete(id))
  const snapshot = (song = songs[0], rev = 1, connection = 1) => ({ live: true, connection, identityRevision: rev, session: rev, presentation: { uuid: `p-${song.id}`, title: song.title, slideIndex: 0 }, current: { uuid: `s-${song.id}`, text: 'Unverified content' } })
  let source = snapshot()
  let input = { dev: true, fullscreen: true, suspended: false, account: 'account-one', context: ctx, selectedIndex: 1, manualRevision: 0, snapshot: source,
    readSnapshot: () => source, refresh: () => refreshes++, select: request => { if (!request.isCurrent()) return false; selections.push(request.index); return true } }
  const update = change => { input = { ...input, ...change }; controller.update(input) }
  const emit = (song, rev, connection = 1) => { source = snapshot(song, rev, connection); update({ snapshot: source }) }
  const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()) }
  const commit = () => { if (selections.length) update({ selectedIndex: selections.at(-1) }) }
  controller.update(input)
  t.after(controller.dispose)
  return { controller, timers, selections, flush, commit, emit, update, get source() { return source }, setSource(value) { source = value }, get input() { return input }, get refreshes() { return refreshes } }
}

test('title normalization is exact, retains versions/punctuation and distinguishes typed song identities', () => {
  assert.equal(normalizePresentationTitle('  \uff28\uff2f\uff33\uff21\uff2e\uff2e\uff21 \n '), 'hosanna')
  assert.equal(normalizePresentationTitle('King\u2019s\u2014Song'), "king's-song")
  const { projection } = context()
  assert.equal(resolveSetlistPresentation(projection, 0, 'Amazing Grace').kind, 'absent')
  assert.deepEqual(resolveSetlistPresentation(projection, 0, ' HOSANNA '), { kind: 'target', index: 1 })
  const duplicate = context([{ ...songs[0], id: 1, title: 'Shared' }, { ...songs[1], id: '1', title: 'Shared' }]).projection
  assert.equal(resolveSetlistPresentation(duplicate, 0, 'Shared').kind, 'ambiguous')
})

test('active-setlist projection rejects fallback queue/setlist, deleted/empty/malformed data and guessed song identity', () => {
  const { list } = context()
  for (const [id, queue, value, entries] of [
    ['other', 'setlist', list, songs], ['active', 'library', list, songs], ['active', 'setlist', { ...list, isDeleted: true }, songs],
    ['active', 'setlist', { ...list, songs: [] }, []], ['active', 'setlist', null, songs],
  ]) assert.equal(projectFollowSetlist(id, queue, value, entries), null)
  const guessed = projectFollowSetlist('active', 'setlist', list, [{ ...songs[0], id: '1' }, { ...songs[1], isMissing: true }, { ...songs[2], isDeleted: true }])
  assert.ok(guessed.entries.every(entry => !entry.eligible))
  assert.equal(resolveSetlistPresentation(guessed, 0, songs[0].title).kind, 'absent')
})

test('explicit opt-in follows all three songs forward/backward with differing order; chart/key/setlist data stay unchanged', t => {
  const before = JSON.stringify(songs), ctx = context([songs[2], songs[0], songs[1]])
  const setlistBefore = JSON.stringify(ctx.list), f = fixture(t, ctx.projection)
  f.emit(songs[1], 2); f.flush(); assert.deepEqual(f.selections, [], 'Assisted is default')
  f.controller.enable(); f.flush(); f.commit()
  f.emit(songs[2], 3); f.flush(); f.commit()
  f.emit(songs[1], 4); f.flush(); f.commit()
  f.emit(songs[0], 5); f.flush(); f.commit()
  assert.deepEqual(f.selections, [2, 0, 2, 1])
  assert.equal(f.controller.getSnapshot().paused, false)
  assert.equal(JSON.stringify(songs), before); assert.equal(JSON.stringify(ctx.list), setlistBefore)
})

test('outside-setlist, blank title and stale UUID link never fall back to the library or arbitrary ordering', t => {
  const f = fixture(t, context([songs[0]]).projection)
  f.update({ selectedIndex: 0 }); f.controller.enable(); f.flush()
  f.emit(songs[1], 2); f.flush()
  assert.equal(f.controller.getSnapshot().status, 'Not in current setlist'); assert.deepEqual(f.selections, [])
  f.emit({ ...songs[0], title: '' }, 3); f.flush(); assert.deepEqual(f.selections, [])
})

test('duplicate distinct titles require explicit choice; explicit UUID association takes priority without title auto-linking', t => {
  const entries = [{ ...songs[0], title: 'Shared' }, { ...songs[1], title: 'Shared' }, songs[2]]
  const f = fixture(t, context(entries).projection)
  f.update({ selectedIndex: 2 }); f.emit(entries[0], 1); f.controller.enable(); f.flush()
  assert.equal(f.controller.getSnapshot().choices.length, 2); assert.deepEqual(f.selections, [])
  f.controller.choose(0); f.commit(); assert.deepEqual(f.selections, [0])
  f.emit(songs[2], 2); f.flush(); f.commit()
  f.emit({ ...entries[0], title: 'Renamed presentation' }, 3); f.flush(); f.commit()
  assert.deepEqual(f.selections, [0, 2, 0])
  const g = fixture(t)
  g.controller.enable(); g.flush()
  g.emit({ ...songs[0], title: songs[1].title }, 2); g.flush()
  assert.deepEqual(g.selections, [2], 'a prior automatic title match must not create a UUID link')
})

test('duplicate occurrences preserve current entry; otherwise explicit entry selection is required', t => {
  const ctx = context([songs[0], songs[1], songs[0]]).projection
  assert.deepEqual(resolveSetlistPresentation(ctx, 2, songs[0].title), { kind: 'target', index: 2 })
  assert.equal(resolveSetlistPresentation(ctx, 1, songs[0].title).kind, 'ambiguous')
  const f = fixture(t, ctx); f.update({ selectedIndex: 1 }); f.controller.enable(); f.flush()
  assert.deepEqual(f.selections, []); assert.equal(f.controller.getSnapshot().choices.length, 2)
  f.controller.choose(2); assert.deepEqual(f.selections, [2])
})

test('manual song selection including same-entry action overrides pending/next identities until explicit Resume', t => {
  const f = fixture(t); f.controller.enable()
  f.controller.override(); f.flush(); assert.deepEqual(f.selections, [])
  f.update({ manualRevision: 1 }); f.emit(songs[1], 2); f.flush(); assert.deepEqual(f.selections, [])
  f.controller.resume(); f.flush(); f.commit(); assert.deepEqual(f.selections, [2])
  f.update({ selectedIndex: 0, manualRevision: 2 }); f.emit(songs[0], 3); f.flush()
  assert.deepEqual(f.selections, [2]); assert.equal(f.controller.getSnapshot().paused, true)
})

test('fullscreen/modal/sync/account/setlist boundary changes cancel pending selection and require fresh identity plus Resume', t => {
  for (const change of [{ fullscreen: false }, { suspended: true }, { account: 'two' }, { context: null }, { context: context().projection }]) {
    const f = fixture(t); f.controller.enable(); f.emit(songs[1], 2)
    const stale = [...f.timers.values()]
    f.update(change); stale.forEach(fn => fn()); f.flush(); assert.deepEqual(f.selections, [])
    f.update({ fullscreen: true, suspended: false, context: f.input.context ?? context().projection })
    f.controller.resume(); f.flush(); assert.deepEqual(f.selections, [])
    assert.ok(f.refreshes >= 1)
    f.emit(songs[1], 3); f.flush(); assert.deepEqual(f.selections, [], 'fresh frames alone do not resume navigation')
    f.controller.resume(); f.flush()
    assert.ok(f.selections.length <= 1)
  }
})

test('disconnect/reconnect cancels obsolete work without replay or clearing manual override', t => {
  const f = fixture(t); f.controller.enable(); f.emit(songs[1], 2)
  const old = [...f.timers.values()]
  f.setSource({ ...f.source, live: false }); f.update({ snapshot: f.source }); old.forEach(fn => fn())
  assert.deepEqual(f.selections, [])
  f.emit(songs[2], 3, 2); f.flush(); assert.deepEqual(f.selections, [])
  f.controller.resume(); f.flush(); assert.deepEqual(f.selections, [0])
})

test('rapid A->B->A and stale callbacks settle only latest observed identity; last-moment source changes cancel selection', t => {
  const f = fixture(t); f.controller.enable()
  f.emit(songs[1], 2); const obsolete = [...f.timers.values()]
  f.emit(songs[0], 3); obsolete.forEach(fn => fn()); f.flush(); assert.deepEqual(f.selections, [])
  f.emit(songs[2], 4)
  f.setSource({ ...f.source, identityRevision: 5, presentation: { ...f.source.presentation, uuid: 'new-source' } })
  f.flush(); assert.deepEqual(f.selections, [])
  f.emit(songs[1], 6); f.update({}); f.flush(); assert.deepEqual(f.selections, [2], 'benign React renders do not discard a valid settling attempt')
})

test('disabled/outside-fullscreen/missing setlist/production scopes never schedule navigation or refresh', t => {
  for (const change of [{ dev: false }, { fullscreen: false }, { context: null }, { suspended: true }, { snapshot: null }]) {
    const f = fixture(t); f.update(change); f.controller.enable(); f.controller.resume(); f.flush()
    assert.deepEqual(f.selections, []); assert.equal(f.refreshes, 0); assert.equal(f.timers.size, 0)
  }
})

test('App selection boundary and Stage origin guards preserve queue and prevent automatic sync broadcasts', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8').replaceAll('\r\n', '\n')
  const stage = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')
  const handler = app.slice(app.indexOf('const handleFollowSetlistEntry'), app.indexOf('  return (\n    <TagLibraryContext.Provider'))
  assert.match(handler, /current.context !== request.context/)
  assert.match(handler, /current.manualRevision !== request.manualRevision/)
  assert.match(handler, /document.fullscreenElement/)
  assert.match(handler, /setActiveSetlistSongIndex\(request.index\)/)
  assert.doesNotMatch(handler, /setQueueMode|setActiveSetlistId|handleSelectLibrarySong|setSongs|TransposeChange/)
  assert.match(stage, /if \(!isProPresenterSelection\) stageCast.broadcastScroll\(0, 0, 0\)/)
  assert.match(stage, /if \(isProPresenterSelection && !isCastActive\) return\s*stageCast.broadcastState/)
  assert.match(handler, /bandSync.getState\(\).role !== 'OFF'/)
  assert.match(handler, /stageCast.isPresentationActive\(\)/)
})


test('identity-first reconnect frames remain fresh when the other stream subsequently recovers', t => {
  const f = fixture(t); f.controller.enable()
  f.setSource({ ...f.source, live: false, connection: 2 }); f.update({ snapshot: f.source })
  f.setSource({ ...f.source, live: false, connection: 3, identityRevision: 2 }); f.update({ snapshot: f.source })
  f.setSource({ ...f.source, live: true, connection: 4, identityRevision: 2 }); f.update({ snapshot: f.source })
  f.controller.resume(); f.flush()
  assert.equal(f.controller.getSnapshot().paused, false)
  assert.equal(f.refreshes, 0)
})


test('real host and React controls navigate by identity while stale/new slide content stays neutral until separate confirmation', async t => {
  const { JSDOM } = require('jsdom'), React = require('react'), { act } = React
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  const restore = []
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, __GTAR_SETLIST_AUTO_FOLLOW_DEV__: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    restore.push(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key])
  }
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { createRoot } = require('react-dom/client')
  const { ExtensionHost } = require('../src/extensions/host/ExtensionHost.ts')
  const { ExtensionHostContext } = require('../src/extensions/host/ExtensionHostContext.ts')
  const { useLiveLyrics } = require('../src/utils/useLiveLyrics.ts')
  const { useSetlistAutoFollow } = require('../src/utils/useSetlistAutoFollow.ts')
  const { LiveLyricsControl } = require('../src/components/LiveLyrics.tsx')
  const { SetlistAutoFollowControl } = require('../src/components/SetlistAutoFollowControl.tsx')
  const chartSongs = songs.map((song, index) => Object.freeze({ ...song, rawContent: ['Morning light fills the sky', 'A different closing refrain', 'We sing in quiet wonder'][index] }))
  const lines = chartSongs.map(song => [{ type: 'LYRIC', lyrics: song.rawContent }])
  const scope = context(chartSongs).projection, writes = [], selections = []
  const before = JSON.stringify(chartSongs)
  let ctx
  const manifest = { id: 'propresenter-follower', name: 'Fixture', version: '1', contractVersion: 1, summary: '', capabilities: [], settings: [] }
  const entry = { manifest, checkAvailability: () => ({ available: true }), load: async () => ({ manifest, checkAvailability: () => ({ available: true }), activate: value => { ctx = value; return () => {} } }) }
  const host = new ExtensionHost([entry], { getItem: () => null, setItem: (...args) => writes.push(args) })
  await host.enable(manifest.id)
  let fullscreen = true, live, follow
  function Harness() {
    const [index, setIndex] = React.useState(0)
    live = useLiveLyrics(chartSongs[index], lines[index], fullscreen, false, String(index))
    follow = useSetlistAutoFollow(live.snapshot, scope, index, 0, fullscreen, false, request => {
      if (!request.isCurrent() || request.context !== scope) return false
      selections.push(request.index); setIndex(request.index); return true
    })
    return React.createElement('div', {}, React.createElement('p', { id: 'selected' }, chartSongs[index].title),
      React.createElement('span', { id: 'highlight-count' }, live.activeLineIds.size),
      fullscreen && React.createElement(LiveLyricsControl, { live, songTitle: chartSongs[index].title, onConfirmed: follow.controller.associateCurrent }, React.createElement(SetlistAutoFollowControl, { follow })))
  }
  const root = createRoot(document.getElementById('root'))
  const render = async () => act(async () => root.render(React.createElement(ExtensionHostContext.Provider, { value: host }, React.createElement(Harness))))
  const emit = async (index, revision, text = chartSongs[index].rawContent) => act(async () => ctx.publishFollowSnapshot({ live: true, identityRevision: revision, presentation: { uuid: `p-${index}`, title: chartSongs[index].title, slideIndex: 0 }, current: { uuid: `slide-${index}`, text } }))
  const click = async label => act(async () => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.includes(label))
    assert.ok(button, label); assert.equal(button.disabled, false, label); button.click()
  })
  const tick = async () => act(async () => t.mock.timers.tick(300))
  try {
    await emit(0, 1); await render()
    assert.equal(follow.state.mode, 'assisted'); assert.equal(live.activeLineIds.size, 0)
    await click('Confirm same song'); assert.equal(live.activeLineIds.size, 1)
    await click('Enable Auto Follow'); await tick(); assert.deepEqual(selections, [])
    await emit(1, 2, chartSongs[0].rawContent); await tick()
    assert.deepEqual(selections, [1]); assert.equal(document.getElementById('selected').textContent, chartSongs[1].title)
    assert.equal(live.activeLineIds.size, 0); assert.equal(live.scrollRange, null)
    await emit(1, 2); assert.equal(live.canConfirm, true); assert.equal(live.activeLineIds.size, 0)
    await click('Confirm same song'); assert.equal(live.activeLineIds.size, 1)
    await act(async () => follow.controller.override())
    await emit(2, 3); await tick(); assert.deepEqual(selections, [1]); assert.equal(live.activeLineIds.size, 0)
    await click('Resume Auto Follow'); await tick(); assert.deepEqual(selections, [1, 2]); assert.equal(live.activeLineIds.size, 0)
    await emit(0, 4); fullscreen = false; await render(); await tick(); assert.deepEqual(selections, [1, 2])
    fullscreen = true; await render(); await emit(0, 5); await tick(); assert.deepEqual(selections, [1, 2])
    await click('Resume Auto Follow'); await tick(); assert.deepEqual(selections, [1, 2, 0])
    assert.equal(JSON.stringify(chartSongs), before)
    assert.equal(JSON.stringify(writes).includes('Morning'), false)
    await act(async () => host.disable(manifest.id)); await tick(); assert.equal(live.activeLineIds.size, 0)
  } finally {
    await act(async () => root.unmount()); host.dispose(); dom.window.close(); restore.reverse().forEach(fn => fn())
  }
})


test('switching through Assisted cannot bypass fresh-identity requirement after fullscreen re-entry', t => {
  const f = fixture(t)
  f.controller.enable(); f.emit(songs[1], 2)
  f.update({ fullscreen: false }); f.update({ fullscreen: true })
  f.controller.assisted(); f.controller.enable(); f.flush()
  assert.deepEqual(f.selections, [])
  assert.equal(f.controller.getSnapshot().mode, 'assisted')
  assert.equal(f.refreshes, 1)
  f.emit(songs[1], 3); f.controller.enable(); f.flush()
  assert.deepEqual(f.selections, [2])
})
