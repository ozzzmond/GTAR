const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { LiveLyricScroller, liveLyricScrollTarget } = require('../src/utils/liveLyricScroll.ts')
const { JSDOM } = require('jsdom')

function fixture(t, positions = [[0, 1200, 40], [1, 1240, 40]]) {
  const dom = new JSDOM('<div id="viewport"></div>')
  const container = dom.window.document.getElementById('viewport')
  Object.defineProperties(container, { scrollHeight: { value: 4000 }, clientHeight: { value: 600 }, clientWidth: { value: 800 }, offsetWidth: { value: 816 } })
  container.getBoundingClientRect = () => ({ top: 100, bottom: 700, right: 816 })
  for (const [id, top, height] of positions) {
    const element = dom.window.document.createElement('div')
    element.dataset.lineIndex = String(id); element.dataset.liveLyric = 'true'
    element.getBoundingClientRect = () => ({ top: 100 + top - container.scrollTop, bottom: 100 + top + height - container.scrollTop })
    container.append(element)
  }
  let next = 0, outgoing = 0
  const frames = new Map(), moves = []
  const controller = new LiveLyricScroller(fn => { frames.set(++next, fn); return next }, id => frames.delete(id))
  const detach = controller.attach(container)
  container.addEventListener('scroll', () => { if (!controller.handleScroll()) outgoing++ })
  container.scrollTo = options => { moves.push(options); container.scrollTop = options.top; container.dispatchEvent(new dom.window.Event('scroll')) }
  const session = {}
  let input = { enabled: true, session, slideKey: 'current-a', range: positions.map(p => p[0]), speedScrolling: false }
  const update = (change = {}) => { input = { ...input, ...change }; controller.update(input) }
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)) }
  t.after(() => { detach(); dom.window.close() })
  return { dom, container, controller, moves, frames, flush, update, get input() { return input }, get outgoing() { return outgoing } }
}

test('unique verified range below and above viewport aligns near 30%; visible range and unchanged snapshots do not jump', t => {
  const f = fixture(t)
  f.update(); assert.equal(f.frames.size, 1); f.flush()
  assert.equal(f.container.scrollTop, 1020)
  assert.deepEqual(f.moves, [{ top: 1020, behavior: 'instant' }])
  assert.equal(f.controller.getPaused(), false); assert.equal(f.outgoing, 0)
  f.update(); f.flush(); assert.equal(f.moves.length, 1)
  f.container.scrollTop = 2000
  f.update({ slideKey: 'current-b' }); f.flush()
  assert.equal(f.container.scrollTop, 1020)
  f.update({ slideKey: 'current-c' }); f.flush()
  assert.equal(f.moves.length, 2, 'comfortably visible new slide does not move')
})

test('oversized ranges align their beginning safely; target is clamped at top/bottom', () => {
  assert.equal(liveLyricScrollTarget(0, 4000, 600, 1200, 2200), 1104)
  assert.equal(liveLyricScrollTarget(1104, 4000, 600, 1200, 2200), null)
  assert.equal(liveLyricScrollTarget(1000, 4000, 600, 20, 60), 0)
  assert.equal(liveLyricScrollTarget(0, 1400, 600, 1300, 1380), 800)
  assert.equal(liveLyricScrollTarget(0, 4000, 0, 1200, 1240), null)
})

test('ambiguous, blank, unmatched, missing and reversed column geometry never choose an arbitrary target', t => {
  const f = fixture(t)
  f.update({ range: null }); f.flush(); assert.equal(f.moves.length, 0)
  f.update({ range: [99] }); f.flush(); assert.equal(f.moves.length, 0)
  const duplicate = f.container.firstChild.cloneNode(); f.container.append(duplicate)
  f.update({ range: [0] }); f.flush(); assert.equal(f.moves.length, 0)
  const reversed = fixture(t, [[0, 1200, 40], [1, 400, 40]])
  reversed.update(); reversed.flush(); assert.equal(reversed.moves.length, 0)
})

test('manual wheel cancels queued motion, preserves highlighting, and Resume targets the latest current range only', t => {
  const f = fixture(t, [[0, 1200, 40], [1, 2400, 40]])
  f.update({ range: [0] })
  f.container.dispatchEvent(new f.dom.window.Event('wheel'))
  assert.equal(f.frames.size, 0); assert.equal(f.controller.getPaused(), true)
  f.update({ slideKey: 'latest', range: [1] }); f.flush()
  assert.equal(f.moves.length, 0)
  assert.equal(f.container.querySelectorAll('[data-live-lyric="true"]').length, 2)
  f.controller.resume(); f.flush()
  assert.equal(f.container.scrollTop, 2220); assert.equal(f.controller.getPaused(), false)
  assert.equal(f.outgoing, 0)
  // A delayed own scroll event stays suppressed even after manual intent cancels pending work.
  f.controller.pause(); f.container.dispatchEvent(new f.dom.window.Event('scroll'))
  assert.equal(f.outgoing, 0)
})

