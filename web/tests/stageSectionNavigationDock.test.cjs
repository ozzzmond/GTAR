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

const { parseGtarSong } = require('../src/utils/songParser.ts')
const {
  clampDockPosition,
  getDefaultDockPosition,
  readPersistedDockPosition,
  persistDockPosition,
  DOCK_SIZE,
} = require('../src/components/StageControlDock.tsx')
const { STAGE_DOCK_POSITION_KEY, isCanonicalKey } = require('../src/utils/syncJournal.ts')

// =========================================================================
// TEST 1: SECTION_PREVIOUS_NEXT_DOCUMENT_ORDER & MODEL
// =========================================================================
test('SECTION_PREVIOUS_NEXT_DOCUMENT_ORDER: structural sections parse in document order', () => {
  const songContent = `
[Intro]
G C G D

[Verse 1]
G                 C
I hear the train a comin'
G                 D
It's rollin' round the bend

[Chorus]
C               G
Cause I'm stuck in Folsom Prison
D               G
And time keeps draggin' on

[Verse 2]
G                 C
When I was just a baby
G                 D
My mama told me, son

[Outro]
G C G D G
`
  const parsed = parseGtarSong(songContent, 0)
  const sections = parsed.lines.filter((l) => l.type === 'SECTION_HEADER')

  assert.equal(sections.length, 5, 'Must parse exactly 5 structural sections')
  assert.equal(sections[0].title, 'Intro')
  assert.equal(sections[1].title, 'Verse 1')
  assert.equal(sections[2].title, 'Chorus')
  assert.equal(sections[3].title, 'Verse 2')
  assert.equal(sections[4].title, 'Outro')
})

// =========================================================================
// TEST 2: TO_CHORUS_NOT_NAVIGABLE & INLINE_BRACKETS
// =========================================================================
test('TO_CHORUS_NOT_NAVIGABLE: inline bracketed annotations [to Chorus] are not SECTION_HEADER targets', () => {
  const songWithAnnotations = `
[Verse 1]
G                 C
Sing a little song [to Chorus] and keep moving

[Chorus]
C               G
Here is the real chorus
`
  const parsed = parseGtarSong(songWithAnnotations, 0)
  const sections = parsed.lines.filter((l) => l.type === 'SECTION_HEADER')

  assert.equal(sections.length, 2, 'Only structural sections must be parsed as SECTION_HEADER')
  assert.equal(sections[0].title, 'Verse 1')
  assert.equal(sections[1].title, 'Chorus')

  const nonSections = parsed.lines.filter(
    (l) => l.type !== 'SECTION_HEADER' && JSON.stringify(l).includes('to Chorus')
  )
  assert.ok(nonSections.length > 0, '[to Chorus] must remain in lyric or chord content without becoming a section header')
})

// =========================================================================
// TEST 3: ZERO_SECTION_BEHAVIOR
// =========================================================================
test('ZERO_SECTION_BEHAVIOR: song with 0 sections cleanly sets canPrev/canNext false and disables controls', () => {
  const songWithoutSections = `
G                 C
Just some plain chords and lyrics
D                 G
Without any bracketed section headers
`
  const parsed = parseGtarSong(songWithoutSections, 0)
  const sections = parsed.lines.filter((l) => l.type === 'SECTION_HEADER')

  assert.equal(sections.length, 0, 'No section headers parsed')

  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')
  assert.ok(
    stageViewSource.includes('canPrevSection={sectionHeaders.length > 0}'),
    'canPrevSection must be disabled when sectionHeaders is empty'
  )
  assert.ok(
    stageViewSource.includes('canNextSection={sectionHeaders.length > 0}'),
    'canNextSection must be disabled when sectionHeaders is empty'
  )
})

