// Stage Tools split (#534, #535 shell): Metronome and Tuner are separate tools, each switched on
// or off in Advanced Tools. ON adds the tool's own button to the Stage toolbar; OFF removes it and
// stops the tool.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({ DEV: false })'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename)
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const src = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
const BUTTON = 'ui-button min-h-11 min-w-11'

/** Fake Web Audio: counts what is sounding and what was let go. */
function fakeAudio() {
  const audio = { contexts: [], oscillators: [] }
  audio.AudioContext = class {
    state = 'running'; currentTime = 0; destination = {}; closed = false
    constructor() { audio.contexts.push(this) }
    resume() { return Promise.resolve() }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve() }
    createOscillator() {
      const osc = { type: '', started: false, stopped: false, frequency: { value: 0, setValueAtTime(v) { this.value = v } },
        connect() {}, disconnect() {}, start() { this.started = true }, stop() { this.stopped = true } }
      audio.oscillators.push(osc); return osc
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, value: 0 }, connect() {}, disconnect() {} } }
  }
  audio.sounding = () => audio.oscillators.filter(osc => osc.started && !osc.stopped).length
  return audio
}

async function ui(run, { stored = {} } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test/', pretendToBeVisual: true })
  const keys = ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const audio = fakeAudio()
  dom.window.AudioContext = audio.AudioContext
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value)
  const { StageToolRows } = require('../src/components/StageToolRows.tsx')
  const { StageToolButtons } = require('../src/components/StageToolButtons.tsx')
  const { metronome } = require('../src/utils/metronome.ts')
  const { tunerTone } = require('../src/utils/tunerTone.ts')
  const root = createRoot(document.getElementById('root'))
  const render = (props = {}) => act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement('div', { id: 'toolbar' }, React.createElement(StageToolButtons, { buttonClass: BUTTON, ...props })),
    React.createElement('div', { id: 'advanced' }, React.createElement(StageToolRows, { rowClass: 'min-h-11 px-3 cursor-pointer mb-2' })))))
  await render()
  const q = selector => document.querySelector(selector)
  const helpers = {
    audio, metronome, tunerTone, render, q, dom,
    click: async node => { assert.ok(node, 'element to click exists'); await act(async () => node.click()) },
    key: async (node, name) => act(async () => { node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true })) }),
    toggle: id => q(`[data-testid="settings-stage-tool-${id}"]`),
    icon: id => q(`[data-testid="stage-tool-${id}"]`),
    panel: id => q(`[data-testid="stage-tool-panel-${id}"]`),
    button: text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text),
  }
  try { await run(helpers) }
  finally {
    metronome.stop(); tunerTone.release()
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
}

test('default: both switches are OFF, nothing is saved and the Stage toolbar has no tool button', async () => {
  await ui(async ({ toggle, icon, q }) => {
    for (const id of ['metronome', 'tuner']) {
      assert.equal(toggle(id).getAttribute('role'), 'switch')
      assert.equal(toggle(id).getAttribute('aria-checked'), 'false')
      assert.equal(icon(id), null)
      assert.equal(localStorage.getItem(`gtar_stage_tool_${id}_v1`), null)
    }
    assert.equal(q('#toolbar').children.length, 0)
    assert.deepEqual([...document.querySelectorAll('#advanced [data-testid^="stage-tool-row-"]')].map(row => row.textContent.trim()), ['Metronome', 'Tuner'])
    assert.equal(q('[role="dialog"]'), null)
  })
})

test('each switch is independent: ON shows only that tool button, OFF removes it', async () => {
  await ui(async ({ toggle, icon, click }) => {
    await click(toggle('tuner'))
    assert.equal(toggle('tuner').getAttribute('aria-checked'), 'true')
    assert.equal(toggle('metronome').getAttribute('aria-checked'), 'false')
    assert.ok(icon('tuner')); assert.equal(icon('metronome'), null)
    assert.equal(icon('tuner').getAttribute('aria-label'), 'Tuner')
    await click(toggle('metronome'))
    assert.deepEqual([...document.querySelectorAll('#toolbar button')].map(b => b.getAttribute('aria-label')), ['Metronome', 'Tuner'], 'registry order')
    await click(toggle('tuner'))
    assert.equal(icon('tuner'), null); assert.ok(icon('metronome'))
    await click(toggle('metronome'))
    assert.equal(icon('metronome'), null)
  })
})