test('touch drag, scrollbar drag and keyboard pause; taps and editable keys do not', t => {
  for (const kind of ['touch', 'pointer', 'key', 'ctrl-end']) {
    const f = fixture(t)
    f.update()
    const event = (type, data) => { const e = new f.dom.window.Event(type); Object.assign(e, data); f.container.dispatchEvent(e) }
    if (kind === 'touch') {
      event('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
      assert.equal(f.controller.getPaused(), false)
      event('touchmove', { touches: [{ clientX: 100, clientY: 120 }] })
    } else if (kind === 'pointer') event('pointerdown', { pointerType: 'mouse', clientX: 810 })
    else if (kind === 'ctrl-end') f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'End', ctrlKey: true }))
    else if (kind === 'key') f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }))

    assert.equal(f.controller.getPaused(), true, kind); f.flush(); assert.equal(f.moves.length, 0)
  }
  const f = fixture(t)
  f.update()
  const field = f.dom.window.document.createElement('input'); f.container.append(field)
  field.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  assert.equal(f.controller.getPaused(), false)
})

test('fullscreen/session loss, stop/disconnect/disable and speed scrolling cancel pending work; no competing scroll owner', t => {
  for (const change of [{ enabled: false }, { range: null }, { speedScrolling: true }, { session: {}, enabled: false }]) {
    const f = fixture(t); f.update(); f.update(change); f.flush()
    assert.equal(f.moves.length, 0)
  }
  const f = fixture(t); f.update({ speedScrolling: true }); f.controller.resume(); f.flush()
  assert.equal(f.moves.length, 0); assert.equal(f.controller.getPaused(), true)
  f.update({ speedScrolling: false }); f.flush(); assert.equal(f.moves.length, 0)
  f.controller.resume(); f.flush(); assert.equal(f.moves.length, 1)
  assert.equal(f.outgoing, 0)
})

test('Stage intercepts only owned scroll events before broadcasts, pauses on explicit section/speed intent, and gates Resume', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')
  const handler = source.slice(source.indexOf('const handleContainerScroll'), source.indexOf('// Touch-cancel guard'))
  assert.ok(handler.indexOf('setCanPrevSection') < handler.indexOf('if (isLiveLyricScroll) return'))
  assert.ok(handler.indexOf('if (isLiveLyricScroll) return') < handler.indexOf('stageCast.broadcastScroll'))
  assert.match(source, /handlePrevSection = useCallback\(\(\) => \{\s*liveScroll.controller.pause\(\)/)
  assert.match(source, /handleNextSection = useCallback\(\(\) => \{\s*liveScroll.controller.pause\(\)/)
  assert.match(source, /if \(nextVal\) liveScroll.controller.pause\(\)/)
  assert.match(source, /isFullscreen && liveLyrics.confirmed && liveScroll.paused/)
  assert.match(source, /disabled=\{isAutoScrolling \|\| !liveLyrics.scrollRange\}/)
})

function contrast(a, b) {
  const l = hex => { const rgb = hex.match(/../g).map(n => parseInt(n, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 }
  const x = l(a), y = l(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}
test('light/dark amber highlights have readable lyric/chord contrast and no vertical marker or layout/motion styling', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8')
  const block = css.match(/\[data-live-lyric="true"\] \{([^}]+)\}/)[1]
  assert.doesNotMatch(block, /border|shadow|animation|transition|padding|margin/)
  const pairs = [...block.matchAll(/light-dark\(#([0-9a-f]{6}), #([0-9a-f]{6})\)/g)]
  assert.equal(pairs.length, 3)
  for (const theme of [1, 2]) for (const foreground of pairs.slice(1)) assert.ok(contrast(pairs[0][theme], foreground[theme]) >= 4.5)
})


test('other programmatic Stage movement does not count as manual intent', t => {
  const f = fixture(t)
  f.update(); f.flush()
  f.container.scrollTop = 1100
  assert.equal(f.controller.handleScroll(), false, 'existing Stage movement retains its normal handler')
  assert.equal(f.controller.getPaused(), false)
  f.update(); f.flush()
  assert.equal(f.moves.length, 1, 'unchanged snapshot does not fight another programmatic scroll')
})


test('Auto Follow preserves manual scroll pause across a neutral song transition and new verification until explicit Resume', t => {
  const f = fixture(t, [[0, 1200, 40], [1, 2400, 40]])
  f.update({ range: [0], preservePause: true }); f.flush()
  f.container.dispatchEvent(new f.dom.window.Event('wheel'))
  assert.equal(f.controller.getPaused(), true)
  f.update({ enabled: false, session: {}, range: null }); f.flush()
  assert.equal(f.controller.getPaused(), true)
  f.update({ enabled: true, session: {}, slideKey: 'verified-new-song', range: [1] }); f.flush()
  assert.equal(f.moves.length, 1)
  assert.equal(f.controller.getPaused(), true)
  f.controller.resume(); f.flush()
  assert.equal(f.moves.length, 2)
  assert.equal(f.container.scrollTop, 2220)
  assert.equal(f.outgoing, 0)
})
