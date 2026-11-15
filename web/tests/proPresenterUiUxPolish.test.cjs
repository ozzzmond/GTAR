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

const React = require('react'), { act } = React
const { JSDOM } = require('jsdom')

const { getProPresenterStatus } = require('../src/utils/proPresenterStorage.ts')
const { readExtension } = require('../src/extensions/host/settings.ts')
const { ExtensionHost } = require('../src/extensions/host/ExtensionHost.ts')
const { registry } = require('../src/extensions/registry.ts')
const { LiveLyricsControl } = require('../src/components/LiveLyrics.tsx')
const { StageControlDock } = require('../src/components/StageControlDock.tsx')

function mockStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: key => map.delete(key),
    map,
  }
}

test('status indicator states: Green, Yellow, Red, and Disabled with accessible text', () => {
  // Disabled: Master switch OFF
  const disabled = getProPresenterStatus({
    enabled: false,
    hostState: 'disabled',
    liveSnapshot: null,
  })
  assert.equal(disabled.level, 'disabled')
  assert.match(disabled.label, /disabled/i)

  // Red: Enabled but offline
  const offline = getProPresenterStatus({
    enabled: true,
    hostState: 'offline',
    liveSnapshot: null,
  })
  assert.equal(offline.level, 'red')
  assert.match(offline.label, /disconnected/i)

  // Red: Enabled but error
  const error = getProPresenterStatus({
    enabled: true,
    hostState: 'error',
    liveSnapshot: null,
  })
  assert.equal(error.level, 'red')
  assert.match(error.label, /error/i)

  // Yellow: Connected in assisted mode, awaiting confirmation
  const awaiting = getProPresenterStatus({
    enabled: true,
    hostState: 'active',
    liveSnapshot: { live: true, session: 1, connection: 1, identityRevision: 1, presentation: null, current: null },
    liveConfirmed: false,
  })
  assert.equal(awaiting.level, 'yellow')
  assert.match(awaiting.label, /awaiting confirmation/i)

  // Green: Connected in assisted mode and confirmed, not paused
  const assistedFollowing = getProPresenterStatus({
    enabled: true,
    hostState: 'active',
    liveSnapshot: { live: true, session: 1, connection: 1, identityRevision: 1, presentation: null, current: null },
    liveConfirmed: true,
    liveScrollPaused: false,
  })
  assert.equal(assistedFollowing.level, 'green')
  assert.match(assistedFollowing.label, /active/i)

  // Yellow: Connected in assisted mode and confirmed, but scroll paused (manual override)
  const assistedPaused = getProPresenterStatus({
    enabled: true,
    hostState: 'active',
    liveSnapshot: { live: true, session: 1, connection: 1, identityRevision: 1, presentation: null, current: null },
    liveConfirmed: true,
    liveScrollPaused: true,
  })
  assert.equal(assistedPaused.level, 'yellow')
  assert.match(assistedPaused.label, /paused/i)

  // Green: Auto Follow mode active and not paused
  const autoActive = getProPresenterStatus({
    enabled: true,
    hostState: 'active',
    liveSnapshot: { live: true, session: 1, connection: 1, identityRevision: 1, presentation: null, current: null },
    autoFollowState: { mode: 'auto', paused: false, choices: [], status: 'Following' },
  })
  assert.equal(autoActive.level, 'green')
  assert.match(autoActive.label, /following/i)

  // Yellow: Auto Follow mode paused (manual scroll or song override)
  const autoPaused = getProPresenterStatus({
    enabled: true,
    hostState: 'active',
    liveSnapshot: { live: true, session: 1, connection: 1, identityRevision: 1, presentation: null, current: null },
    autoFollowState: { mode: 'auto', paused: true, choices: [], status: 'Paused' },
  })
  assert.equal(autoPaused.level, 'yellow')
  assert.match(autoPaused.label, /paused/i)

  // Yellow: Auto Follow mode ambiguous choices
  const autoAmbiguous = getProPresenterStatus({
    enabled: true,
    hostState: 'active',
    liveSnapshot: { live: true, session: 1, connection: 1, identityRevision: 1, presentation: null, current: null },
    autoFollowState: { mode: 'auto', paused: false, choices: [{ index: 0 }], status: 'Ambiguous' },
  })
  assert.equal(autoAmbiguous.level, 'yellow')
  assert.match(autoAmbiguous.label, /ambiguous/i)
})

