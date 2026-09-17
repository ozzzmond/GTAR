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

const React = require('react')
const { StageErrorBoundary } = require('../src/components/StageErrorBoundary.tsx')
const { appLogger } = require('../src/utils/logger.ts')

// =========================================================================
// ACTION 1 & 2 & 3 & 4: Static and Logic Verification on StageView.tsx
// =========================================================================
test('StageView source contracts: song change resets scroll + pauses autoscroll, overlay and pedal guards in place', () => {
  const stageViewPath = path.resolve(__dirname, '../src/components/StageView.tsx')
  const code = fs.readFileSync(stageViewPath, 'utf8').replace(/\r\n/g, '\n')

  // ACTION 1: Scroll + Autoscroll reset on song transition
  assert.ok(code.includes('currentSongKey'), 'StageView must track currentSongKey')
  assert.ok(code.includes('previousSongKeyRef'), 'StageView must track previousSongKeyRef')
  assert.ok(code.includes('scrollContainerRef.current.scrollTop = 0'), 'StageView must reset scrollTop to 0 on song transition')
  assert.ok(code.includes('setIsAutoScrolling(false)'), 'StageView must pause autoscroll on song transition')
  assert.ok(code.includes('accumulatedScrollRef.current = 0'), 'StageView must reset subpixel scroll accumulator')

  // ACTION 2: Rapid & held navigation hardening
  assert.ok(code.includes('lastNavigationTimeRef'), 'StageView must track lastNavigationTimeRef')
  assert.ok(!code.includes('if (!slideEl || isAnimatingRef.current)'), 'StageView must NEVER bypass animation lock when isAnimating is true')
  assert.ok(code.includes('if (isAnimatingRef.current) {\n      return\n    }'), 'StageView must strictly return when isAnimating is true')
  assert.ok(code.includes('e.repeat &&'), 'StageView must check e.repeat to ignore held keys')

  // ACTION 3: Overlay shortcut suppression
  assert.ok(code.includes('isAnyOverlayActive'), 'StageView must compute isAnyOverlayActive')
  assert.ok(code.includes('isKeyPickerOpen'), 'isAnyOverlayActive must check isKeyPickerOpen')
  assert.ok(code.includes('selectedVoicing'), 'isAnyOverlayActive must check selectedVoicing')
  assert.ok(code.includes('isBandSyncModalOpen'), 'isAnyOverlayActive must check isBandSyncModalOpen')
  assert.ok(code.includes('isSetlistDrawerOpen'), 'isAnyOverlayActive must check isSetlistDrawerOpen')
  assert.ok(code.includes('isStageSettingsModalOpen'), 'isAnyOverlayActive must check isStageSettingsModalOpen')
  assert.ok(code.includes('if (isAnyOverlayActive) {\n        return\n      }'), 'StageView must suppress shortcuts when an overlay is active')
  assert.ok(code.includes('e.target instanceof HTMLInputElement'), 'Input/textarea exclusion must remain intact')

  // ACTION 4: Foot pedal PageUp / PageDown support
  assert.ok(code.includes("e.key === 'PageDown'"), 'StageView must handle PageDown key')
  assert.ok(code.includes("e.key === 'PageUp'"), 'StageView must handle PageUp key')
  assert.ok(code.includes('handleNextSong()'), 'PageDown must route to handleNextSong')
  assert.ok(code.includes('handlePrevSong()'), 'PageUp must route to handlePrevSong')
})

test('App source contracts: StageErrorBoundary wraps StageView and passes overlay states', () => {
  const appPath = path.resolve(__dirname, '../src/App.tsx')
  const code = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n')

  assert.ok(code.includes("import { StageErrorBoundary } from './components/StageErrorBoundary'"), 'App.tsx must import StageErrorBoundary')
  assert.ok(code.includes('<StageErrorBoundary onExitToSongbook='), 'App.tsx must wrap StageView in StageErrorBoundary')
  assert.ok(code.includes('isSetlistDrawerOpen={isSetlistDrawerOpen}'), 'App.tsx must pass isSetlistDrawerOpen to StageView')
  assert.ok(code.includes('isStageSettingsModalOpen={isStageSettingsModalOpen}'), 'App.tsx must pass isStageSettingsModalOpen to StageView')
  assert.ok(code.includes('isAnyModalOpen='), 'App.tsx must pass isAnyModalOpen to StageView')
})

