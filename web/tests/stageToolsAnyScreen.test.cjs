// Stage Tools from any screen (#616): Metronome and Tuner panels open from Advanced Tools
// with no song open. Desktop: floating panel at the right. Phone: bottom sheet max 50dvh.
// Metronome running state indicator on Advanced Tools row and Stage toolbar button.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { JSDOM } = require('jsdom')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({ DEV: false })'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    filename,
  )
}

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const BUTTON = 'ui-button min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 px-2.5 rounded-lg'

/** Fake Web Audio: counts oscillators and handles AudioContext. */
function fakeAudio() {
  const audio = { contexts: [], oscillators: [] }
  audio.AudioContext = class {
    state = 'running'
    currentTime = 0
    destination = {}
    closed = false
    constructor() { audio.contexts.push(this) }
    resume() { return Promise.resolve() }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve() }
    createOscillator() {
      const osc = {
        type: '', started: false, stopped: false, frequency: { value: 0, setValueAtTime(v) { this.value = v } },
        connect() {}, disconnect() {}, start() { this.started = true }, stop() { this.stopped = true },
      }
      audio.oscillators.push(osc)
      return osc
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, value: 0 },
        connect() {}, disconnect() {},
      }
    }
  }
  audio.sounding = () => audio.oscillators.filter(osc => osc.started && !osc.stopped).length
  return audio
}

async function setupTestDom({ stored = {}, view = 'songbook' } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test/', pretendToBeVisual: true })
  const keys = ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const audio = fakeAudio()
  dom.window.AudioContext = audio.AudioContext

  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }

  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value)

  const { StageToolRows } = require('../src/components/StageToolRows.tsx')
  const { StageToolButtons } = require('../src/components/StageToolButtons.tsx')
  const { StageToolHost } = require('../src/components/StageToolHost.tsx')
  const { metronome } = require('../src/utils/metronome.ts')
  const { tunerTone } = require('../src/utils/tunerTone.ts')
  const settings = require('../src/stageTools/settings.ts')

  // Clean slate
  settings.closeStageTool(false)

  const root = createRoot(document.getElementById('root'))

  // Host renders app-level tool panel across any view
  const render = (opts = {}) => act(async () => {
    const currentView = opts.view || view
    root.render(React.createElement(React.Fragment, null,
      currentView === 'stage'
        ? React.createElement('div', { id: 'toolbar' }, React.createElement(StageToolButtons, { buttonClass: BUTTON, hidden: opts.hidden }))
        : null,
      React.createElement('div', { id: 'advanced' }, React.createElement(StageToolRows, { rowClass: 'min-h-11 px-3 cursor-pointer mb-2' })),
      React.createElement(StageToolHost, null),
    ))
  })

  await render()

  const q = selector => document.querySelector(selector)
  const helpers = {
    audio, metronome, tunerTone, settings, render, q, dom,
    click: async node => {
      assert.ok(node, 'element to click exists')
      await act(async () => {
        node.click()
        await new Promise(r => setTimeout(r, 0))
      })
    },
    key: async (node, name) => act(async () => {
      node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true }))
      await new Promise(r => setTimeout(r, 0))
    }),
    toggle: id => q(`[data-testid="settings-stage-tool-${id}"]`),
    rowOpen: id => q(`[data-testid="stage-tool-open-${id}"]`),
    rowRunning: id => q(`[data-testid="stage-tool-row-running-${id}"]`),
    toolbarButton: id => q(`[data-testid="stage-tool-${id}"]`),
    toolbarRunning: id => q(`[data-testid="stage-tool-running-${id}"]`),
    panel: id => q(`[data-testid="stage-tool-panel-${id}"]`),
    button: text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text),
  }

  const cleanup = async () => {
    metronome.stop()
    tunerTone.release()
    settings.closeStageTool(false)
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }

  return { helpers, cleanup }
}