// =========================================================================
// TEST 4: VIEWPORT_BASED_SECTION_RESOLUTION & TWO_COLUMN_RULE
// =========================================================================
test('VIEWPORT_BASED_SECTION_RESOLUTION: StageView queries actual DOM viewport positions and computes targets', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  assert.ok(
    stageViewSource.includes('container.querySelectorAll'),
    'Must query rendered DOM elements from scroll container'
  )
  assert.ok(
    stageViewSource.includes('[data-stage-section="true"]'),
    'Must query elements by data-stage-section="true"'
  )
  assert.ok(
    stageViewSource.includes('elRect.top - containerRect.top'),
    'Must resolve relative distance from current viewport'
  )
  assert.ok(
    stageViewSource.includes('currentScrollTop + distanceFromTop - headerOffset'),
    'Must calculate target scroll top accounting for current scroll and active header offset'
  )
  assert.ok(
    stageViewSource.includes('targets.filter((s) => s.targetScrollTop <= currentScrollTop + 12)'),
    'Must identify sections at or above current viewport position'
  )
  assert.ok(
    stageViewSource.includes('targets.find((s) => s.targetScrollTop > currentScrollTop + 12)'),
    'Must find next section ahead of current viewport position'
  )
})

// =========================================================================
// TEST 5: AUTO_SCROLL_REGRESSION & SECTION_JUMP_WHILE_AUTO_SCROLL_ACTIVE
// =========================================================================
test('SECTION_JUMP_WHILE_AUTO_SCROLL_ACTIVE: section jump pauses autoscroll and syncs subpixel accumulator', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8').replace(/\r\n/g, '\n')

  // Both handlePrevSection and handleNextSection must pause autoscroll and resync accumulator
  assert.ok(
    stageViewSource.includes('accumulatedScrollRef.current = targetTop\n    setIsAutoScrolling(false)'),
    'Must resync accumulatedScrollRef and pause autoscroll on section jump'
  )
  assert.ok(
    stageViewSource.includes("container.scrollTo({ top: targetTop, behavior: 'smooth' })"),
    'Must perform smooth programmatic scroll jump'
  )
})

// =========================================================================
// TEST 6: DOCK_VIEWPORT_CLAMP & RESIZE_ROTATION_RECOVERY
// =========================================================================
test('DOCK_VIEWPORT_CLAMP: clampDockPosition confines dock within reachable viewport margins', () => {
  const viewport = { width: 400, height: 800 }

  // Extreme offscreen negative
  const clampedNeg = clampDockPosition({ x: -100, y: -200 }, viewport)
  assert.equal(clampedNeg.x, 12, 'Must clamp to min left margin')
  assert.equal(clampedNeg.y, 12, 'Must clamp to min top margin')

  // Extreme offscreen positive
  const clampedPos = clampDockPosition({ x: 9999, y: 9999 }, viewport)
  const expectedMaxX = 400 - DOCK_SIZE.width - 12
  const expectedMaxY = 800 - DOCK_SIZE.height - 12
  assert.equal(clampedPos.x, expectedMaxX, 'Must clamp to reachable right edge')
  assert.equal(clampedPos.y, expectedMaxY, 'Must clamp to reachable bottom edge')

  // Normal valid position
  const valid = clampDockPosition({ x: 100, y: 200 }, viewport)
  assert.equal(valid.x, 100)
  assert.equal(valid.y, 200)

  // Recovery when rotating from landscape (800x400) to portrait (400x800)
  const landscapePos = { x: 700, y: 300 }
  const portraitViewport = { width: 400, height: 800 }
  const reclamped = clampDockPosition(landscapePos, portraitViewport)
  assert.ok(reclamped.x <= portraitViewport.width - DOCK_SIZE.width - 12, 'Reclamped X must fit in portrait')
  assert.equal(reclamped.y, 300, 'Y remains valid within portrait bounds')
})

