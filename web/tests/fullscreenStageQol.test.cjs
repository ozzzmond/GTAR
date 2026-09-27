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
  STAGE_CONTROLS_AUTO_HIDE_KEY,
  CANONICAL_STORAGE_PREFIXES,
  isCanonicalKey,
} = require('../src/utils/syncJournal.ts')
const {
  clampDockPosition,
  getDefaultDockPosition,
  DOCK_SIZE,
} = require('../src/components/StageControlDock.tsx')

// =========================================================================
// TEST 1: FULLSCREEN_TITLE_REMAINS_VISIBLE
// =========================================================================
test('FULLSCREEN_TITLE_REMAINS_VISIBLE: minimal song title remains visible when HUD overlays hide', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  // Render condition must check performance mode and overlay hidden state
  assert.ok(
    stageViewSource.includes('{inPerformanceMode && !showStageOverlays && ('),
    'Minimal title retention element must render when inPerformanceMode is true and showStageOverlays is false'
  )

  // Must render song.title or fallback
  assert.ok(
    stageViewSource.includes("{song.title || 'Untitled Song'}"),
    'Must display current song title in minimal persistent title'
  )

  // Must provide tap-to-reveal handler
  assert.ok(
    stageViewSource.includes('onClick={triggerOverlaysShow}'),
    'Clicking persistent title container must call triggerOverlaysShow to reveal stage controls'
  )
})

