// #536 Slice 2: the Stage command seam. The keyboard listener, the on-screen buttons and the
// stageCommands registry all end in the same StageView handlers, behind the same guards.
// No MIDI here: this slice only names the paths a later caller will use.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
// React reads DOM support at import time; boot with a window so its event system attaches.
const boot = new JSDOM('<html><body></body></html>')
global.window = boot.window
global.document = boot.window.document
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
boot.window.close()

const { stageCommands, STAGE_COMMANDS, isStageCommand, registerStageCommandRunner } = require('../src/utils/stageCommands.ts')
const { transposeContext } = require('../src/utils/songKeySemantics.ts')
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n')

const NINE = ['nextSong', 'prevSong', 'nextSection', 'prevSection', 'toggleAutoScroll', 'scrollUp', 'scrollDown', 'transposeUp', 'transposeDown']
const noop = () => {}
const song = (title, id, extra = {}) => ({ id, title, artist: 'Artist', key: 'G', transposeOffset: 0,
  rawContent: `{title: ${title}}\n{key: G}\n[Verse 1]\n[G]${title} one\n[Chorus]\n[C]${title} two\n[Bridge]\n[D]${title} three`, ...extra })
const wait = ms => act(async () => new Promise(resolve => setTimeout(resolve, ms)))
// A song change slides out (200 ms) before it lands; the repeat guard is 250 ms.
const SLIDE_MS = 700

async function stage(run, props = {}) {
  const dom = new JSDOM('<!doctype html><html><body><input id="outside-field" /><div id="root"></div></body></html>',
    { url: 'https://gtar.test/', pretendToBeVisual: true })
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'Node', 'Event', 'KeyboardEvent', 'CustomEvent', 'IS_REACT_ACT_ENVIRONMENT',
    'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  const previousNavigator = Object.getOwnPropertyDescriptor(global, 'navigator')
  Object.assign(global, { window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Node: dom.window.Node, Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent, CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.innerWidth = 1280
  dom.window.innerHeight = 800
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  const scrolls = []
  dom.window.HTMLElement.prototype.scrollBy = function (options) { scrolls.push({ by: options }) }
  dom.window.HTMLElement.prototype.scrollTo = function (options) { scrolls.push({ to: options }) }
  // jsdom has no layout: give the scroll container a height and each section heading a position.
  const layout = { scrollTop: 0 }
  const proto = dom.window.HTMLElement.prototype
  Object.defineProperty(proto, 'scrollTop', { configurable: true, get() { return layout.scrollTop }, set() {} })
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return 5000 } })
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 800 } })
  proto.getBoundingClientRect = function () {
    const sections = [...dom.window.document.querySelectorAll('[data-stage-section="true"]')]
    const top = sections.includes(this) ? 400 * (sections.indexOf(this) + 1) - layout.scrollTop : 0
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top }
  }
  global.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  global.requestAnimationFrame = dom.window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16)
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame = id => clearTimeout(id)
  await wait(25)

  const resolved = require.resolve('../src/components/StageView.tsx')
  delete require.cache[resolved]
  const { StageView } = require('../src/components/StageView.tsx')
  const songs = props.songs ?? [song('Alpha', 'one'), song('Beta', 'two'), song('Gamma', 'three')]
  const selected = []
  const transposed = []
  const base = { song: songs[props.activeSongIndex ?? 0], songs, activeSongIndex: 0,
    onSelectSongIndex: index => selected.push(index), transposeOffset: 0,
    onTransposeChange: offset => transposed.push(offset), ...props }
  const root = createRoot(dom.window.document.getElementById('root'))
  const render = async (next = {}) => act(async () => root.render(React.createElement(StageView, { ...base, ...next })))
  await render()
  const press = async (key, options = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, code: options.code ?? key, bubbles: true, cancelable: true, ...options })
    await act(async () => { (options.on ?? dom.window).dispatchEvent(event) })
    return event
  }
  const command = async name => { let result; await act(async () => { result = stageCommands.run(name) }); return result }
  const click = async node => { assert.ok(node, 'control exists'); await act(async () => node.click()) }
  const autoscrolling = () => Boolean(dom.window.document.querySelector('[aria-label="Pause autoscroll"]'))
  let unmounted = false
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()) } }
  try { await run({ dom, render, press, command, click, autoscrolling, selected, transposed, scrolls, layout, unmount }) }
  finally {
    await unmount()
    dom.window.close()
    Object.assign(global, previous)
    if (previousNavigator) Object.defineProperty(global, 'navigator', previousNavigator)
  }
}