// =========================================================================
// TEST 7: LOCAL_POSITION_PERSISTENCE & RECOVERY
// =========================================================================
test('LOCAL_POSITION_PERSISTENCE: reads, writes, and validates gtar_stage_dock_pos without cloud sync', () => {
  const mockStorage = new Map()
  const storage = {
    getItem: (k) => mockStorage.get(k) ?? null,
    setItem: (k, v) => mockStorage.set(k, v),
  }

  // Initial read when empty returns safe default
  const viewport = { width: 1024, height: 768 }
  const defaultPos = readPersistedDockPosition(storage, viewport)
  assert.equal(defaultPos.x, 1024 - DOCK_SIZE.width - 16)
  assert.equal(defaultPos.y, 768 - DOCK_SIZE.height - 88)

  // Persisting custom position
  persistDockPosition({ x: 250, y: 350 }, storage)
  assert.ok(mockStorage.has(STAGE_DOCK_POSITION_KEY), 'Key must match STAGE_DOCK_POSITION_KEY')

  // Read back
  const readBack = readPersistedDockPosition(storage, viewport)
  assert.equal(readBack.x, 250)
  assert.equal(readBack.y, 350)

  // Corrupted storage returns safe default
  mockStorage.set(STAGE_DOCK_POSITION_KEY, 'corrupted_not_json{{{')
  const fallback = readPersistedDockPosition(storage, viewport)
  assert.equal(fallback.x, defaultPos.x)
  assert.equal(fallback.y, defaultPos.y)

  // Verify key is recognized as canonical to protect against storage pruning
  assert.equal(isCanonicalKey(STAGE_DOCK_POSITION_KEY), true, 'Dock position key must be in CANONICAL_STORAGE_PREFIXES')
})

// =========================================================================
// TEST 8: TAP_VS_LONG_PRESS_VS_DRAG_GESTURE_GUARDS
// =========================================================================
test('TAP_VS_LONG_PRESS_VS_DRAG_GESTURE_GUARDS: StageControlDock enforces mutual exclusion between tap, long-press, and drag', () => {
  const dockSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageControlDock.tsx'), 'utf8').replace(/\r\n/g, '\n')

  // Thresholds
  assert.ok(dockSource.includes('DRAG_THRESHOLD_PX = 8'), 'Drag threshold must be defined')
  assert.ok(dockSource.includes('LONG_PRESS_MS = 500'), 'Long press duration must be defined')

  // Drag cancels long press
  assert.ok(
    dockSource.includes('if (!state.isDragging && dist > DRAG_THRESHOLD_PX) {\n      state.isDragging = true\n      if (state.timer) {\n        clearTimeout(state.timer)\n        state.timer = null\n      }'),
    'Drag must immediately clear long press timer'
  )

  // Drag must NOT toggle autoscroll or open options
  assert.ok(
    dockSource.includes('if (wasDragging) {\n      // Commit clamped position to device storage'),
    'Dragging must only persist position and return before executing tap actions'
  )

  // Long press must NOT toggle autoscroll
  assert.ok(
    dockSource.includes('if (wasLongPress) {\n      // Long press already opened stage options; do NOT toggle autoscroll\n      return\n    }'),
    'Long press must return without triggering onToggleAutoScroll'
  )

  // Short tap toggles autoscroll
  assert.ok(
    dockSource.includes("if (target === 'autoscroll') {\n      onToggleAutoScroll()"),
    'Short tap must execute onToggleAutoScroll'
  )
})