test('remember last server: default OFF does not persist address across reloads', async () => {
  const storage = mockStorage()
  const manifest = registry[0].manifest
  const host = new ExtensionHost(registry, storage)

  // Initial read when nothing in storage
  const initial = readExtension(manifest, storage)
  assert.equal(initial.settings.host, '')
  assert.equal(host.getRememberLastServer('propresenter-follower'), false)

  // User saves host without enabling remember last server
  host.saveSettings('propresenter-follower', { host: '192.168.1.100', port: 1025 })
  // Simulate successful connection
  host.recordSuccessfulConnection('propresenter-follower', '192.168.1.100')

  // Storage should not have rememberedHost
  assert.equal(host.getRememberedHost('propresenter-follower'), '')

  // Simulate subsequent reload
  const reloaded = readExtension(manifest, storage)
  assert.equal(reloaded.settings.host, '')
})

test('remember last server: ON saves only successful address, restores on reload, and clear on uncheck keeps typed input', async () => {
  const storage = mockStorage()
  const manifest = registry[0].manifest
  const host = new ExtensionHost(registry, storage)

  // User enables remember last server
  host.setRememberLastServer('propresenter-follower', true)
  assert.equal(host.getRememberLastServer('propresenter-follower'), true)

  // Failed connection does NOT save to rememberedHost
  assert.equal(host.getRememberedHost('propresenter-follower'), '')

  // Successful connection saves address
  host.recordSuccessfulConnection('propresenter-follower', '192.168.1.50')
  assert.equal(host.getRememberedHost('propresenter-follower'), '192.168.1.50')

  // Simulate subsequent reload: address is restored and prefilled
  const reloaded = readExtension(manifest, storage)
  assert.equal(reloaded.settings.host, '192.168.1.50')

  // Temporary server unavailability does NOT erase saved address
  assert.equal(host.getRememberedHost('propresenter-follower'), '192.168.1.50')

  // User unchecks "Remember last server"
  host.setRememberLastServer('propresenter-follower', false)
  assert.equal(host.getRememberLastServer('propresenter-follower'), false)
  assert.equal(host.getRememberedHost('propresenter-follower'), '')

  // Reload after uncheck defaults host to empty
  const reloadedAfterUncheck = readExtension(manifest, storage)
  assert.equal(reloadedAfterUncheck.settings.host, '')
})

test('compact popover: help guide opens and dismisses with Escape, close button, and outside click', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const { createRoot } = require('react-dom/client')
  const root = createRoot(document.getElementById('root'))

  let isClosed = false
  const fakeLive = {
    status: 'Live',
    snapshot: {
      presentation: { uuid: 'p1', title: 'Great Are You Lord' },
      current: { uuid: 's1', text: 'It’s Your breath in our lungs' },
    },
    confirmed: false,
    canConfirm: true,
    confirm: () => true,
    stop: () => {},
  }

  await act(async () => {
    root.render(React.createElement(LiveLyricsControl, {
      live: fakeLive,
      songTitle: 'Great Are You Lord',
      isOpen: true,
      onClose: () => { isClosed = true },
      statusLevel: 'green',
      statusLabel: 'ProPresenter: Connected',
    }))
  })

  const control = document.querySelector('[data-testid="live-lyrics-control"]')
  assert.ok(control)
  assert.equal(control.open, true)

  // Help button opens help guide
  const helpBtn = document.querySelector('[data-testid="propresenter-help-button"]')
  assert.ok(helpBtn)
  assert.equal(document.querySelector('[data-testid="propresenter-help"]'), null)

  await act(async () => {
    helpBtn.click()
  })

  const helpGuide = document.querySelector('[data-testid="propresenter-help"]')
  assert.ok(helpGuide)
  assert.match(helpGuide.textContent, /Auto Follow/i)
  assert.match(helpGuide.textContent, /Manual Override/i)
  assert.match(helpGuide.textContent, /Resume/i)

  // Escape key on help guide dismisses help
  await act(async () => {
    helpGuide.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(document.querySelector('[data-testid="propresenter-help"]'), null)

  // Close button triggers onClose
  const closeBtn = document.querySelector('[data-testid="propresenter-close-button"]')
  assert.ok(closeBtn)
  await act(async () => {
    closeBtn.click()
  })
  assert.equal(isClosed, true)

  root.unmount()
  dom.window.close()
})

test('StageControlDock: PP button is hidden when showProPresenter is false, shown when true', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const { createRoot } = require('react-dom/client')
  const root = createRoot(document.getElementById('root'))

  // Render with showProPresenter = false
  await act(async () => {
    root.render(React.createElement(StageControlDock, {
      isAutoScrolling: false,
      onToggleAutoScroll: () => {},
      onOpenStageOptions: () => {},
      onPrevSection: () => {},
      onNextSection: () => {},
      showProPresenter: false,
    }))
  })

  assert.equal(document.querySelector('[data-testid="stage-vertical-propresenter-btn"]'), null)

  // Render with showProPresenter = true
  let toggled = false
  await act(async () => {
    root.render(React.createElement(StageControlDock, {
      isAutoScrolling: false,
      onToggleAutoScroll: () => {},
      onOpenStageOptions: () => {},
      onPrevSection: () => {},
      onNextSection: () => {},
      showProPresenter: true,
      proPresenterStatusLevel: 'green',
      proPresenterStatusLabel: 'ProPresenter: Actively following',
      onToggleProPresenter: () => { toggled = true },
    }))
  })

  const ppBtn = document.querySelector('[data-testid="stage-vertical-propresenter-btn"]')
  assert.ok(ppBtn)
  assert.match(ppBtn.getAttribute('aria-label'), /Actively following/i)
  assert.ok(ppBtn.textContent.includes('PP'))

  // Short tap triggers onToggleProPresenter
  await act(async () => {
    ppBtn.dispatchEvent(new dom.window.PointerEvent('pointerdown', { button: 0, bubbles: true }))
    ppBtn.dispatchEvent(new dom.window.PointerEvent('pointerup', { button: 0, bubbles: true }))
  })
  assert.equal(toggled, true)

  root.unmount()
  dom.window.close()
})