test('registry: exactly the nine command names, in the order the design lists them', () => {
  assert.deepEqual([...STAGE_COMMANDS], NINE)
  for (const name of NINE) assert.equal(isStageCommand(name), true, name)
  for (const bad of ['', 'NextSong', 'nextsong', 'next song', 'delete', 'reset', 'fullscreen', 'exit', 'toString', 'constructor', '__proto__',
    0, 1, null, undefined, true, {}, [], ['nextSong'], { toString: () => 'nextSong' }]) {
    assert.equal(isStageCommand(bad), false, String(bad))
  }
})

test('registry: run() is false with no Stage, forwards only valid names, and a stale cleanup removes nothing', () => {
  for (const name of NINE) assert.equal(stageCommands.run(name), false, `${name} with no Stage`)
  const calls = []
  const remove = registerStageCommandRunner(name => { calls.push(name); return true })
  try {
    for (const bad of ['delete', 'NEXTSONG', '', null, undefined, 3, {}, ['scrollUp'], { toString: () => 'scrollUp' }]) {
      assert.equal(stageCommands.run(bad), false)
    }
    assert.deepEqual(calls, [], 'an unknown name never reaches the Stage runner')
    for (const name of NINE) assert.equal(stageCommands.run(name), true, name)
    assert.deepEqual(calls, NINE)

    // The runner's own answer comes back: a guard inside Stage reads as false.
    const second = registerStageCommandRunner(() => false)
    assert.equal(stageCommands.run('nextSong'), false)
    remove() // stale: the first runner was already replaced
    assert.equal(stageCommands.run('nextSong'), false)
    registerStageCommandRunner(() => true)
    second() // stale again
    assert.equal(stageCommands.run('nextSong'), true, 'a stale cleanup must not remove the current runner')
  } finally {
    registerStageCommandRunner(noop)()
  }
  assert.equal(stageCommands.run('nextSong'), false, 'removed runner means no Stage')
})

test('StageView registers on mount and removes itself on unmount', async () => {
  assert.equal(stageCommands.run('toggleAutoScroll'), false, 'nothing registered before Stage mounts')
  await stage(async ({ command, autoscrolling, unmount }) => {
    assert.equal(autoscrolling(), false)
    assert.equal(await command('toggleAutoScroll'), true)
    assert.equal(autoscrolling(), true, 'the command reached the Stage toggle')
    assert.equal(await command('not-a-command'), false)
    assert.equal(autoscrolling(), true)
    await unmount()
    assert.equal(stageCommands.run('toggleAutoScroll'), false, 'unmounted Stage answers false')
  })
})

test('keyboard keys behave as before through runStageCommand', async () => {
  await stage(async ({ press, autoscrolling, selected, scrolls, transposed }) => {
    // Space toggles autoscroll, both ways.
    const space = await press(' ', { code: 'Space' })
    assert.equal(space.defaultPrevented, true)
    assert.equal(autoscrolling(), true)
    await press(' ', { code: 'Space' })
    assert.equal(autoscrolling(), false)

    // Arrow keys nudge 80 px; Shift+Arrow changes speed and does not scroll.
    scrolls.length = 0
    assert.equal((await press('ArrowDown')).defaultPrevented, true)
    assert.equal((await press('ArrowUp')).defaultPrevented, true)
    assert.deepEqual(scrolls, [{ by: { top: 80, behavior: 'smooth' } }, { by: { top: -80, behavior: 'smooth' } }])
    scrolls.length = 0
    await press('ArrowDown', { shiftKey: true })
    await press('ArrowUp', { shiftKey: true })
    assert.deepEqual(scrolls, [], 'Shift+Arrow is speed, not scroll')

    // Song keys: a held key never advances, one press advances once.
    const held = await press('ArrowRight', { repeat: true })
    assert.equal(held.defaultPrevented, true)
    await wait(SLIDE_MS)
    assert.deepEqual(selected, [], 'held ArrowRight is ignored')
    await press('ArrowRight')
    await press('n') // inside the animation lock and the 250 ms guard
    await press('N')
    await wait(SLIDE_MS)
    assert.deepEqual(selected, [1], 'rapid presses advance exactly one song')

    assert.deepEqual(transposed, [], 'no key transposes: the keyboard has no transpose shortcut')
  })
})