test('persistence: the choice is saved on the device and restored on the next load', async () => {
  const settings = require('../src/stageTools/settings.ts')
  await ui(async ({ toggle, click }) => {
    await click(toggle('metronome'))
    assert.equal(localStorage.getItem(settings.stageToolKey('metronome')), '1')
    assert.equal(localStorage.getItem(settings.stageToolKey('tuner')), null)
    await click(toggle('metronome'))
    assert.equal(localStorage.getItem(settings.stageToolKey('metronome')), null, 'OFF is the default: nothing is kept')
  })
  await ui(async ({ toggle, icon }) => {
    assert.equal(toggle('tuner').getAttribute('aria-checked'), 'true')
    assert.ok(icon('tuner'))
    assert.equal(toggle('metronome').getAttribute('aria-checked'), 'false')
    assert.equal(icon('metronome'), null)
  }, { stored: { gtar_stage_tool_tuner_v1: '1', gtar_stage_tool_metronome_v1: 'yes' } })
  // Storage that throws: OFF, and switching does not crash.
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(settings.isStageToolEnabled('metronome', broken), false)
  let stopped = 0
  assert.doesNotThrow(() => settings.setStageToolEnabled({ id: 'x', stop() { stopped++ } }, true, broken))
  assert.equal(stopped, 0)
  assert.doesNotThrow(() => settings.setStageToolEnabled({ id: 'x', stop() { stopped++; throw new Error('stop failed') } }, false, broken))
  assert.equal(stopped, 1, 'OFF always stops the tool')
})

test('each button opens its own compact panel; one at a time; Escape and Close return focus', async () => {
  await ui(async ({ toggle, icon, panel, click, key, button, q, render }) => {
    await click(toggle('metronome')); await click(toggle('tuner'))
    assert.equal(icon('metronome').getAttribute('aria-expanded'), 'false')
    await click(icon('metronome'))
    const metronomePanel = panel('metronome')
    assert.ok(metronomePanel); assert.equal(panel('tuner'), null)
    assert.equal(metronomePanel.getAttribute('role'), 'dialog')
    assert.equal(metronomePanel.getAttribute('aria-label'), 'Metronome')
    assert.equal(metronomePanel.getAttribute('aria-modal'), null, 'not modal: the song stays usable')
    assert.equal(metronomePanel.parentElement, document.body)
    assert.match(metronomePanel.className, /max-h-\[90dvh\][\s\S]*sm:w-80/, 'centered modal on phones, small card on wider screens')
    assert.ok(document.activeElement === metronomePanel, 'focus moves into the panel')
    assert.equal(icon('metronome').getAttribute('aria-expanded'), 'true')
    assert.ok(button('Tap')); assert.ok(button('Start')); assert.equal(metronomePanel.textContent.includes('E2 (6th)'), false)

    await click(icon('tuner'))
    assert.equal(panel('metronome'), null)
    assert.ok(panel('tuner').textContent.includes('E2 (6th)')); assert.equal(button('Tap'), undefined)

    await key(panel('tuner'), 'Escape')
    assert.equal(panel('tuner'), null)
    assert.ok(document.activeElement === icon('tuner'), 'Escape returns focus to the button')

    await click(icon('metronome')); await click(q('[aria-label="Close Metronome"]'))
    assert.equal(panel('metronome'), null)
    assert.ok(document.activeElement === icon('metronome'))

    await click(icon('metronome')); await click(icon('metronome'))
    assert.equal(panel('metronome'), null, 'the button also closes its panel')

    await click(icon('tuner')); await render({ hidden: true })
    assert.equal(panel('tuner'), null, 'the panel hides with the toolbar')
  })
})