test('Songbook home (no song open): selecting Metronome opens panel, enables tool, runs in background on close', async () => {
  const { helpers, cleanup } = await setupTestDom({ view: 'songbook' })
  try {
    const { toggle, rowOpen, panel, click, button, metronome, q, rowRunning, settings } = helpers

    // Initially off
    assert.equal(toggle('metronome').getAttribute('aria-checked'), 'false')
    assert.equal(panel('metronome'), null)
    assert.equal(rowRunning('metronome'), null)

    // Selecting Metronome row opens the panel and enables the tool
    await click(rowOpen('metronome'))
    assert.equal(toggle('metronome').getAttribute('aria-checked'), 'true')
    const mPanel = panel('metronome')
    assert.ok(mPanel, 'Metronome panel opens from Songbook home')
    assert.equal(mPanel.getAttribute('role'), 'dialog')
    assert.equal(mPanel.getAttribute('aria-label'), 'Metronome')

    // Start metronome
    await click(button('Start'))
    assert.equal(metronome.getState().isRunning, true)
    assert.ok(button('Stop'))

    // Close panel with X
    await click(q('[aria-label="Close Metronome"]'))
    assert.equal(panel('metronome'), null, 'panel closes')

    // Metronome keeps running in background!
    assert.equal(metronome.getState().isRunning, true, 'metronome keeps ticking while hidden')

    // Advanced Tools row shows clear running state
    assert.ok(rowRunning('metronome'), 'running indicator shown on row')
    assert.match(rowRunning('metronome').textContent, /Running/)

    // Switching tool OFF stops metronome and removes running indicator
    await click(toggle('metronome'))
    assert.equal(metronome.getState().isRunning, false, 'toggle off stops metronome')
    assert.equal(rowRunning('metronome'), null, 'running indicator removed')
    assert.equal(toggle('metronome').getAttribute('aria-checked'), 'false')
  } finally {
    await cleanup()
  }
})

test('Songbook home: selecting Tuner opens panel, tone stops on close, toggle off stops and closes', async () => {
  const { helpers, cleanup } = await setupTestDom({ view: 'songbook' })
  try {
    const { toggle, rowOpen, panel, click, audio, tunerTone, q } = helpers

    // Selecting Tuner opens panel and enables switch
    await click(rowOpen('tuner'))
    assert.equal(toggle('tuner').getAttribute('aria-checked'), 'true')
    assert.ok(panel('tuner'), 'Tuner panel opens')

    // Play a tone
    const stringBtn = [...panel('tuner').querySelectorAll('button')].find(b => b.textContent.includes('E2 (6th)'))
    await click(stringBtn)
    assert.equal(audio.sounding(), 1)
    assert.equal(tunerTone.getActive(), 'E2 (6th)')

    // Close with X stops the tone
    await click(q('[aria-label="Close Tuner"]'))
    assert.equal(panel('tuner'), null)
    assert.equal(audio.sounding(), 0, 'closing Tuner panel stops tone')
    assert.equal(tunerTone.getActive(), null)

    // Reopen Tuner from row
    await click(rowOpen('tuner'))
    assert.ok(panel('tuner'))
    const a2Btn = [...panel('tuner').querySelectorAll('button')].find(b => b.textContent.includes('A2 (5th)'))
    await click(a2Btn)
    assert.equal(audio.sounding(), 1)

    // Toggle switch OFF closes panel and releases tone
    await click(toggle('tuner'))
    assert.equal(panel('tuner'), null, 'toggle OFF closes open panel')
    assert.equal(audio.sounding(), 0, 'toggle OFF stops sound')
  } finally {
    await cleanup()
  }
})

test('only one panel visible at a time: switching between Metronome and Tuner', async () => {
  const { helpers, cleanup } = await setupTestDom({ view: 'songbook' })
  try {
    const { rowOpen, panel, click, button, metronome, audio, q } = helpers

    // Open Metronome and start it
    await click(rowOpen('metronome'))
    assert.ok(panel('metronome'))
    await click(button('Start'))
    assert.equal(metronome.getState().isRunning, true)

    // Switch directly to Tuner by clicking Tuner row
    await click(rowOpen('tuner'))
    assert.equal(panel('metronome'), null, 'Metronome panel closed')
    assert.ok(panel('tuner'), 'Tuner panel open')
    assert.equal(metronome.getState().isRunning, true, 'Metronome continues running in background')

    // Play a tone in Tuner
    const stringBtn = [...panel('tuner').querySelectorAll('button')].find(b => b.textContent.includes('D3 (4th)'))
    await click(stringBtn)
    assert.equal(audio.sounding(), 1)

    // Switch back to Metronome
    await click(rowOpen('metronome'))
    assert.ok(panel('metronome'), 'Metronome panel reopened')
    assert.equal(panel('tuner'), null, 'Tuner panel unmounted')
    assert.equal(audio.sounding(), 0, 'Tuner unmounting stops tone')
  } finally {
    await cleanup()
  }
})