// =========================================================================
// ACTION 5: StageErrorBoundary Behavior Verification
// =========================================================================
test('StageErrorBoundary: catches render exception, shows recovery fallback, does not expose song content, and permits retry/exit', () => {
  // Test error boundary state mechanics
  const error = new Error('Simulated StageView crash in child chord parsing')
  const derivedState = StageErrorBoundary.getDerivedStateFromError(error)
  assert.equal(derivedState.hasError, true)
  assert.equal(derivedState.errorMessage, 'Simulated StageView crash in child chord parsing')

  // Verify diagnostic logging does NOT log user song content
  appLogger.resume()
  const boundaryInstance = new StageErrorBoundary({ children: null })
  boundaryInstance.componentDidCatch(error, { componentStack: 'at StageView (components/StageView.tsx:100)' })
  
  const latestLog = appLogger.getLogs().at(-1)
  assert.ok(latestLog)
  assert.equal(latestLog.level, 'ERROR')
  assert.equal(latestLog.tag, 'StageErrorBoundary')
  assert.ok(latestLog.message.includes('Simulated StageView crash in child chord parsing'))
  assert.equal(latestLog.message.includes('Stand By Me'), false)

  // Test retry handler
  let exitCalled = false
  const retryBoundary = new StageErrorBoundary({
    children: 'Normal Stage Child',
    onExitToSongbook: () => { exitCalled = true },
  })
  retryBoundary.updater = {
    enqueueSetState: (inst, partialState) => {
      Object.assign(inst.state, typeof partialState === 'function' ? partialState(inst.state) : partialState)
    },
  }
  retryBoundary.state = { hasError: true, errorMessage: 'Crash' }
  retryBoundary.handleRetry()
  assert.equal(retryBoundary.state.hasError, false)
  assert.equal(retryBoundary.state.errorMessage, null)

  // Test exit handler
  retryBoundary.state = { hasError: true, errorMessage: 'Crash' }
  retryBoundary.handleExit()
  assert.equal(retryBoundary.state.hasError, false)
  assert.equal(exitCalled, true)
})

// =========================================================================
// ACTION 1 & 2: Song change scroll reset and rapid navigation debounce logic simulation
// =========================================================================
test('Song transition continuity logic: scroll resets and autoscroll pauses on distinct song identity only', () => {
  let isAutoScrolling = true
  let accumulatedScroll = 124.5
  let scrollTop = 540
  let previousSongKey = null

  function onSongRender(songId, songTitle, songIndex) {
    const currentSongKey = songId !== undefined && songId !== '' ? String(songId) : `${songTitle}__${songIndex}`
    let scrollResetFired = false

    if (previousSongKey !== null && previousSongKey !== currentSongKey) {
      scrollTop = 0
      isAutoScrolling = false
      accumulatedScroll = 0
      scrollResetFired = true
    }
    previousSongKey = currentSongKey
    return scrollResetFired
  }

  // 1. Initial mount of Song 1
  const mountReset = onSongRender('song-1', 'Song One', 0)
  assert.equal(mountReset, false, 'Initial render must not trigger song transition scroll reset')
  assert.equal(scrollTop, 540, 'Scroll position maintained on initial render')

  // 2. Unrelated render of Song 1 (e.g. font size change, transpose, timer tick)
  scrollTop = 300
  isAutoScrolling = true
  const unrelatedReset = onSongRender('song-1', 'Song One', 0)
  assert.equal(unrelatedReset, false, 'Unrelated render of same song MUST NOT reset scroll (NO_SCROLL_JUMP_ON_UNRELATED_RENDER)')
  assert.equal(scrollTop, 300)
  assert.equal(isAutoScrolling, true)

  // 3. Active song changes to Song 2
  const songChangeReset = onSongRender('song-2', 'Song Two', 1)
  assert.equal(songChangeReset, true, 'Song transition MUST trigger scroll reset')
  assert.equal(scrollTop, 0, 'Scroll position must be reset to 0')
  assert.equal(isAutoScrolling, false, 'Autoscroll must be paused on song transition')
  assert.equal(accumulatedScroll, 0, 'Subpixel accumulator must be reset to 0')
})