test('section moves stop autoscroll and land on the same target by key and by command', async () => {
  await stage(async ({ dom, press, command, autoscrolling, scrolls, layout }) => {
    assert.equal(dom.window.document.querySelectorAll('[data-stage-section="true"]').length, 3, 'fixture has three sections')
    const move = async (from, act) => {
      layout.scrollTop = from
      await press(' ', { code: 'Space' })
      assert.equal(autoscrolling(), true)
      scrolls.length = 0
      await act()
      assert.equal(autoscrolling(), false, 'a section move stops autoscroll')
      const moves = scrolls.filter(entry => entry.to)
      assert.equal(moves.length, 1)
      assert.equal(moves[0].to.behavior, 'smooth')
      return moves[0].to.top
    }
    const nextByKey = await move(0, async () => assert.equal((await press('PageDown')).defaultPrevented, true))
    const nextByCommand = await move(0, async () => assert.equal(await command('nextSection'), true))
    const prevByKey = await move(1000, async () => assert.equal((await press('PageUp')).defaultPrevented, true))
    const prevByCommand = await move(1000, async () => assert.equal(await command('prevSection'), true))
    assert.ok(nextByKey > 0 && nextByKey < prevByKey, 'next goes to the first section below, previous to the nearest above')
    assert.equal(nextByCommand, nextByKey)
    assert.equal(prevByCommand, prevByKey)

    // Held section keys never move.
    layout.scrollTop = 0
    scrolls.length = 0
    for (const key of ['PageDown', 'PageUp']) assert.equal((await press(key, { repeat: true })).defaultPrevented, true)
    assert.deepEqual(scrolls.filter(entry => entry.to), [])
  })
})

test('previous-song keys respect the start of the list and the song-slide lock', async () => {
  await stage(async ({ press, selected }) => {
    await press('ArrowLeft')
    await press('p')
    await wait(SLIDE_MS)
    assert.deepEqual(selected, [], 'nothing before the first song')
  })
  await stage(async ({ press, selected }) => {
    await press('ArrowLeft')
    await press('P')
    await wait(SLIDE_MS)
    assert.deepEqual(selected, [1], 'one step back from the last song')
  }, { activeSongIndex: 2 })
})

test('commands reach the same paths as the keys and the on-screen buttons', async () => {
  await stage(async ({ command, click, autoscrolling, selected, scrolls, transposed, dom }) => {
    const $ = selector => dom.window.document.querySelector(selector)
    scrolls.length = 0
    assert.equal(await command('scrollDown'), true)
    assert.equal(await command('scrollUp'), true)
    assert.deepEqual(scrolls, [{ by: { top: 80, behavior: 'smooth' } }, { by: { top: -80, behavior: 'smooth' } }], 'same 80 px nudge as the arrow keys')

    assert.equal(await command('toggleAutoScroll'), true)
    assert.equal(autoscrolling(), true)
    assert.equal(await command('toggleAutoScroll'), true)
    assert.equal(autoscrolling(), false)

    // Transpose: command, toolbar stepper and fullscreen bottom-bar button all send the same stored offset.
    assert.equal(await command('transposeUp'), true)
    await click($('[aria-label="Step Key Up (+1 semitone)"]'))
    assert.equal(await command('transposeDown'), true)
    await click($('[aria-label="Step Key Down (-1 semitone)"]'))
    await click($('[aria-label="Enter fullscreen"]')) // no Fullscreen API in jsdom: Stage falls back to focus mode
    await click($('[data-testid="stage-bottom-transpose-up-btn"]'))
    await click($('[data-testid="stage-bottom-transpose-down-btn"]'))
    assert.deepEqual(transposed, [1, 1, -1, -1, 1, -1])
    assert.equal(await command('transposeUp'), true, 'commands still work in performance mode')
    assert.deepEqual(transposed.slice(-1), [1])

    // Song commands share the slide lock and the 250 ms guard with the keys.
    assert.equal(await command('nextSong'), true)
    assert.equal(await command('nextSong'), true, 'accepted by the seam; the slide lock drops it')
    await wait(SLIDE_MS)
    assert.deepEqual(selected, [1], 'two rapid commands advance exactly one song')
    assert.equal(await command('prevSong'), true)
    await wait(SLIDE_MS)
    assert.deepEqual(selected, [1], 'nothing before the first song')

    assert.equal(await command('nextSection'), true)
    assert.equal(await command('prevSection'), true)
  })
})