// =========================================================================
// TEST 9: FULLSCREEN_TITLE_VISIBLE_AFTER_OVERLAY_AUTO_HIDE & LONG_TITLE_TRUNCATION
// =========================================================================
test('FULLSCREEN_TITLE_VISIBLE_AFTER_OVERLAY_AUTO_HIDE: minimal single-line title persists with ellipsis truncation', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  // Condition: inPerformanceMode && !showStageOverlays
  assert.ok(
    stageViewSource.includes('{inPerformanceMode && !showStageOverlays && ('),
    'Minimal title retention element must render when inPerformanceMode and overlays hide'
  )

  // Title only, no artist, key, or transpose in the retained badge
  const titleBlockMatch = stageViewSource.match(/\{inPerformanceMode && !showStageOverlays && \([\s\S]*?\{song\.title \|\| 'Untitled Song'\}[\s\S]*?<\/span>/)
  assert.ok(titleBlockMatch, 'Must render song title inside retained header')
  assert.ok(!titleBlockMatch[0].includes('song.artist'), 'Minimal title badge must exclude artist')
  assert.ok(!titleBlockMatch[0].includes('transposeOffset'), 'Minimal title badge must exclude transpose')

  // Truncation & safe area
  assert.ok(titleBlockMatch[0].includes('truncate'), 'Must use truncate for long title ellipsis')
  assert.ok(stageViewSource.includes('env(safe-area-inset-top'), 'Must respect safe-area-inset-top')
})

// =========================================================================
// TEST 10: FLOATING_UI_CONTAINS_ONLY_PREVIOUS_AUTOSCROLL_NEXT
// =========================================================================
test('FLOATING_UI_CONTAINS_ONLY_PREVIOUS_AUTOSCROLL_NEXT: floating dock contains only 3 controls, permanent options button removed', () => {
  const dockSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageControlDock.tsx'), 'utf8')

  // Dock contains Prev, Autoscroll, Next
  assert.ok(dockSource.includes('aria-label="Jump to previous section"'), 'Dock must contain previous section button')
  assert.ok(dockSource.includes('aria-label="Jump to next section"'), 'Dock must contain next section button')
  assert.ok(dockSource.includes('Pause autoscroll'), 'Dock must contain autoscroll button')

  // Floating dock does NOT contain permanent options button
  assert.ok(!dockSource.includes('aria-label="Open stage options"'), 'Permanent stage options button must be removed from floating dock')
  assert.ok(!dockSource.includes('MoreHorizontal'), 'MoreHorizontal icon must be removed from floating dock')
})

// =========================================================================
// TEST 11: EXISTING_STAGE_CONTINUITY_REGRESSION
// =========================================================================
test('EXISTING_STAGE_CONTINUITY_REGRESSION: PageUp/PageDown section shortcuts, Left/Right song navigation, Spacebar, Transpose, and Setlist continuity intact', () => {
  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')

  // Repurposed PageUp / PageDown for structural section navigation
  assert.ok(stageViewSource.includes("e.key === 'PageDown'"), 'PageDown shortcut preserved')
  assert.ok(stageViewSource.includes("e.key === 'PageUp'"), 'PageUp shortcut preserved')
  assert.ok(stageViewSource.includes('handleNextSection()'), 'handleNextSection preserved for PageDown')
  assert.ok(stageViewSource.includes('handlePrevSection()'), 'handlePrevSection preserved for PageUp')

  // ArrowLeft / ArrowRight song navigation preserved
  assert.ok(stageViewSource.includes("e.key === 'ArrowRight'"), 'ArrowRight song navigation preserved')
  assert.ok(stageViewSource.includes("e.key === 'ArrowLeft'"), 'ArrowLeft song navigation preserved')
  assert.ok(stageViewSource.includes('handleNextSong()'), 'handleNextSong preserved')
  assert.ok(stageViewSource.includes('handlePrevSong()'), 'handlePrevSong preserved')

  // Spacebar autoscroll
  assert.ok(stageViewSource.includes("e.code === 'Space'"), 'Spacebar shortcut preserved')

  // 108-dev.1g Transpose stepper
  assert.ok(stageViewSource.includes('onTransposeChange(transposeOffset - 1)'), 'Transpose down preserved')
  assert.ok(stageViewSource.includes('onTransposeChange(transposeOffset + 1)'), 'Transpose up preserved')

  // Setlist drawer & pill
  assert.ok(stageViewSource.includes('onOpenSetlistDrawer()'), 'Setlist drawer action preserved')
  assert.ok(stageViewSource.includes('TvPresentationModal'), 'TV Stage Cast modal preserved')
})