test('ExtensionRows: ProPresenter row includes help button, help disclosure, and remember last server checkbox', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Chrome/157 Android', platform: 'Linux', maxTouchPoints: 5 } })
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const { createRoot } = require('react-dom/client')
  const { ExtensionRows } = require('../src/extensions/host/ExtensionRows.tsx')
  const storage = mockStorage()
  const host = new ExtensionHost(registry, storage, { capabilities: ['net:lan', 'ui:panel'] })

  const root = createRoot(document.getElementById('root'))
  await act(async () => {
    await host.start()
    root.render(React.createElement(ExtensionRows, { host, rowClass: 'text-app-heading' }))
  })

  // Expand ProPresenter row
  const rowBtn = document.querySelector('button')
  assert.ok(rowBtn)
  await act(async () => {
    rowBtn.click()
  })

  // Help button is present
  const helpBtn = document.querySelector('[data-testid="propresenter-help-button"]')
  assert.ok(helpBtn)

  // Remember last server checkbox is present
  const rememberCheckbox = document.querySelector('[data-testid="propresenter-remember-server"]')
  assert.ok(rememberCheckbox)
  assert.equal(rememberCheckbox.checked, false)

  // Toggling remember checkbox updates host persistence without clearing typed input
  await act(async () => {
    rememberCheckbox.click()
  })
  assert.equal(host.getRememberLastServer('propresenter-follower'), true)

  await act(async () => {
    rememberCheckbox.click()
  })
  assert.equal(host.getRememberLastServer('propresenter-follower'), false)

  root.unmount()
  dom.window.close()
})

