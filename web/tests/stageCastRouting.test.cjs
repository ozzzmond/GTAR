const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const Module = require('node:module')
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (parent && parent.filename && request.startsWith('.')) {
    const dir = path.dirname(parent.filename)
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const candidate = path.resolve(dir, request + ext)
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

require.extensions['.css'] = () => {};
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
          jsx: ts.JsxEmit.React,
        },
      }).outputText,
      filename
    )
}

const {
  stageCast,
  getPresentationCapabilities,
} = require('../src/utils/stageCast.ts')
const { isIosDevice } = require('../src/utils/stagePerformance.ts')

const originalNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
function setMockNavigator(nav) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: nav,
  })
}
function restoreNavigator() {
  if (originalNavDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavDescriptor)
  } else {
    delete globalThis.navigator
  }
}

test('isIosDevice: identifies iOS across all real device scenarios including zero maxTouchPoints, desktop mode, and third-party browsers', () => {
  const oldWin = globalThis.window

  try {
    globalThis.window = {}

    // 1. Desktop Chrome/Firefox (no touch, no standalone, no iOS UA)
    setMockNavigator({ maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    assert.equal(isIosDevice(), false)

    // 2. Android Chrome (touch, but no iOS indicators)
    setMockNavigator({ maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })
    assert.equal(isIosDevice(), false)

    // 3. Physical iPhone: Real Safari with maxTouchPoints > 0
    setMockNavigator({
      maxTouchPoints: 5,
      standalone: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    })
    assert.equal(isIosDevice(), true)

    // 4. Physical iPhone: Zero or undefined maxTouchPoints (reproducing the field test failure condition)
    setMockNavigator({
      maxTouchPoints: 0,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    })
    assert.equal(isIosDevice(), true, 'Must identify iPhone even when maxTouchPoints is 0')

    setMockNavigator({
      maxTouchPoints: undefined,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    })
    assert.equal(isIosDevice(), true, 'Must identify iPhone even when maxTouchPoints is undefined')

    // 5. iOS Chrome / Firefox (CriOS / FxiOS) without standalone property
    setMockNavigator({
      maxTouchPoints: 5,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1',
    })
    assert.equal(isIosDevice(), true, 'Must identify iPhone on third-party browsers lacking standalone')

    // 6. iPhone / iPad Desktop Mode (UA reports Macintosh / MacIntel, with touch capability)
    setMockNavigator({
      maxTouchPoints: 5,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    })
    assert.equal(isIosDevice(), true, 'Must identify iOS device in Request Desktop Website mode')

    // 7. iOS PWA Home Screen (standalone === true)
    setMockNavigator({
      maxTouchPoints: 5,
      standalone: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
    })
    assert.equal(isIosDevice(), true)
  } finally {
    restoreNavigator()
    globalThis.window = oldWin
  }
})

test('getPresentationCapabilities: routes iOS to tv_pairing under field reproduction conditions', () => {
  const oldWin = globalThis.window

  try {
    globalThis.window = {
      location: { origin: 'http://localhost:5173' },
      open: () => {
        throw new Error('window.open should NOT be called during capability check')
      },
    }

    // Field condition: iPhone with maxTouchPoints: 0
    setMockNavigator({
      maxTouchPoints: 0,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    })

    const caps = getPresentationCapabilities()
    assert.equal(caps.platform, 'ios')
    assert.equal(caps.supportsPresentationApi, false)
    assert.equal(caps.supportsMultiWindow, false, 'supportsMultiWindow must be strictly false on iOS')
    assert.equal(caps.canDirectPresent, false)
    assert.equal(caps.recommendedMode, 'tv_pairing', 'recommendedMode must be tv_pairing')
    assert.equal(caps.reason, 'IOS_WEBKIT_NO_MULTIWINDOW_PRESENTATION')
  } finally {
    restoreNavigator()
    globalThis.window = oldWin
  }
})

test('getPresentationCapabilities: allows desktop multi-window popup and Presentation API when available', () => {
  const oldWin = globalThis.window

  try {
    // Desktop without PresentationRequest (e.g. Desktop Firefox)
    globalThis.window = {
      location: { origin: 'http://localhost:5173' },
      open: () => null,
    }
    setMockNavigator({
      maxTouchPoints: 0,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    })

    const ffCaps = getPresentationCapabilities()
    assert.equal(ffCaps.platform, 'desktop')
    assert.equal(ffCaps.supportsPresentationApi, false)
    assert.equal(ffCaps.supportsMultiWindow, true)
    assert.equal(ffCaps.canDirectPresent, true)
    assert.equal(ffCaps.recommendedMode, 'popup_window')

    // Desktop Chrome with PresentationRequest
    globalThis.window.PresentationRequest = class MockPresentationRequest {}
    const chromeCaps = getPresentationCapabilities()
    assert.equal(chromeCaps.supportsPresentationApi, true)
    assert.equal(chromeCaps.canDirectPresent, true)
    assert.equal(chromeCaps.recommendedMode, 'presentation_api')
  } finally {
    restoreNavigator()
    globalThis.window = oldWin
  }
})

test('iOS safe routing: field reproduction proves window.open call count is ZERO and routes to tv_pairing', async () => {
  const oldWin = globalThis.window
  let windowOpenCalls = 0

  try {
    globalThis.window = {
      location: { origin: 'http://localhost:5173' },
      open: () => {
        windowOpenCalls++
        return {}
      },
    }

    // Reproduce physical iPhone scenario where previous logic fell through to popup
    setMockNavigator({
      maxTouchPoints: 0,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    })

    // 1. requestPresentation should return mode: tv_pairing and NOT call window.open
    const result = await stageCast.requestPresentation()
    assert.equal(result.success, false)
    assert.equal(result.mode, 'tv_pairing')
    assert.equal(windowOpenCalls, 0, 'window.open call count must be 0 on iOS')

    // 2. openPresentationWindow should return null and NOT call window.open
    const win = await stageCast.openPresentationWindow()
    assert.equal(win, null)
    assert.equal(windowOpenCalls, 0, 'window.open call count must remain 0 on iOS')

    // 3. Verify desktop mode iPhone also has zero window.open calls
    setMockNavigator({
      maxTouchPoints: 5,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    })
    const resultDesktopMode = await stageCast.requestPresentation()
    assert.equal(resultDesktopMode.success, false)
    assert.equal(resultDesktopMode.mode, 'tv_pairing')
    assert.equal(windowOpenCalls, 0, 'window.open call count must be 0 for desktop-mode iOS')

    // 4. Connection state must remain truthful (not pretending to be active)
    assert.equal(stageCast.isPresentationActive(), false)
  } finally {
    restoreNavigator()
    globalThis.window = oldWin
  }
})

test('Desktop safe routing: requestPresentation uses window.open popup on desktop fallback', async () => {
  const oldWin = globalThis.window
  let windowOpenCalls = 0
  const mockWindow = { focus() {}, closed: false, postMessage() {} }

  try {
    globalThis.window = {
      location: { origin: 'http://localhost:5173' },
      open: () => {
        windowOpenCalls++
        return mockWindow
      },
    }
    setMockNavigator({
      maxTouchPoints: 0,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })

    const result = await stageCast.requestPresentation()
    assert.equal(result.success, true)
    assert.equal(result.mode, 'popup_window')
    assert.equal(windowOpenCalls, 1)

    // Clean up
    stageCast.stopPresentation()
    assert.equal(stageCast.isPresentationActive(), false)
  } finally {
    restoreNavigator()
    globalThis.window = oldWin
  }
})

test('Presentation contract: Session ID and Pairing URL adhere to security and privacy guards', () => {
  const oldWin = globalThis.window

  try {
    globalThis.window = {
      location: { origin: 'http://192.168.1.100:5173', protocol: 'http:' },
    }
    setMockNavigator({ maxTouchPoints: 0 })

    const sessionId = stageCast.getPresentationSessionId()
    assert.match(sessionId, /^GTAR-[A-Z0-9]{4,}$/)

    // Consecutive calls return the same session ID
    assert.equal(stageCast.getPresentationSessionId(), sessionId)

    const url = stageCast.getPresentationPairingUrl()
    const parsed = new URL(url)

    // Guards:
    // 1. Short alias retains session-bearing URL contract
    assert.equal(parsed.pathname, '/tv')
    // 2. view is present
    assert.equal(parsed.searchParams.get('view'), 'present')
    // 3. session is sessionId
    assert.equal(parsed.searchParams.get('session'), sessionId)
    // 4. No song content in URL
    assert.equal(parsed.searchParams.has('song'), false)
    assert.equal(parsed.searchParams.has('content'), false)
    assert.equal(parsed.searchParams.has('lyrics'), false)
    // 5. No secrets in URL
    assert.equal(parsed.searchParams.has('token'), false)
    assert.equal(parsed.searchParams.has('key'), false)
    assert.equal(parsed.searchParams.has('secret'), false)

    // Custom host override (e.g. detected LAN IP)
    const lanUrl = stageCast.getPresentationPairingUrl('192.168.1.150:5173')
    assert.equal(lanUrl, `http://192.168.1.150:5173/tv?view=present&session=${sessionId}`)
  } finally {
    restoreNavigator()
    globalThis.window = oldWin
  }
})

test('Source contract verification: StageView guards Cast on iOS and provides TvPresentationModal', () => {
  const stageViewFile = path.resolve(__dirname, '../src/components/StageView.tsx')
  const content = fs.readFileSync(stageViewFile, 'utf8')

  // Asserts StageView imports TvPresentationModal
  assert.match(content, /import\s+\{\s*TvPresentationModal\s*\}\s+from\s+'\.\/TvPresentationModal'/)

  // Asserts StageView checks recommendedMode / canDirectPresent before presenting
  assert.match(content, /stageCast\.getPresentationCapabilities\(\)/)
  assert.match(content, /recommendedMode === 'tv_pairing'/)
  assert.match(content, /setIsTvPresentationModalOpen\(true\)/)

  // Asserts TvPresentationModal is rendered
  assert.match(content, /<TvPresentationModal[\s\S]*?isOpen=\{isTvPresentationModalOpen\}/)
})

test('Stage Options integration: proves Sync to TV action exists inside Stage Options and wires pairing flow', () => {
  const stageViewFile = path.resolve(__dirname, '../src/components/StageView.tsx')
  const content = fs.readFileSync(stageViewFile, 'utf8')

  // 1. Asserts Stage Options bottom sheet contains TV Sync action
  assert.match(content, /data-testid="stage-options-sync-tv-btn"/, 'Stage Options must include TV Sync button')
  assert.match(content, /TV Sync/, 'Stage Options must display TV Sync label')
  assert.match(content, /Sync to TV/, 'Stage Options button text must say Sync to TV when inactive')

  // 2. Asserts clicking TV Sync calls handleTogglePresentation and closes menu
  assert.match(content, /setIsStageMenuOpen\(false\)[\s\S]*?await handleTogglePresentation\(\)/)

  // 3. Asserts handleTogglePresentation checks recommendedMode === 'tv_pairing' and triggers pairing flow
  assert.match(content, /const handleTogglePresentation = useCallback/)
  assert.match(content, /handleTogglePresentation[\s\S]*?stageCast\.getPresentationCapabilities\(\)/)
  assert.match(content, /handleTogglePresentation[\s\S]*?recommendedMode === 'tv_pairing'[\s\S]*?setIsTvPresentationModalOpen\(true\)/)

  // 4. Asserts top bar Cast button also reuses handleTogglePresentation (no duplicate presentation logic)
  assert.match(content, /<Cast className="w-4 h-4" \/>/)
  assert.match(content, /onClick=\{handleTogglePresentation\}/)
})
test('Stage Cast Security: postMessage restricts targetOrigin and validates event origin', () => {
  const oldWin = globalThis.window
  try {
    const postedMessages = []
    const mockPopup = {
      closed: false,
      postMessage(msg, targetOrigin) {
        postedMessages.push({ msg, targetOrigin })
      },
    }

    const listeners = {}
    globalThis.window = {
      location: { origin: 'https://gtar.app', protocol: 'https:' },
      addEventListener(type, fn) {
        listeners[type] = fn
      },
      removeEventListener(type) {
        delete listeners[type]
      },
      sessionStorage: {
        getItem() { return null },
        setItem() {},
      },
    }

    // 1. Target origin restriction: valid origin
    stageCast.setPopupWindow(mockPopup)
    stageCast.broadcastState({
      song: { id: 1, title: 'Security Test', rawContent: 'Hello' },
      effectiveKey: 'C',
      transposeOffset: 0,
      fontSizePx: 28,
      fontStyle: 'mono',
      isTwoColumn: false,
    })

    assert.equal(postedMessages.length, 1)
    assert.equal(postedMessages[0].targetOrigin, 'https://gtar.app', 'postMessage must target exact window origin, NOT wildcard *')

    // 2. Target origin restriction: fail closed when origin is unavailable/null/*/empty
    globalThis.window.location = { origin: '' }
    stageCast.broadcastState({
      song: { id: 2, title: 'Fail Closed Test', rawContent: 'World' },
      effectiveKey: 'D',
      transposeOffset: 0,
      fontSizePx: 28,
      fontStyle: 'mono',
      isTwoColumn: false,
    })
    assert.equal(postedMessages.length, 1, 'Must not send postMessage when origin cannot be trusted')

    globalThis.window.location = { origin: 'https://gtar.app' }

    // 3. Window listener ignores messages from untrusted origins
    let receivedState = null
    const unsub = stageCast.subscribe((state) => {
      receivedState = state
    }, () => {})

    assert.ok(listeners.message, 'window message listener registered')

    // Untrusted origin: should be ignored
    listeners.message({
      origin: 'https://malicious.evil.com',
      source: mockPopup,
      data: {
        source: 'GTAR_CAST',
        message: {
          type: 'STATE_UPDATE',
          payload: {
            song: { id: 999, title: 'Hijacked' },
          },
        },
      },
    })
    assert.equal(receivedState, null, 'Untrusted origin message must be rejected')

    // Untrusted sender source: should be ignored when popup is registered
    const alienWindow = { closed: false }
    listeners.message({
      origin: 'https://gtar.app',
      source: alienWindow,
      data: {
        source: 'GTAR_CAST',
        message: {
          type: 'STATE_UPDATE',
          payload: {
            song: { id: 888, title: 'Alien Window Hijack' },
          },
        },
      },
    })
    assert.equal(receivedState, null, 'Untrusted sender source must be rejected')

    // Non-GTAR envelope: should be ignored
    listeners.message({
      origin: 'https://gtar.app',
      source: mockPopup,
      data: {
        source: 'SOME_OTHER_APP',
        message: {
          type: 'STATE_UPDATE',
          payload: {
            song: { id: 777, title: 'Foreign App Hijack' },
          },
        },
      },
    })
    assert.equal(receivedState, null, 'Non-GTAR_CAST source envelope must be rejected')

    // Trusted origin, trusted popup source, valid envelope: accepted
    listeners.message({
      origin: 'https://gtar.app',
      source: mockPopup,
      data: {
        source: 'GTAR_CAST',
        message: {
          type: 'STATE_UPDATE',
          payload: {
            song: { id: 42, title: 'Legitimate Update' },
          },
        },
      },
    })
    assert.ok(receivedState)
    assert.equal(receivedState.song.title, 'Legitimate Update', 'Trusted origin and source message must be accepted')

    unsub()
  } finally {
    globalThis.window = oldWin
  }
})


test('Presentation entry points: short alias and legacy routes preserve query data', () => {
  const { isPresentationLocation } = require('../src/utils/presentationRoute.ts')
  for (const route of ['/tv', '/tv/', '/stage/present', '/stage/present?view=present&session=GTAR-ABCD', '/tv?session=GTAR-ABCD', '/?view=present', '/#present']) {
    const url = new URL(route, 'https://dev.gtar-web.pages.dev')
    const before = url.href
    assert.equal(isPresentationLocation(url), true, route)
    assert.equal(url.href, before, 'Route selection must not rewrite session data')
    if (route.includes('session=')) assert.equal(url.searchParams.get('session'), 'GTAR-ABCD')
  }
  for (const route of ['/', '/tvision', '/tv/other', '/library']) {
    assert.equal(isPresentationLocation(new URL(route, 'https://dev.gtar-web.pages.dev')), false)
  }
  for (const file of ['App.tsx', 'components/AuthGate.tsx']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8')
    assert.match(source, /isPresentationLocation\(window.location\)/, file)
  }
})

test('TV modal: unified TV Browser Presentation Page renders pairing controls without legacy mirroring tutorials', () => {
  globalThis.__GTAR_STAGE_CAST2_ENABLED__ = true;
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server')
  const { TvPresentationModal } = require('../src/components/TvPresentationModal.tsx')
  const oldWin = globalThis.window
  try {
    for (const [userAgent, platform, maxTouchPoints, standalone, api, ios, android, mode] of [
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5, false, false, false, true, 'tv_pairing'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel Tablet)', 'Linux armv8l', 5, true, false, false, true, 'tv_pairing'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5, false, true, false, true, 'presentation_api'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel Tablet)', 'Linux armv8l', 5, true, true, false, true, 'presentation_api'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0, false, false, false, false, 'popup_window'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0, false, true, false, false, 'presentation_api'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 5, false, false, false, false, 'tv_pairing'],
      ['Unknown touch device', '', 5, false, false, false, false, 'tv_pairing'],
      ['', '', 0, true, false, false, false, 'tv_pairing'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', 'iPhone', 0, false, false, true, false, 'tv_pairing'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5, true, false, true, false, 'tv_pairing'],
    ]) {
      globalThis.window = {
        location: { origin: 'https://dev.gtar-web.pages.dev', protocol: 'https:' },
        open() { assert.fail('Rendering guidance must not open a popup') },
        matchMedia() { return { matches: standalone } },
        ...(api ? { PresentationRequest: class { constructor() { assert.fail('Rendering guidance must not start presentation') } } } : {}),
      }
      setMockNavigator({ userAgent, platform, maxTouchPoints })
      const caps = getPresentationCapabilities()
      assert.equal(caps.isAndroid, android, userAgent)
      assert.equal(caps.recommendedMode, mode, userAgent)
      assert.equal(caps.supportsPresentationApi, api)
      assert.equal(caps.supportsMultiWindow, mode === 'popup_window' || (mode === 'presentation_api' && !maxTouchPoints))
      const html = renderToStaticMarkup(React.createElement(TvPresentationModal, { isOpen: true, onClose() {} }))
      assert.ok(html.includes('TV Browser Presentation Page'), 'Must show unified TV Browser Presentation Page')
      assert.ok(html.includes('TV reference'), 'Must include TV reference pairing input')
      assert.ok(html.includes('Six-digit TV PIN'), 'Must include Six-digit TV PIN pairing input')
      assert.doesNotMatch(html, /Screen Mirroring \(Android\)|AirPlay Screen Mirroring|Smart View|Google Home/)
      assert.doesNotMatch(html, /Opening this page does not connect devices/)
      assert.doesNotMatch(html, /will not receive/)
      assert.doesNotMatch(html, /Session URL \(does not pair devices\)/)
      assert.doesNotMatch(html, /Route: \/tv/)
      assert.match(html, /aria-label="TV Page URL"[^>]*value="https:\/\/dev.gtar-web.pages.dev\/tv"/)
    }
    assert.equal(stageCast.getPresentationPageUrl(), 'https://dev.gtar-web.pages.dev/tv')
    assert.equal(stageCast.getPresentationPageUrl('192.168.1.150:5173'), 'https://192.168.1.150:5173/tv')
  } finally {
    delete globalThis.__GTAR_STAGE_CAST2_ENABLED__;
    restoreNavigator()
    globalThis.window = oldWin
  }
})

test('TV modal: SSR without navigator or window omits device-specific mirroring guidance', () => {
  globalThis.__GTAR_STAGE_CAST2_ENABLED__ = true;
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { TvPresentationModal } = require('../src/components/TvPresentationModal.tsx')
  const oldWin = globalThis.window
  try {
    delete globalThis.window
    delete globalThis.navigator
    assert.equal(getPresentationCapabilities().isAndroid, false)
    const html = renderToStaticMarkup(React.createElement(TvPresentationModal, { isOpen: true, onClose() {} }))
    assert.ok(html.includes('TV Browser Presentation Page'))
    assert.doesNotMatch(html, /Screen Mirroring \(Android\)|AirPlay|Smart View|Google Home/)
    assert.equal(renderToStaticMarkup(React.createElement(TvPresentationModal, { isOpen: false, onClose() {} })), '')
  } finally {
    delete globalThis.__GTAR_STAGE_CAST2_ENABLED__;
    restoreNavigator()
    globalThis.window = oldWin
  }
})

// Mocked windows prove routing and call-stack timing, not browser popup policy.
for (const file of ['App.tsx', 'components/StageView.tsx']) {
  test(`Desktop Cast handler prefers synchronous same-origin popup with PresentationRequest: ${file}`, async () => {
    const vm = require('node:vm')
    const source = fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8')
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let callback
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleTogglePresentation') {
        callback = node.initializer.arguments[0].getText(ast)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.ok(callback)
    const oldWin = globalThis.window
    const messages = [], alerts = [], active = []
    let opens = 0, starts = 0, inGesture = false, blocked = false
    const popup = { closed: false, focus() {}, close() { this.closed = true }, postMessage(message, origin) { messages.push({ message, origin }) } }
    const song = { id: 'popup-song', title: 'Popup Song', rawContent: '[C]Hello', transposeOffset: 2 }
    const colors = { background: '#112233' }
    let unsubscribe
    try {
      setMockNavigator({ maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
      globalThis.window = {
        location: { origin: 'https://dev.gtar-web.pages.dev' },
        alert(message) { alerts.push(message) },
        open(url, name) {
          assert.equal(inGesture, true, 'window.open must run before handler returns its promise')
          opens++
          assert.equal(url, 'https://dev.gtar-web.pages.dev/stage/present?view=present')
          assert.equal(name, 'gtar_stage_teleprompter')
          const parsed = new URL(url)
          assert.equal(parsed.username + parsed.password + parsed.hash, '')
          assert.deepEqual([...parsed.searchParams], [['view', 'present']])
          return blocked ? null : popup
        },
        PresentationRequest: class { start() { starts++; throw Error('Must not start receiver') } },
      }
      stageCast.stopPresentation()
      stageCast.setThemeSnapshot('dark', colors)
      unsubscribe = stageCast.subscribeSessionState(value => active.push(value))
      const handler = vm.runInNewContext(ts.transpileModule(`const handler = ${callback}; handler;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText, {
        stageCast, window: globalThis.window, isCastActive: false,
        currentSong: song, song, effectiveKey: 'D', transposeOffset: 2,
        fontSizePx: 30, fontStyle: 'mono', isTwoColumn: true, chordScale: 110,
        fontWeight: 'bold', lineSpacing: 'relaxed',
        transposeContext: () => ({ performanceKey: 'D' }),
        scrollContainerRef: { current: { scrollHeight: 1000, clientHeight: 500, scrollTop: 125 } },
        setIsTvPresentationModalOpen() { assert.fail('No transport fallback') },
      })
      inGesture = true
      const pending = handler()
      inGesture = false
      assert.equal(opens, 1)
      assert.equal(starts, 0)
      await pending
      assert.equal(stageCast.isPresentationActive(), true)
      assert.equal(active.at(-1), true)
      await new Promise(resolve => setTimeout(resolve, 170))
      const injected = messages.find(entry => entry.message.message.type === 'STATE_UPDATE')
      assert.ok(injected)
      assert.equal(injected.origin, window.location.origin)
      assert.equal(injected.message.message.payload.song.title, song.title)
      assert.equal(injected.message.message.payload.effectiveKey, 'D')
      assert.equal(injected.message.message.payload.themeMode, 'dark')
      assert.deepEqual(injected.message.message.payload.customThemeColors, colors)
      stageCast.broadcastScroll(250, 0.5)
      assert.deepEqual(messages.at(-1).message.message, { type: 'SCROLL_UPDATE', payload: { scrollTop: 250, scrollFraction: 0.5 } })
      const updated = { ...stageCast.getCachedState(), song: { ...song, title: 'Next Song' } }
      stageCast.broadcastState(updated)
      assert.equal(messages.at(-1).message.message.payload.song.title, 'Next Song')
      stageCast.stopPresentation()
      assert.equal(active.at(-1), false)
      blocked = true
      inGesture = true
      const failed = handler()
      inGesture = false
      await failed
      assert.equal(starts, 0)
      assert.equal(stageCast.isPresentationActive(), false)
      assert.equal(alerts.length, 1)
      assert.match(alerts[0], /Allow pop-ups.*try Cast again/)
      inGesture = true
      const result = await stageCast.requestPresentation({ preferPopup: true })
      inGesture = false
      assert.equal(result.success, false)
      assert.equal(result.mode, 'popup_window')
      assert.match(result.error, /Allow pop-ups/)
    } finally {
      unsubscribe?.()
      stageCast.stopPresentation()
      restoreNavigator()
      globalThis.window = oldWin
    }
  })
}

test('Wireless default still starts Presentation API and injects state and scroll', async () => {
  const oldWin = globalThis.window
  const sent = []
  let starts = 0
  const connection = { id: 'wireless', state: 'connected', send(data) { sent.push(JSON.parse(data)) }, terminate() {} }
  try {
    setMockNavigator({ maxTouchPoints: 0, userAgent: 'Windows' })
    globalThis.window = {
      location: { origin: 'https://dev.gtar-web.pages.dev' },
      open() { assert.fail('Wireless path must use Presentation API') },
      PresentationRequest: class {
        constructor(urls) { assert.deepEqual(urls, ['https://dev.gtar-web.pages.dev/stage/present?view=present']) }
        async start() { starts++; return connection }
      },
    }
    stageCast.broadcastState({ song: { title: 'Wireless Song' }, effectiveKey: 'G', transposeOffset: 0, fontSizePx: 24, fontStyle: 'mono', isTwoColumn: false })
    stageCast.broadcastScroll(100, 0.25)
    assert.deepEqual(await stageCast.requestPresentation(), { success: true, mode: 'presentation_api' })
    assert.equal(starts, 1)
    assert.equal(sent[0].message.payload.song.title, 'Wireless Song')
    assert.equal(sent[1].message.type, 'SCROLL_UPDATE')
    const count = sent.length
    connection.onmessage({ data: { type: 'REQUEST_STATE' } })
    assert.equal(sent.length, count + 2)
  } finally {
    stageCast.stopPresentation()
    restoreNavigator()
    globalThis.window = oldWin
  }
})
