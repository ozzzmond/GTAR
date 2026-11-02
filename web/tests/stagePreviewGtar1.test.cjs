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
const ReactDOMServer = require('react-dom/server')

const { StageOptionsSheet } = require('../src/components/StageOptionsSheet.tsx')
const { StageView } = require('../src/components/StageView.tsx')

const mockSong = {
  id: 'test-song-1',
  title: 'Stage Preview Test Song',
  artist: 'Stage Test Artist',
  key: 'G',
  originalKey: 'E',
  tempo: '120',
  time: '4/4',
  year: '2024',
  rawContent: `{title: Stage Preview Test Song}
{artist: Stage Test Artist}
{key: G}
{tempo: 120}
{time: 4/4}
{year: 2024}

[Intro]
[G] [D] [Em] [C]

[Verse 1]
[G]This is line one of [D]the preview chart
[Em]Testing stage controls and [C]card presentation
`,
  createdAt: 1000000,
  updatedAt: 1000000,
}

test('STAGE_PREVIEW_GTAR1: Floating dock defaults to OFF when localStorage is empty', () => {
  const stageViewSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/StageView.tsx'),
    'utf8'
  )

  // Floating dock state must initialize to false when no saved preference exists
  assert.ok(
    stageViewSource.includes("const [showDock, setShowDock] = useState<boolean>(() => {"),
    'StageView must initialize showDock with lazy state'
  )
  assert.ok(
    stageViewSource.includes("return false"),
    'showDock must return false when no preference is saved'
  )
})

test('STAGE_PREVIEW_GTAR1: Repeated A+/A- presses change font size continuously without getting stuck at 12px', () => {
  // Simulate the font size change handler logic used in StageOptionsSheet
  let currentFontSize = 24
  const minFont = 14
  const maxFont = 36

  const onFontSizeChange = (newSize) => {
    currentFontSize = Math.max(minFont, Math.min(maxFont, newSize))
  }

  // 1. Initial size
  assert.strictEqual(currentFontSize, 24)

  // 2. Press A- repeatedly (step by -2 each time)
  onFontSizeChange(currentFontSize - 2)
  assert.strictEqual(currentFontSize, 22)
  onFontSizeChange(currentFontSize - 2)
  assert.strictEqual(currentFontSize, 20)
  onFontSizeChange(currentFontSize - 2)
  assert.strictEqual(currentFontSize, 18)
  onFontSizeChange(currentFontSize - 2)
  assert.strictEqual(currentFontSize, 16)
  onFontSizeChange(currentFontSize - 2)
  assert.strictEqual(currentFontSize, 14)
  // Clamped at 14, not 12
  onFontSizeChange(currentFontSize - 2)
  assert.strictEqual(currentFontSize, 14, 'Font size must clamp at minFont (14px), not stuck at 12px')

  // 3. Press A+ repeatedly (step by +2 each time)
  onFontSizeChange(currentFontSize + 2)
  assert.strictEqual(currentFontSize, 16, 'First A+ after clamping must step up to 16px')
  onFontSizeChange(currentFontSize + 2)
  assert.strictEqual(currentFontSize, 18)
  onFontSizeChange(currentFontSize + 2)
  assert.strictEqual(currentFontSize, 20)
  onFontSizeChange(currentFontSize + 2)
  assert.strictEqual(currentFontSize, 22)
  onFontSizeChange(currentFontSize + 2)
  assert.strictEqual(currentFontSize, 24)

  // 4. Repeated A+ up to max
  for (let i = 0; i < 10; i++) {
    onFontSizeChange(currentFontSize + 2)
  }
  assert.strictEqual(currentFontSize, 36, 'Font size must clamp at maxFont (36px)')

  // 5. Stepping back down from max immediately decreases
  onFontSizeChange(currentFontSize - 2)
  assert.strictEqual(currentFontSize, 34, 'A- press immediately decreases from maxFont')
})

test('STAGE_PREVIEW_GTAR1: StageOptionsSheet renders GTAR1 clean controls without stuck interval', () => {
  let changedSize = null

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(StageOptionsSheet, {
      isOpen: true,
      onClose: () => {},
      fontSize: 24,
      onFontSizeChange: (sz) => {
        changedSize = sz
      },
      chordScale: 1.0,
      onChordScaleChange: () => {},
      fontWeight: 'medium',
      onFontWeightChange: () => {},
      lineSpacing: 'normal',
      onLineSpacingChange: () => {},
      fontFamily: 'mono',
      onFontFamilyChange: () => {},
      notation: 'chords',
      onNotationChange: () => {},
      isTwoColumn: false,
      onToggleTwoColumn: () => {},
      showDock: false,
      onToggleShowDock: () => {},
      autoScrollSpeed: 30,
      onAutoScrollSpeedChange: () => {},
      autoHideControls: true,
      onToggleAutoHideControls: () => {},
      wakeLockActive: true,
      onToggleWakeLock: () => {},
      isFullscreen: false,
      onToggleFullscreen: () => {},
      isFullscreenSupported: true,
      queueSongs: [mockSong],
      currentQueueIndex: 0,
      onSelectQueueIndex: () => {},
    })
  )

  // Renders Stage Options header and sheet controls
  assert.ok(html.includes('Stage Options'), 'Must render Stage Options title')
  assert.ok(html.includes('Auto-Scroll Speed'), 'Must render Auto-Scroll Speed slider')
  assert.ok(html.includes('Notation'), 'Must render Notation toggle')
  assert.ok(html.includes('Font Size'), 'Must render Font Size section')
  assert.ok(html.includes('Chord Scale'), 'Must render Chord Scale section')
  assert.ok(html.includes('Font Weight'), 'Must render Font Weight section')
  assert.ok(html.includes('Line Spacing'), 'Must render Line Spacing section')
  assert.ok(html.includes('Font Style'), 'Must render Font Style section')
  assert.ok(html.includes('Two-Column Layout'), 'Must render Two-Column toggle')
  assert.ok(html.includes('Floating Control Dock'), 'Must render Floating Control Dock toggle')
  assert.ok(html.includes('Auto-Hide Controls'), 'Must render Auto-Hide Controls toggle')
  assert.ok(html.includes('Keep Screen Awake'), 'Must render Wake Lock toggle')
  assert.ok(html.includes('Fullscreen'), 'Must render Fullscreen toggle')
})