test('Stage view: running state indicator on Stage toolbar button when Metronome runs in background', async () => {
  const { helpers, cleanup } = await setupTestDom({ stored: { gtar_stage_tool_metronome_v1: '1' }, view: 'stage' })
  try {
    const { toolbarButton, toolbarRunning, panel, click, button, metronome, q } = helpers

    assert.ok(toolbarButton('metronome'))
    assert.equal(toolbarRunning('metronome'), null, 'initially not running')

    // Open panel from toolbar button and start metronome
    await click(toolbarButton('metronome'))
    assert.ok(panel('metronome'))
    await click(button('Start'))
    assert.equal(metronome.getState().isRunning, true)

    // Running indicator visible on toolbar button
    assert.ok(toolbarRunning('metronome'), 'running indicator visible while open')

    // Close panel
    await click(q('[aria-label="Close Metronome"]'))
    assert.equal(panel('metronome'), null)

    // Running indicator remains on Stage toolbar button while running in background
    assert.ok(toolbarRunning('metronome'), 'running indicator remains while closed in background')

    // Stop metronome via engine
    await act(async () => { metronome.stop() })
    assert.equal(toolbarRunning('metronome'), null, 'running indicator removed when stopped')
  } finally {
    await cleanup()
  }
})

test('mobile 360px sheet constraints: max-h-[50dvh] leaves >= 50% viewport for background', async () => {
  const { helpers, cleanup } = await setupTestDom({ view: 'songbook' })
  try {
    const { rowOpen, panel, click } = helpers

    await click(rowOpen('metronome'))
    const mPanel = panel('metronome')
    assert.ok(mPanel)

    // Verify className contains max-h-[50dvh] and overflow-y-auto
    assert.match(mPanel.className, /max-h-\[50dvh\]/, 'mobile panel has max-h-[50dvh]')
    assert.match(mPanel.className, /\boverflow-y-auto\b/, 'scrolls inside when content is taller')
    assert.match(mPanel.className, /\bbottom-0\b/, 'anchored as bottom sheet on phone')
    assert.match(mPanel.className, /\bsm:w-80\b/, 'desktop width 320px (w-80)')
    assert.match(mPanel.className, /\bsm:right-4\b/, 'desktop right margin')
    assert.match(mPanel.className, /\bz-40\b/, 'z-40 stays below z-50 modals')

    // Calculations at 360px width:
    // Viewport 360 x 640: sheet max-height is 320px (50%), screen behind visible is 320px (50%)
    // Viewport 360 x 800: sheet max-height is 400px (50%), screen behind visible is 400px (50%)
    const vh640Max = 640 * 0.5
    assert.equal(vh640Max, 320)
    assert.ok(640 - vh640Max >= 320, 'at least half viewport left for screen behind it')
  } finally {
    await cleanup()
  }
})

test('control touch targets: 44px on all controls and rows', async () => {
  const { helpers, cleanup } = await setupTestDom({ view: 'songbook' })
  try {
    const { rowOpen, toggle, panel, click } = helpers

    // Launcher row button and switch
    assert.match(rowOpen('metronome').className, /\bmin-h-11\b/, 'row button is min 44px')
    assert.match(toggle('metronome').className, /min-w-\[44px\] min-h-\[44px\]/, 'switch is 44px min')

    await click(rowOpen('metronome'))
    const mPanel = panel('metronome')
    const closeBtn = mPanel.querySelector('[aria-label="Close Metronome"]')
    assert.match(closeBtn.className, /min-h-11 min-w-11/, 'Close button is 44x44px')

    for (const ctrl of mPanel.querySelectorAll('button:not([data-testid="metronome-help-button"])')) {
      assert.match(ctrl.className, /min-h-11/, `button ${ctrl.textContent || ctrl.getAttribute('aria-label')} is min-h-11`)
    }
  } finally {
    await cleanup()
  }
})

test('menuHelp: AdvancedToolsHelp contains updated stage tools description', () => {
  const { AdvancedToolsHelp } = require('../src/components/menuHelp.tsx')
  assert.ok(AdvancedToolsHelp)
  const menuHelpSource = fs.readFileSync(path.join(__dirname, '../src/components/menuHelp.tsx'), 'utf8')
  assert.match(menuHelpSource, /Opens the \$\{name\} panel from any screen and adds its button to the Stage toolbar/)
  assert.match(menuHelpSource, /Switching it off stops it and closes its panel/)
})