test('transpose step keeps the ORIGINAL_KEY-relative offset mapping of the buttons', async () => {
  // CHART_KEY G, ORIGINAL_KEY E: the displayed offset is ORIGINAL_KEY-relative and wraps, so a
  // stored offset of 5 steps up to -6, not 6. A naive "stored + 1" would be caught here.
  const fixture = song('Fixture', '109', { originalKey: 'E',
    rawContent: '{title: Fixture}\n{key: G}\n{original_key: E}\n[G]My [D/F#]song', transposeOffset: 5 })
  const context = transposeContext(fixture, 5)
  assert.equal(context.originalRelative, true)
  const up = context.toStoredOffset(context.displayOffset + 1)
  const down = context.toStoredOffset(context.displayOffset - 1)
  assert.deepEqual([up, down], [-6, 4])
  await stage(async ({ command, click, transposed, dom }) => {
    const $ = selector => dom.window.document.querySelector(selector)
    await command('transposeUp')
    await click($('[aria-label="Step Key Up (+1 semitone)"]'))
    await command('transposeDown')
    await click($('[aria-label="Step Key Down (-1 semitone)"]'))
    assert.deepEqual(transposed, [up, up, down, down])
  }, { songs: [fixture], transposeOffset: 5 })
})

test('overlay guard blocks keys and commands alike', async () => {
  await stage(async ({ press, command, autoscrolling, selected, scrolls, transposed }) => {
    scrolls.length = 0
    for (const [key, options] of [[' ', { code: 'Space' }], ['ArrowRight'], ['n'], ['ArrowLeft'], ['PageDown'], ['PageUp'], ['ArrowUp'], ['ArrowDown']]) {
      assert.equal((await press(key, options)).defaultPrevented, false, `${key} is left alone while an overlay is open`)
    }
    for (const name of NINE) assert.equal(await command(name), false, `${name} blocked by the overlay`)
    await wait(SLIDE_MS)
    assert.equal(autoscrolling(), false)
    assert.deepEqual([selected, scrolls, transposed], [[], [], []])
  }, { isAnyModalOpen: true })

  // The guard follows the prop: closing the overlay lets the same Stage answer again.
  await stage(async ({ render, command, scrolls }) => {
    scrolls.length = 0
    assert.equal(await command('scrollDown'), true)
    await render({ isSetlistDrawerOpen: true })
    assert.equal(await command('scrollDown'), false)
    await render({ isSetlistDrawerOpen: false, isStageSettingsModalOpen: true })
    assert.equal(await command('scrollDown'), false)
    await render({ isStageSettingsModalOpen: false })
    assert.equal(await command('scrollDown'), true)
    assert.equal(scrolls.length, 2)
  })
})

test('typing guard blocks keys and commands while a field has focus', async () => {
  await stage(async ({ dom, press, command, autoscrolling, selected, scrolls }) => {
    const field = dom.window.document.getElementById('outside-field')
    await act(async () => field.focus())
    scrolls.length = 0
    for (const [key, options] of [[' ', { code: 'Space' }], ['n'], ['p'], ['ArrowDown'], ['PageDown']]) {
      assert.equal((await press(key, { ...options, on: field })).defaultPrevented, false, `${key} typed into a field`)
    }
    for (const name of NINE) assert.equal(await command(name), false, `${name} while typing`)
    await wait(SLIDE_MS)
    assert.equal(autoscrolling(), false)
    assert.deepEqual([selected, scrolls], [[], []])
    await act(async () => field.blur())
    assert.equal(await command('scrollDown'), true, 'commands work again once the field loses focus')
  })
})