test('horizontal dock: PP control is hidden when ProPresenter is OFF, exposed when ON', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Chrome/157 Android', platform: 'Linux', maxTouchPoints: 5 } })
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: dom.window.document.documentElement })
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const { createRoot } = require('react-dom/client')
  const { StageView } = require('../src/components/StageView.tsx')
  const { ExtensionHostContext } = require('../src/extensions/host/ExtensionHostContext.ts')

  const song = {
    id: 1,
    title: 'Blessed Be Your Name',
    artist: 'Matt Redman',
    key: 'A',
    originalKey: 'A',
    confirmedChartKey: 'A',
    transposeOffset: 0,
    rawContent: '{title: Blessed Be Your Name}\n[A]Blessed be Your name\n[E]In the land that is plentiful',
    format: 'CHORD_PRO',
    capo: '',
    bpm: '',
  }

  const disabledStorage = mockStorage()
  const disabledHost = new ExtensionHost(registry, disabledStorage, { capabilities: ['net:lan', 'ui:panel'] })
  await disabledHost.start()

  const root = createRoot(document.getElementById('root'))

  // Master switch OFF: PP control is hidden
  await act(async () => {
    root.render(
      React.createElement(ExtensionHostContext.Provider, { value: disabledHost },
        React.createElement(StageView, {
          song,
          songs: [song],
          activeSongIndex: 0,
          onSelectSongIndex: () => {},
          transposeOffset: 0,
          onTransposeChange: () => {},
        })
      )
    )
  })

  // Enter fullscreen performance mode
  await act(async () => {
    document.dispatchEvent(new dom.window.Event('fullscreenchange'))
  })

  // When disabled, horizontal PP button is not present
  assert.equal(document.querySelector('[data-testid="stage-bottom-propresenter-btn"]'), null)

  // Now enable ProPresenter
  await disabledHost.enable('propresenter-follower')

  await act(async () => {
    root.render(
      React.createElement(ExtensionHostContext.Provider, { value: disabledHost },
        React.createElement(StageView, {
          song,
          songs: [song],
          activeSongIndex: 0,
          onSelectSongIndex: () => {},
          transposeOffset: 0,
          onTransposeChange: () => {},
        })
      )
    )
  })

  // PP button is now present in the bottom transport controls
  const ppBtn = document.querySelector('[data-testid="stage-bottom-propresenter-btn"]')
  assert.ok(ppBtn)
  assert.ok(ppBtn.textContent.includes('PP'))

  // Clicking horizontal PP button opens the compact popover dialog
  const control = document.querySelector('[data-testid="live-lyrics-control"]')
  assert.ok(control)
  assert.equal(control.open, false)

  await act(async () => {
    ppBtn.click()
  })
  assert.equal(control.open, true)
  const popoverDialog = document.querySelector('[aria-label="ProPresenter controls"]')
  assert.ok(popoverDialog)
  assert.ok(popoverDialog.textContent.includes('ProPresenter'))

  // Clicking PP button again toggles popover closed
  await act(async () => {
    ppBtn.click()
  })
  assert.equal(control.open, false)

  root.unmount()
  disabledHost.dispose()
  dom.window.close()
})

test('Advanced Tools: ProPresenter uses matching switch toggle and interactive contextual help', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Chrome/157', platform: 'Linux', maxTouchPoints: 0 } })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const { createRoot } = require('react-dom/client')
  const { ExtensionRows } = require('../src/extensions/host/ExtensionRows.tsx')

  const storage = mockStorage()
  const host = new ExtensionHost(registry, storage, { capabilities: ['net:lan', 'ui:panel'] })
  await host.start()

  const root = createRoot(document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(ExtensionRows, { host, rowClass: 'text-app-heading' }))
  })

  const row = document.querySelector('[data-testid="extension-propresenter-follower"]')
  assert.ok(row)

  // Master switch toggle with role="switch" is present
  const toggle = row.querySelector('[data-testid="settings-propresenter-follower-toggle"]')
  assert.ok(toggle)
  assert.equal(toggle.getAttribute('role'), 'switch')
  assert.equal(toggle.checked, false)

  // Toggling master switch enables ProPresenter
  await act(async () => {
    toggle.click()
  })
  assert.ok(['starting', 'active', 'offline'].includes(host.getSnapshot('propresenter-follower').state))
  assert.equal(toggle.checked, true)

  // Expand row to inspect panel
  const expandBtn = row.querySelector('[data-testid="extension-propresenter-follower-expand"]')
  assert.ok(expandBtn)
  await act(async () => {
    expandBtn.click()
  })

  // Panel does NOT render redundant nested checkbox
  const panel = document.getElementById('extension-propresenter-follower-panel')
  assert.ok(panel)
  assert.equal(panel.querySelector('input[type="checkbox"][name="enable"]'), null)
  assert.equal(panel.textContent.includes('Enable ProPresenter'), false)

  // Contextual help is present and accessible
  const helpBtn = document.querySelector('[data-testid="propresenter-help-button"]')
  assert.ok(helpBtn)
  assert.equal(document.querySelector('[data-testid="propresenter-help"]'), null)

  await act(async () => {
    helpBtn.click()
  })
  const helpPanel = document.querySelector('[data-testid="propresenter-help"]')
  assert.ok(helpPanel)
  assert.match(helpPanel.textContent, /Indicators/i)
  assert.match(helpPanel.textContent, /Auto Follow/i)
  assert.match(helpPanel.textContent, /Manual Override/i)
  assert.match(helpPanel.textContent, /Resume/i)

  // Escape key closes help
  await act(async () => {
    helpPanel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(document.querySelector('[data-testid="propresenter-help"]'), null)

  root.unmount()
  host.dispose()
  dom.window.close()
})