test('metronome: controls work as before; closing the panel keeps it running; switch OFF stops it', async () => {
  await ui(async ({ toggle, icon, panel, click, button, q, metronome, audio }) => {
    await click(toggle('metronome')); await click(icon('metronome'))
    metronome.setBpm(100)
    await act(async () => {})
    assert.equal(q('[data-testid="metronome-bpm"]').textContent, '100')
    await click(button('+5')); await click(q('[aria-label="Faster by 1"]'))
    assert.equal(metronome.getState().bpm, 106)
    await click(button('-5')); await click(q('[aria-label="Slower by 1"]'))
    assert.equal(metronome.getState().bpm, 100)
    await click(button('Start'))
    assert.equal(metronome.getState().isRunning, true); assert.ok(button('Stop'))
    await click(q('[aria-label="Close Metronome"]'))
    assert.equal(metronome.getState().isRunning, true, 'closing the panel does not stop the click')
    await click(toggle('metronome'))
    assert.equal(metronome.getState().isRunning, false, 'switch OFF stops the metronome')
    assert.equal(icon('metronome'), null); assert.equal(panel('metronome'), null)
    assert.equal(audio.sounding(), 0)
  })
})

test('tuner: one tone at a time; closing the panel stops it; switch OFF stops the tone and releases audio', async () => {
  await ui(async ({ toggle, icon, panel, click, button, q, tunerTone, audio }) => {
    await click(toggle('tuner')); await click(icon('tuner'))
    const string = name => [...panel('tuner').querySelectorAll('button')].find(b => b.textContent.includes(name))
    await click(string('E2 (6th)'))
    assert.equal(audio.sounding(), 1); assert.equal(tunerTone.getActive(), 'E2 (6th)')
    assert.equal(string('E2 (6th)').getAttribute('aria-pressed'), 'true')
    assert.ok(Math.abs(audio.oscillators.at(-1).frequency.value - 82.41) < 1e-9)
    assert.equal(q('[role="status"]').textContent, 'Playing E2 (6th)')
    await click(string('A2 (5th)'))
    assert.equal(audio.sounding(), 1, 'the previous tone stops'); assert.equal(tunerTone.getActive(), 'A2 (5th)')
    await click(string('A2 (5th)'))
    assert.equal(audio.sounding(), 0, 'tapping the sounding string stops it')

    await click(string('D3 (4th)')); await click(q('[aria-label="Close Tuner"]'))
    assert.equal(audio.sounding(), 0, 'closing the panel stops the tone'); assert.equal(tunerTone.getActive(), null)

    await click(icon('tuner')); await click(string('G3 (3rd)'))
    assert.equal(audio.sounding(), 1)
    await click(toggle('tuner'))
    assert.equal(audio.sounding(), 0, 'switch OFF stops the tone')
    assert.ok(audio.contexts.length > 0 && audio.contexts.every(ctx => ctx.closed), 'audio output is released')
    assert.equal(icon('tuner'), null); assert.equal(panel('tuner'), null)
    assert.equal(button('Tap'), undefined)
  })
})

test('a tool switched OFF from another tab is stopped here too', async () => {
  await ui(async ({ toggle, icon, click, metronome, dom }) => {
    await click(toggle('metronome'))
    metronome.start()
    assert.equal(metronome.getState().isRunning, true)
    localStorage.removeItem('gtar_stage_tool_metronome_v1')
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('storage')) })
    assert.equal(icon('metronome'), null)
    assert.equal(metronome.getState().isRunning, false)
  })
})