test('source contracts: one named path per command, no inline copies, no MIDI', () => {
  const stageView = source('src/components/StageView.tsx')
  assert.equal(stageView.match(/\.scrollBy\(/g)?.length, 1, 'the only scrollBy is inside handleNudgeScroll')
  assert.match(stageView, /const handleNudgeScroll = useCallback\(\(direction: 'up' \| 'down'\) => \{\n\s+scrollContainerRef\.current\?\.scrollBy\(\{ top: direction === 'up' \? -80 : 80, behavior: 'smooth' \}\)/)
  assert.equal(stageView.match(/toStoredOffset\(/g)?.length, 1, 'the only transpose step is inside handleTransposeStep')
  assert.equal(stageView.match(/onClick=\{\(\) => handleTransposeStep\(1\)\}/g)?.length, 2, 'both + buttons')
  assert.equal(stageView.match(/onClick=\{\(\) => handleTransposeStep\(-1\)\}/g)?.length, 2, 'both - buttons')

  const runner = stageView.match(/const runStageCommand = useCallback\([\s\S]*?\n {2}\}, \[/)?.[0] ?? ''
  assert.match(runner, /if \(isTypingTarget\(target\) \|\| isAnyOverlayActive\) return false/)
  for (const [name, call] of [['nextSong', 'handleNextSong()'], ['prevSong', 'handlePrevSong()'], ['nextSection', 'handleNextSection()'],
    ['prevSection', 'handlePrevSection()'], ['toggleAutoScroll', 'handleToggleAutoScroll()'], ['scrollUp', "handleNudgeScroll('up')"],
    ['scrollDown', "handleNudgeScroll('down')"], ['transposeUp', 'handleTransposeStep(1)'], ['transposeDown', 'handleTransposeStep(-1)']]) {
    assert.ok(runner.includes(`case '${name}': ${call}; return true`), `${name} calls ${call}`)
  }
  assert.equal(runner.match(/case '/g)?.length, 9, 'nine commands, nothing else')

  // The keyboard listener keeps its own guards and held-key filter, then routes through the seam.
  const listener = stageView.match(/const handleKeyDown = \(e: KeyboardEvent\) => \{[\s\S]*?\n {4}window\.addEventListener\('keydown', handleKeyDown\)/)?.[0] ?? ''
  assert.ok(listener.indexOf('e.target instanceof HTMLInputElement') < listener.indexOf('if (isAnyOverlayActive) {'))
  assert.ok(listener.indexOf('if (isAnyOverlayActive) {') < listener.indexOf('e.repeat &&'))
  assert.ok(listener.indexOf('e.repeat &&') < listener.indexOf('runStageCommand('))
  assert.deepEqual([...listener.matchAll(/runStageCommand\('(\w+)', e\.target\)/g)].map(match => match[1]),
    ['toggleAutoScroll', 'nextSong', 'prevSong', 'nextSection', 'prevSection', 'scrollUp', 'scrollDown'])
  assert.doesNotMatch(listener, /handle(Next|Prev)(Song|Section)\(\)|handleToggleAutoScroll\(\)|scrollBy|handleTransposeStep/)

  assert.match(stageView, /useEffect\(\(\) => registerStageCommandRunner\(runStageCommand\), \[runStageCommand\]\)/)
  const registry = source('src/utils/stageCommands.ts')
  assert.doesNotMatch(registry, /^\s*import\s/m, 'the registry is self-contained')
  for (const file of ['src/components/StageView.tsx', 'src/utils/stageCommands.ts']) {
    assert.doesNotMatch(source(file), /from\s+['"][^'"]*\/midi(\/|['"])/, `${file} imports nothing from web/src/midi`)
    assert.doesNotMatch(source(file), /requestMIDIAccess|onmidimessage/, `${file} has no MIDI code`)
  }
})

test('App keeps the transpose range and Band Sync follower rules the step relies on', () => {
  const app = source('src/App.tsx')
  const handler = app.match(/const handleTransposeChange = useCallback\(\(newOffset: number\) => \{[\s\S]*?\n {2}\}, \[/)?.[0] ?? ''
  assert.match(handler, /if \(bandRemote\) return\n\s+if \(!Number\.isSafeInteger\(newOffset\) \|\| newOffset < -11 \|\| newOffset > 11\) return/)
  assert.match(app, /onTransposeChange=\{handleTransposeChange\}/)
})