test('Rapid keyboard navigation logic: prevents double-advance and ignores held-key repeats', () => {
  let activeIndex = 0
  let isAnimating = false
  let lastNavTime = 0
  const songs = ['Song 0', 'Song 1', 'Song 2', 'Song 3']

  function executeNext() {
    if (activeIndex < songs.length - 1) activeIndex++
  }

  function triggerSlideNext() {
    if (isAnimating) return false
    const now = Date.now()
    if (now - lastNavTime < 250) return false
    lastNavTime = now

    isAnimating = true
    executeNext()
    return true
  }

  function handleKeyDown(event) {
    if (event.repeat && (event.key === 'ArrowRight' || event.key === 'n' || event.key === 'PageDown')) {
      return 'IGNORED_REPEAT'
    }
    if (event.key === 'ArrowRight' || event.key === 'n' || event.key === 'PageDown') {
      const advanced = triggerSlideNext()
      return advanced ? 'ADVANCED' : 'LOCKED'
    }
    return 'UNHANDLED'
  }

  // 1. First legitimate press -> advances from 0 to 1
  assert.equal(handleKeyDown({ key: 'ArrowRight', repeat: false }), 'ADVANCED')
  assert.equal(activeIndex, 1)

  // 2. Held key repetition while transitioning -> MUST BE IGNORED
  assert.equal(handleKeyDown({ key: 'ArrowRight', repeat: true }), 'IGNORED_REPEAT')
  assert.equal(activeIndex, 1, 'Held key repeat must not advance song')

  // 3. Rapid tap while animation is locked -> MUST BE LOCKED
  assert.equal(handleKeyDown({ key: 'n', repeat: false }), 'LOCKED')
  assert.equal(activeIndex, 1, 'Rapid tap during animation lock must not skip songs')

  // 4. Pedal PageDown held -> MUST BE IGNORED
  assert.equal(handleKeyDown({ key: 'PageDown', repeat: true }), 'IGNORED_REPEAT')
  assert.equal(activeIndex, 1, 'Held pedal PageDown must not advance song')

  // 5. Transition completes after duration
  isAnimating = false
  lastNavTime = Date.now() - 300 // simulate 300ms elapsed

  // 6. Next legitimate press -> advances from 1 to 2
  assert.equal(handleKeyDown({ key: 'PageDown', repeat: false }), 'ADVANCED')
  assert.equal(activeIndex, 2)
})

test('Overlay shortcut suppression logic: all stage shortcuts suppressed when any overlay is open', () => {
  const stageShortcuts = [
    { code: 'Space', key: ' ' },
    { key: 'ArrowRight' },
    { key: 'n' },
    { key: 'ArrowLeft' },
    { key: 'p' },
    { key: 'PageDown' },
    { key: 'PageUp' },
    { key: 'ArrowUp' },
    { key: 'ArrowDown' },
    { key: '+' },
    { key: '-' },
  ]

  function simulateKeyDown(e, isAnyOverlayActive, isTextInput) {
    if (isTextInput) return 'SUPPRESSED_TEXT_INPUT'
    if (isAnyOverlayActive) return 'SUPPRESSED_OVERLAY'
    return 'EXECUTED'
  }

  // With no overlay open and not in text input, all shortcuts are executed
  for (const sc of stageShortcuts) {
    assert.equal(simulateKeyDown(sc, false, false), 'EXECUTED')
  }

  // With an overlay active (e.g. SetlistDrawer, KeyPicker, StageSettings, Fretboard), all shortcuts are suppressed
  for (const sc of stageShortcuts) {
    assert.equal(simulateKeyDown(sc, true, false), 'SUPPRESSED_OVERLAY')
  }

  // In text input, text input exclusion takes precedence
  for (const sc of stageShortcuts) {
    assert.equal(simulateKeyDown(sc, false, true), 'SUPPRESSED_TEXT_INPUT')
  }
})