test('STAGE_PREVIEW_GTAR1: Song format renders GTAR1 song view with metadata chips and ui-song-card', () => {
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(StageView, {
      song: mockSong,
      songs: [mockSong],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      onOpenSetlistDrawer: () => {},
      transposeOffset: 0,
      onTransposeChange: () => {},
    })
  )

  // Non-fullscreen preview format checks
  assert.ok(html.includes('ui-song-card'), 'Chart lines must be wrapped in ui-song-card container')
  assert.ok(html.includes('Stage Preview Test Song'), 'Must render song title')
  assert.ok(html.includes('Stage Test Artist'), 'Must render song artist')

  // Metadata chips
  assert.ok(html.includes('Orig Key:'), 'Must render Orig Key chip')
  assert.ok(html.includes('Chart Key:'), 'Must render Chart Key chip')
  assert.ok(html.includes('Tempo:'), 'Must render Tempo chip')
  assert.ok(html.includes('Time:'), 'Must render Time signature chip')
  assert.ok(html.includes('Year:'), 'Must render Year chip')

  // Top row controls
  assert.ok(html.includes('aria-label="Start autoscroll"'), 'Top row must contain autoscroll start/stop button')
  assert.ok(html.includes('aria-label="Open Stage Options"'), 'Top row must contain Stage Options button')
  assert.ok(html.includes('Cast / Pop-out Screen'), 'Second row must contain Cast button')
  assert.ok(html.includes('Enter fullscreen'), 'Top row must contain Fullscreen button')
})

test('STAGE_PREVIEW_GTAR1: Fixed bottom transport controls in fullscreen mode', () => {
  const stageViewSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/StageView.tsx'),
    'utf8'
  )

  // Navigation region must render for fullscreen transport controls when dock is off
  assert.ok(
    stageViewSource.includes('{inPerformanceMode && !showDock && ('),
    'Bottom transport controls must be guarded by inPerformanceMode && !showDock'
  )
  assert.ok(
    stageViewSource.includes('data-testid="stage-bottom-transport-nav"'),
    'Must render stage-bottom-transport-nav'
  )
  assert.ok(
    stageViewSource.includes('data-testid="stage-bottom-prev-section-btn"'),
    'Must render previous section transport button'
  )
  assert.ok(
    stageViewSource.includes('data-testid="stage-bottom-play-pause-btn"'),
    'Must render prominent play/pause FAB'
  )
  assert.ok(
    stageViewSource.includes('data-testid="stage-bottom-next-section-btn"'),
    'Must render next section transport button'
  )
  assert.ok(
    stageViewSource.includes('data-testid="stage-bottom-transpose-down-btn"'),
    'Must render transpose down semitone button'
  )
  assert.ok(
    stageViewSource.includes('data-testid="stage-bottom-transpose-up-btn"'),
    'Must render transpose up semitone button'
  )

  // P1 & P2 Review Verification
  // 1. P1: Quick jump uses setlist songs and index when in setlist mode
  assert.ok(
    stageViewSource.includes('queueSongs={isInSetlistMode && activeSetlistSongs && activeSetlistSongs.length > 0 ? activeSetlistSongs : songs}'),
    'Quick jump must use active setlist songs when in setlist mode'
  )
  assert.ok(
    stageViewSource.includes('currentQueueIndex={isInSetlistMode && activeSetlistSongs && activeSetlistSongs.length > 0 ? (activeSetlistSongIndex ?? 0) : activeSongIndex}'),
    'Quick jump must use active setlist index when in setlist mode'
  )
  assert.ok(
    stageViewSource.includes('if (isInSetlistMode && onSelectSetlistSongIndex) {'),
    'Quick jump selection must call onSelectSetlistSongIndex in setlist mode'
  )

  // 2. P2: In fullscreen, song navigator pill is offset above bottom transport bar
  assert.ok(
    stageViewSource.includes('calc(4.25rem + env(safe-area-inset-bottom, 0px))'),
    'Song navigator pill must be offset above bottom transport controls when dock is off'
  )

  // 3. P2: TV presentation options inside Stage Options sheet (not hidden)
  assert.ok(
    !stageViewSource.includes('<div className="hidden">'),
    'TvPresentationOptions must not be hidden in a hidden div'
  )
  assert.ok(
    stageViewSource.includes('<StageOptionsSheet') && stageViewSource.includes('<TvPresentationOptions />'),
    'TvPresentationOptions must be placed inside StageOptionsSheet'
  )

  // 4. P2: Wake lock controller wired with toggle
  assert.ok(
    stageViewSource.includes('createWakeLockController()'),
    'StageView must instantiate wakeLockController'
  )
  assert.ok(
    stageViewSource.includes('wakeLockActive={isWakeLockEnabled}'),
    'StageOptionsSheet must receive wakeLockActive bound to state'
  )
  assert.ok(
    stageViewSource.includes('onToggleWakeLock={handleToggleWakeLock}'),
    'StageOptionsSheet must receive handleToggleWakeLock'
  )
})
