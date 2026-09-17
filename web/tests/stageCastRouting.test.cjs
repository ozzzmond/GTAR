const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const Module = require('node:module')
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options)
  } catch (err) {
    if (parent && parent.filename && request.startsWith('.')) {
      const dir = path.dirname(parent.filename)
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const candidate = path.resolve(dir, request + ext)
        if (fs.existsSync(candidate)) {
          return candidate
        }
      }
    }
    throw err
  }
}

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
    // 1. Path is /stage/present
    assert.equal(parsed.pathname, '/stage/present')
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
    assert.equal(lanUrl, `http://192.168.1.150:5173/stage/present?view=present&session=${sessionId}`)
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