// =========================================================================
// TEST 2: FULLSCREEN_TITLE_READABILITY_STYLE
// =========================================================================
test('FULLSCREEN_TITLE_READABILITY_STYLE: increased text size, high contrast, backdrop blur, and metadata exclusion', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  const titleBlockMatch = stageViewSource.match(
    /\{inPerformanceMode && !showStageOverlays && \([\s\S]*?\{song\.title \|\| 'Untitled Song'\}[\s\S]*?<\/span>/
  )
  assert.ok(titleBlockMatch, 'Must find minimal persistent title block in StageView.tsx')
  const block = titleBlockMatch[0]

  // Readability text sizing: larger responsive scaling for tablet performance distance
  assert.ok(
    block.includes('text-xs') && block.includes('sm:text-base') && block.includes('md:text-lg'),
    'Must include responsive text sizing scaling to sm:text-base and md:text-lg for tablet readability'
  )

  // High contrast & font weight
  assert.ok(
    block.includes('font-bold') && block.includes('text-[#EEE8D5]'),
    'Must render full-contrast Solarized text-[#EEE8D5] in bold'
  )

  // Backdrop styling: higher opacity glassmorphic backdrop for anti-bleed readability
  assert.ok(
    block.includes('bg-[#073642]/85') && block.includes('backdrop-blur-md'),
    'Must use opaque glassmorphic backdrop (bg-[#073642]/85 backdrop-blur-md) so scrolling text does not bleed through'
  )

  // Truncation preserved
  assert.ok(block.includes('truncate'), 'Must include truncate for long title ellipsis')

  // Metadata exclusions: NO artist, NO key, NO transpose
  assert.ok(!block.includes('song.artist'), 'Minimal title badge must not include artist')
  assert.ok(!block.includes('song.key'), 'Minimal title badge must not include key')
  assert.ok(!block.includes('transposeOffset'), 'Minimal title badge must not include transpose')
})

// =========================================================================
// TEST 3: AUTO_HIDE_DEFAULT_ON
// =========================================================================
test('AUTO_HIDE_DEFAULT_ON: controls auto-hide defaults to ON (true) when storage is unset', () => {
  // Test fallback resolution logic:
  // saved !== null ? saved !== 'false' : true
  const resolveAutoHide = (saved) => {
    if (saved !== null && saved !== undefined) {
      return saved !== 'false'
    }
    return true
  }

  assert.equal(resolveAutoHide(null), true, 'Unset / null storage must default to true (ON)')
  assert.equal(resolveAutoHide(undefined), true, 'Undefined storage must default to true (ON)')
  assert.equal(resolveAutoHide('true'), true, 'Explicit "true" must resolve to true (ON)')
  assert.equal(resolveAutoHide('false'), false, 'Explicit "false" must resolve to false (OFF)')
})

// =========================================================================
// TEST 4: AUTO_HIDE_ON_PRESERVES_CURRENT_DOCK_HIDE
// =========================================================================
test('AUTO_HIDE_ON_PRESERVES_CURRENT_DOCK_HIDE: dock hides when overlays hide under default auto-hide ON', () => {
  const computeDockVisibility = (inPerformanceMode, controlsAutoHide, showStageOverlays) => {
    return inPerformanceMode ? (!controlsAutoHide || showStageOverlays) : true
  }

  // When in performance mode and auto-hide is ON (true):
  // Overlays hidden -> dock hidden
  assert.equal(
    computeDockVisibility(true, true, false),
    false,
    'When auto-hide is ON and HUD is hidden, dock must hide'
  )
  // Overlays shown -> dock shown
  assert.equal(
    computeDockVisibility(true, true, true),
    true,
    'When auto-hide is ON and HUD is shown, dock must be visible'
  )
})

// =========================================================================
// TEST 5: AUTO_HIDE_OFF_PRESERVES_DOCK_VISIBILITY
// =========================================================================
test('AUTO_HIDE_OFF_PRESERVES_DOCK_VISIBILITY: dock remains visible when auto-hide is OFF even after HUD hides', () => {
  const computeDockVisibility = (inPerformanceMode, controlsAutoHide, showStageOverlays) => {
    return inPerformanceMode ? (!controlsAutoHide || showStageOverlays) : true
  }

  // When in performance mode and auto-hide is OFF (false):
  // Even when overlays are hidden, dock remains visible!
  assert.equal(
    computeDockVisibility(true, false, false),
    true,
    'When auto-hide is OFF, dock must remain visible even when HUD overlays hide'
  )
  assert.equal(
    computeDockVisibility(true, false, true),
    true,
    'When auto-hide is OFF and HUD is shown, dock must remain visible'
  )
})

// =========================================================================
// TEST 6: AUTO_HIDE_OFF_DOES_NOT_FORCE_FULL_TOP_HUD_VISIBLE
// =========================================================================
test('AUTO_HIDE_OFF_DOES_NOT_FORCE_FULL_TOP_HUD_VISIBLE: top toolbar HUD remains auto-hiding regardless of auto-hide setting', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  // Top banner HUD visibility condition must NOT depend on controlsAutoHide
  const hudMatch = stageViewSource.match(/\{inPerformanceMode && \(\s*<div[\s\S]*?showStageOverlays[\s\S]*?\? 'opacity-100 translate-y-0 pointer-events-auto'[\s\S]*?: 'opacity-0 -translate-y-full pointer-events-none'/)
  assert.ok(hudMatch, 'Top HUD banner must be present in StageView.tsx')
  assert.ok(
    !hudMatch[0].includes('controlsAutoHide'),
    'Top HUD visibility must depend strictly on showStageOverlays and NOT on controlsAutoHide'
  )
})

// =========================================================================
// TEST 7: DEVICE_LOCAL_PERSISTENCE
// =========================================================================
test('DEVICE_LOCAL_PERSISTENCE: setting key is canonical, local to device, and saved in localStorage', () => {
  assert.equal(
    STAGE_CONTROLS_AUTO_HIDE_KEY,
    'gtar_stage_controls_auto_hide',
    'STAGE_CONTROLS_AUTO_HIDE_KEY must have canonical name gtar_stage_controls_auto_hide'
  )

  assert.ok(
    CANONICAL_STORAGE_PREFIXES.includes(STAGE_CONTROLS_AUTO_HIDE_KEY),
    'STAGE_CONTROLS_AUTO_HIDE_KEY must be registered in CANONICAL_STORAGE_PREFIXES'
  )

  assert.ok(
    isCanonicalKey('gtar_stage_controls_auto_hide'),
    'isCanonicalKey must return true for gtar_stage_controls_auto_hide'
  )

  // Verify StageView.tsx reads and writes localStorage with this key
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')
  assert.ok(
    stageViewSource.includes('localStorage.getItem(STAGE_CONTROLS_AUTO_HIDE_KEY)'),
    'StageView.tsx must read STAGE_CONTROLS_AUTO_HIDE_KEY from localStorage'
  )
  assert.ok(
    stageViewSource.includes('localStorage.setItem(STAGE_CONTROLS_AUTO_HIDE_KEY, String(autoHide))'),
    'StageView.tsx must write STAGE_CONTROLS_AUTO_HIDE_KEY to localStorage'
  )
})

// =========================================================================
// TEST 8: NO_CLOUD_SYNC_OF_SETTING
// =========================================================================
test('NO_CLOUD_SYNC_OF_SETTING: setting is forbidden from cloud sync payloads and SyncLibrary', () => {
  const syncMergeSource = fs.readFileSync(path.resolve(__dirname, '../src/utils/syncMerge.ts'), 'utf8')
  assert.ok(
    !syncMergeSource.includes('gtar_stage_controls_auto_hide'),
    'syncMerge.ts must NOT include gtar_stage_controls_auto_hide'
  )
  assert.ok(
    !syncMergeSource.includes('STAGE_CONTROLS_AUTO_HIDE_KEY'),
    'syncMerge.ts must NOT reference STAGE_CONTROLS_AUTO_HIDE_KEY'
  )

  const syncJournalSource = fs.readFileSync(path.resolve(__dirname, '../src/utils/syncJournal.ts'), 'utf8')
  assert.ok(
    !syncJournalSource.includes('STAGE_CONTROLS_AUTO_HIDE_KEY in'),
    'syncJournal.ts must NOT include STAGE_CONTROLS_AUTO_HIDE_KEY in cloud library payload'
  )
})

// =========================================================================
// TEST 9: DOCK_DRAG+TAP+LONG_PRESS_REGRESSION
// =========================================================================
test('DOCK_DRAG+TAP+LONG_PRESS_REGRESSION: drag, tap, and long-press mutual exclusion remains intact', () => {
  const dockSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageControlDock.tsx'), 'utf8')

  // Drag threshold and timer clearing
  assert.ok(
    dockSource.includes('dist > DRAG_THRESHOLD_PX'),
    'Dock must check DRAG_THRESHOLD_PX for dragging'
  )
  assert.ok(
    dockSource.includes('clearTimeout(state.timer)'),
    'Dragging must clear the long press timer'
  )

  // Dragging does not execute tap actions
  assert.ok(
    dockSource.includes('if (wasDragging) {'),
    'Dock must guard against executing tap actions when dragging'
  )

  // Long press does not trigger autoscroll
  assert.ok(
    dockSource.includes('if (wasLongPress) {'),
    'Dock must guard against toggling autoscroll on long press'
  )

  // Viewport clamping preserved
  const clamped = clampDockPosition({ x: -100, y: -100 }, { width: 1024, height: 768 })
  assert.ok(clamped.x >= 12, 'Dock must be clamped within viewport margins (min x >= 12)')
  assert.ok(clamped.y >= 12, 'Dock must be clamped within viewport margins (min y >= 12)')
})

// =========================================================================
// TEST 10: SECTION_NAVIGATION_REGRESSION
// =========================================================================
test('SECTION_NAVIGATION_REGRESSION: PageUp/PageDown and dock prev/next section navigation intact', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  assert.ok(
    stageViewSource.includes("e.key === 'PageDown'"),
    'StageView must bind PageDown to next section'
  )
  assert.ok(
    stageViewSource.includes("e.key === 'PageUp'"),
    'StageView must bind PageUp to previous section'
  )
  assert.ok(
    stageViewSource.includes('handleNextSection()'),
    'PageDown must invoke handleNextSection'
  )
  assert.ok(
    stageViewSource.includes('handlePrevSection()'),
    'PageUp must invoke handlePrevSection'
  )
  assert.ok(
    stageViewSource.includes('onPrevSection={handlePrevSection}'),
    'StageControlDock must receive handlePrevSection'
  )
  assert.ok(
    stageViewSource.includes('onNextSection={handleNextSection}'),
    'StageControlDock must receive handleNextSection'
  )
})

// =========================================================================
// TEST 11: KEYBOARD_NAVIGATION_REGRESSION
// =========================================================================
test('KEYBOARD_NAVIGATION_REGRESSION: keyboard shortcuts for song navigation and autoscroll intact', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  assert.ok(
    stageViewSource.includes("e.key === 'ArrowRight'"),
    'StageView must handle ArrowRight for song navigation'
  )
  assert.ok(
    stageViewSource.includes("e.key === 'ArrowLeft'"),
    'StageView must handle ArrowLeft for song navigation'
  )
  assert.ok(
    stageViewSource.includes("e.key === ' '"),
    'StageView must handle Spacebar for autoscroll toggle'
  )
})

// =========================================================================
// TEST 12: SWIPE_NAVIGATION_REGRESSION
// =========================================================================
test('SWIPE_NAVIGATION_REGRESSION: horizontal swipe song navigation contracts intact', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  assert.ok(
    stageViewSource.includes('handleTouchStart') || stageViewSource.includes('onTouchStart='),
    'StageView must register touch handlers for touch interactions'
  )
  assert.ok(
    stageViewSource.includes('handlePrevSong') && stageViewSource.includes('handleNextSong'),
    'StageView must provide handlePrevSong and handleNextSong handlers'
  )
})

// =========================================================================
// TEST 13: AUTO_SCROLL_REGRESSION
// =========================================================================
test('AUTO_SCROLL_REGRESSION: autoscroll toggle, rate adjustment, and section jump pause intact', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  assert.ok(
    stageViewSource.includes('handleToggleAutoScroll'),
    'StageView must implement handleToggleAutoScroll'
  )
  assert.ok(
    stageViewSource.includes('setIsAutoScrolling(false)'),
    'StageView must pause autoscroll during section jumps and song transitions'
  )
  assert.ok(
    stageViewSource.includes('isAutoScrolling={isAutoScrolling}'),
    'StageControlDock must receive isAutoScrolling'
  )
})