test('Round 3: Dedicated configuration panels in Advanced Tools and minimal dock popover without misleading settings link', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Chrome/157', platform: 'Linux', maxTouchPoints: 0 } })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const { createRoot } = require('react-dom/client')
  const { ExtensionRows } = require('../src/extensions/host/ExtensionRows.tsx')
  const { OnlineSourcesRow } = require('../src/components/OnlineSourcesRow.tsx')

  // 1. LiveLyricsControl popover: no misleading settings link, no verbose DEV warnings
  const root = createRoot(document.getElementById('root'))
  const liveMock = {
    status: 'Ready',
    confirmed: false,
    canConfirm: true,
    confirm: () => true,
    stop: () => {},
    scrollRange: null,
    activeLineIds: new Set(),
    snapshot: null,
  }

  await act(async () => {
    root.render(React.createElement(LiveLyricsControl, {
      live: liveMock,
      songTitle: 'Amazing Grace',
      isOpen: true,
    }))
  })

  const dockPopover = document.querySelector('[aria-label="ProPresenter controls"]')
  assert.ok(dockPopover)
  // F5 verified: No misleading "ProPresenter Settings" link
  assert.equal(dockPopover.textContent.includes('ProPresenter Settings'), false)
  // F4 verified: No verbose DEV warnings in the popover
  assert.equal(dockPopover.textContent.includes('DEV:'), false)

  // 2. OnlineSourcesRow: dedicated modal panel with backdrop and accessible dismissal
  await act(async () => {
    root.render(React.createElement(OnlineSourcesRow, {
      rowClass: 'item',
      enabled: true,
      onToggle: () => {},
    }))
  })

  // Initially closed
  assert.equal(document.querySelector('[data-testid="online-sources-modal-backdrop"]'), null)
  assert.equal(document.querySelector('[data-testid="online-sources-panel"]'), null)

  // Click to open dedicated panel
  const onlineExpand = document.querySelector('[data-testid="online-sources-expand"]')
  assert.ok(onlineExpand)
  await act(async () => {
    onlineExpand.click()
  })

  const onlineBackdrop = document.querySelector('[data-testid="online-sources-modal-backdrop"]')
  const onlinePanel = document.querySelector('[data-testid="online-sources-panel"]')
  assert.ok(onlineBackdrop, 'Dedicated backdrop is rendered')
  assert.ok(onlinePanel, 'Dedicated modal dialog is rendered')
  assert.equal(onlinePanel.getAttribute('role'), 'dialog')
  assert.equal(onlinePanel.getAttribute('aria-modal'), 'true')

  // Escape key closes dedicated panel
  await act(async () => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(document.querySelector('[data-testid="online-sources-panel"]'), null)

  // 3. ExtensionRows: dedicated modal panel with backdrop and accessible dismissal
  const storage = mockStorage()
  const host = new ExtensionHost(registry, storage, { capabilities: ['net:lan', 'ui:panel'] })
  await host.start()

  await act(async () => {
    root.render(React.createElement(ExtensionRows, { host, rowClass: 'item' }))
  })

  assert.equal(document.querySelector('[data-testid="extension-propresenter-follower-modal-backdrop"]'), null)
  assert.equal(document.querySelector('[data-testid="extension-propresenter-follower-panel"]'), null)

  // Click expand to open dedicated ProPresenter panel
  const ppExpand = document.querySelector('[data-testid="extension-propresenter-follower-expand"]')
  assert.ok(ppExpand)
  await act(async () => {
    ppExpand.click()
  })

  const ppBackdrop = document.querySelector('[data-testid="extension-propresenter-follower-modal-backdrop"]')
  const ppPanel = document.querySelector('[data-testid="extension-propresenter-follower-panel"]')
  assert.ok(ppBackdrop, 'Dedicated ProPresenter backdrop is rendered')
  assert.ok(ppPanel, 'Dedicated ProPresenter modal dialog is rendered')
  assert.equal(ppPanel.getAttribute('role'), 'dialog')
  assert.equal(ppPanel.getAttribute('aria-modal'), 'true')

  // Escape key closes dedicated panel
  await act(async () => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(document.querySelector('[data-testid="extension-propresenter-follower-panel"]'), null)

  root.unmount()
  host.dispose()
  dom.window.close()
})