test('registry: one entry per tool, each in its own files; a new tool is one more entry', () => {
  const { STAGE_TOOLS } = require('../src/stageTools/registry.ts')
  assert.deepEqual(STAGE_TOOLS.map(tool => [tool.id, tool.name]), [['metronome', 'Metronome'], ['tuner', 'Tuner']])
  for (const tool of STAGE_TOOLS) for (const field of ['Icon', 'Panel', 'stop']) assert.ok(tool[field], `${tool.id} has ${field}`)
  assert.doesNotMatch(src('components/MetronomePanel.tsx'), /tuner/i)
  assert.doesNotMatch(src('components/TunerPanel.tsx'), /metronome/i)
  assert.doesNotMatch(src('stageTools/metronomeTool.ts'), /tuner/i)
  assert.doesNotMatch(src('stageTools/tunerTool.ts'), /metronome/i)
  // The shell knows no tool by name.
  for (const file of ['components/StageToolButtons.tsx', 'components/StageToolRows.tsx', 'stageTools/settings.ts']) {
    assert.doesNotMatch(src(file), /metronome|tuner|midi/i, file)
  }
})

test('Stage Tools modal, its toolbar button and the onOpenBandSync wiring are gone; song BPM sync stays', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../src/components/StageToolsModal.tsx')), false)
  const app = src('App.tsx'), stage = src('components/StageView.tsx'), header = src('components/Header.tsx')
  for (const [name, source] of [['App', app], ['StageView', stage], ['Header', header], ['StageSettingsModal', src('components/StageSettingsModal.tsx')]]) {
    assert.doesNotMatch(source, /StageToolsModal|onOpenBandSync|onOpenStageTools|Stage Tools/, name)
  }
  assert.match(stage, /aria-label="Editor"[\s\S]*?<StageToolButtons hidden=\{inPerformanceMode\}[\s\S]*?<StagePreviewHelp \/>/, 'tool buttons sit in the Editor / Key group')
  assert.match(stage, /metronome\.setBpm\(songBpmNum\)/, 'song BPM still sets the metronome tempo')
  assert.match(header, /<OnlineSourcesRow [^\n]*\/>[\s\S]*?<StageToolRows rowClass=\{popoverItem\} \/>[\s\S]*?<ExtensionRows /, 'rows live in Advanced Tools')
})

test('touch targets and reduced motion: 44px controls, no animation on the panel', async () => {
  await ui(async ({ toggle, icon, panel, click }) => {
    for (const id of ['metronome', 'tuner']) {
      assert.match(toggle(id).className, /min-w-\[44px\] min-h-\[44px\]/)
      await click(toggle(id)); await click(icon(id))
      assert.match(icon(id).className, /min-h-11 min-w-11/)
      for (const control of panel(id).querySelectorAll('button, input')) {
        // The shared "?" button is 32px with a -inset-1.5 hit area, which reaches 44px.
        const pattern = control.getAttribute('data-testid') === `${id}-help-button` ? /before:-inset-1\.5/ : /min-h-11/
        assert.match(control.className, pattern, `${id}: ${control.getAttribute('aria-label') ?? control.textContent}`)
      }
      assert.doesNotMatch(panel(id).innerHTML, /animate-/, 'nothing to animate under reduced motion')
    }
  })
})

test('help: each tool panel has its own "?" next to Close; it opens a help dialog and Escape closes only the help', async () => {
  await ui(async ({ toggle, icon, panel, click, key, q }) => {
    await click(toggle('metronome')); await click(toggle('tuner'))
    for (const [id, title] of [['metronome', 'Metronome'], ['tuner', 'Tuner']]) {
      await click(icon(id))
      const help = q(`[data-testid="${id}-help-button"]`)
      assert.ok(help, `${id} panel has a help button`)
      assert.ok(panel(id).contains(help), 'the "?" sits inside the panel header')
      assert.equal(q(`[data-testid="${id === 'tuner' ? 'metronome' : 'tuner'}-help-button"]`), null, 'only its own help')
      await click(help)
      const popup = q(`[data-testid="${id}-help"]`)
      assert.ok(popup, `${id} help opens`)
      assert.match(popup.textContent, new RegExp(title))
      await key(document.body, 'Escape')
      assert.equal(q(`[data-testid="${id}-help"]`), null, 'Escape closes the help')
      assert.ok(panel(id), 'the panel stays open after closing the help')
      await click(q(`[aria-label="Close ${title}"]`))
    }
  })
})
