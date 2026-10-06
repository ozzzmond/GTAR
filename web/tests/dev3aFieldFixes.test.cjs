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

const webDir = path.resolve(__dirname, '..')
const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
const {
  DOCK_SIZE,
  getDefaultDockPosition,
  clampDockPosition,
} = require('../src/components/StageControlDock.tsx')
const {
  createBlankCanonicalSong,
} = require('../src/components/DesktopEditor.tsx')
const { isValidUUID } = require('../src/utils/uuid.ts')

// =============================================================================
// 1. VERSION IDENTITY CONTRACT (v1.0.123-dev.3f)
// =============================================================================
test('DEV3A_VERSION_CONTRACT: Canonical version rolled to 1.0.123-dev.3f across manifests, types, and functions', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.3f', 'GTAR_DEV_VERSION in gtar.ts must be 1.0.123-dev.3f')

  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.123-dev.3f', 'package.json version must be 1.0.123-dev.3f')

  const pkgLockJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  assert.equal(pkgLockJson.version, '1.0.123-dev.3f', 'package-lock.json root must be 1.0.123-dev.3f')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.3f', 'package-lock.json packages[""] must be 1.0.123-dev.3f')

  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(authCore.includes('v1.0.123-dev.3f'), 'authCore.ts must reference v1.0.123-dev.3f')
})

// =============================================================================
// 2. STAGE SCROLL DOCK VISIBLE SIZING & VISUAL BALANCE
// =============================================================================
test('DEV3A_STAGE_DOCK_VISUAL_SIZING: Floating stage dock visibly enlarged with balanced center FAB and chevrons', () => {
  const dockSource = fs.readFileSync(path.join(webDir, 'src/components/StageControlDock.tsx'), 'utf8')

  // Geometry enlarged from 64x200 to 76x236
  assert.equal(DOCK_SIZE.width, 76, 'Dock width enlarged to 76px')
  assert.equal(DOCK_SIZE.height, 236, 'Dock height enlarged to 236px')

  // Visible button faces enlarged from 48x48 (w-12) to 56x56 (w-14)
  assert.ok(dockSource.includes('w-14 h-14 min-w-[56px] min-h-[56px]'), 'Prev and Next button faces visibly enlarged to w-14 h-14 (56px)')

  // Chevron icons substantially enlarged from 24x24 (w-6) to 32x32 (w-8) stroke-[3]
  assert.ok(dockSource.includes('<ChevronUp className="w-8 h-8 stroke-[3]" />'), 'ChevronUp icon substantially enlarged to w-8 h-8 stroke-[3]')
  assert.ok(dockSource.includes('<ChevronDown className="w-8 h-8 stroke-[3]" />'), 'ChevronDown icon substantially enlarged to w-8 h-8 stroke-[3]')

  // Center FAB visibly balanced at 60x60 (w-15) with enlarged play/pause icons
  assert.ok(dockSource.includes('w-15 h-15 min-w-[60px] min-h-[60px]'), 'Center FAB enlarged to w-15 h-15 (60px) for visual balance')
  assert.ok(dockSource.includes('<Pause className="w-6 h-6 fill-current" />'), 'Pause icon enlarged to w-6 h-6')
  assert.ok(dockSource.includes('<Play className="w-6 h-6 fill-current ml-0.5" />'), 'Play icon enlarged to w-6 h-6')

  // Viewport clamping and default placement correctly compute with new 76x236 geometry
  const defaultPos = getDefaultDockPosition({ width: 1024, height: 768 })
  assert.equal(defaultPos.x, 1024 - 76 - 16, 'Default X position respects 76px dock width')
  assert.equal(defaultPos.y, 768 - 236 - 88, 'Default Y position respects 236px dock height')

  const clamped = clampDockPosition({ x: 2000, y: 2000 }, { width: 1024, height: 768 })
  assert.equal(clamped.x, 1024 - 76 - 12, 'Clamped max X respects 76px dock width and 12px margin')
  assert.equal(clamped.y, 768 - 236 - 12, 'Clamped max Y respects 236px dock height and 12px margin')
})

// =============================================================================
// 3. REMOVE DUPLICATE TRASH ACTION FROM MORE MENU
// =============================================================================
test('DEV3A_REMOVE_DUPLICATE_TRASH: Trash Bin (Basurahan) removed from More menu; primary toolbar retained', () => {
  const headerSource = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')

  // More menu section must NOT contain Trash Bin (Basurahan)
  assert.ok(!headerSource.includes('Trash Bin (Basurahan)'), 'Trash Bin (Basurahan) copy removed from More menu')

  // Count occurrences of onViewChange('trash') - must only be in primary toolbar
  const trashNavMatches = headerSource.match(/onViewChange\('trash'\)/g)
  assert.equal(trashNavMatches?.length, 1, "Exactly one onViewChange('trash') call remains in Header")

  // Primary toolbar must retain dedicated Trash button
  assert.ok(headerSource.includes('label={`Trash${deletedSongsCount > 0 ? ` (${deletedSongsCount})` : \'\'} (Alt+6)`}'), 'Dedicated primary Trash button preserved')
  assert.ok(headerSource.includes("isActive={activeView === 'trash'}"), 'Primary Trash button tracks active view')
})

// =============================================================================
// 4. SETLIST HIDE BEHAVIOR: SELECT HIDDEN WITH SETLIST CONTROLS
// =============================================================================
test('DEV3A_SETLIST_HIDE_BEHAVIOR: Select button hidden when setlists are collapsed; restored when shown', () => {
  const songbookSource = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')

  // Select button must be conditionally rendered on !setlistsCollapsed
  assert.ok(
    songbookSource.includes('{!setlistsCollapsed && (\n                    <button\n                      type="button"\n                      data-testid="toggle-setlist-selection-mode"'),
    'Select button must be hidden when setlistsCollapsed is true'
  )

  // toggleSetlists must exit selection mode when collapsing
  assert.ok(
    songbookSource.includes('setIsSetlistSelectionMode(false)'),
    'Exits selection mode when setlists are collapsed'
  )
  assert.ok(
    songbookSource.includes('setSelectedSetlistIds(new Set())'),
    'Clears selected setlist IDs when collapsing'
  )

  // Preserves New Setlist, Manage, and Import buttons
  assert.ok(songbookSource.includes('title="Create new empty gig setlist"'), 'New Setlist button preserved')
  assert.ok(songbookSource.includes('<span>Manage</span>'), 'Manage setlists button preserved')
  assert.ok(songbookSource.includes('title="Import single setlist (.json) into your library"'), 'Import setlist button preserved')
  assert.ok(songbookSource.includes("{setlistsCollapsed ? 'Show' : 'Hide'}"), 'Show/Hide toggle button preserved')
})

// =============================================================================
// 5. NEW BLANK SONG EDITOR ACTION & UNSAVED CHANGES PROTECTION
// =============================================================================
test('DEV3A_NEW_BLANK_SONG_EDITOR_ACTION: New Song icon in toolbar between Insert Section and Paste with unsaved protection', () => {
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')

  // Button exists with accessible attributes and test id
  assert.ok(editorSource.includes('data-testid="editor-new-song-button"'), 'Editor renders New Song button')
  assert.ok(editorSource.includes('aria-label="New Song"'), 'New Song button has accessible aria-label')
  assert.ok(editorSource.includes('title="New Song (blank document)"'), 'New Song button has clear title')

  // Position: between Insert section DropdownPortal and Paste button
  const insertSectionPos = editorSource.indexOf('aria-label="Insert section"')
  const newSongPos = editorSource.indexOf('data-testid="editor-new-song-button"')
  const pastePos = editorSource.indexOf('aria-label="Paste"')

  assert.ok(insertSectionPos < newSongPos, 'New Song button is positioned after Insert Section')
  assert.ok(newSongPos < pastePos, 'New Song button is positioned before Paste')

  // Uses clear document/new-file style icon FilePlus
  assert.ok(editorSource.includes('<FilePlus className="w-3.5 h-3.5" />'), 'Uses FilePlus icon')

  // Helper createBlankCanonicalSong generates valid blank canonical song
  const blankSong = createBlankCanonicalSong()
  assert.equal(blankSong.title, 'New Song')
  assert.equal(blankSong.artist, '')
  assert.equal(blankSong.key, 'G')
  assert.equal(blankSong.bpm, '120')
  assert.equal(blankSong.format, 'CHORD_PRO')
  assert.ok(blankSong.rawContent.includes('{title: New Song}'))
  assert.ok(blankSong.rawContent.includes('[Intro]'))
  assert.ok(blankSong.rawContent.includes('[Verse 1]'))
  assert.ok(blankSong.rawContent.includes('[Chorus]'))
  assert.ok(isValidUUID(blankSong.id), 'Song ID must be valid RFC4122 v4 UUID')

  // Unsaved changes protection: handleNewSong invokes requestNavigation before replacing editor state
  assert.ok(
    editorSource.includes('requestNavigation(() => {\n      const blank = createBlankCanonicalSong()'),
    'handleNewSong protects unsaved changes via requestNavigation'
  )

  // App.tsx handles saving without auto-saving on typing
  const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
  assert.ok(
    appSource.includes('// Do not auto-save unpersisted new blank song to library\n      return false'),
    'App.tsx handleUpdateSong ignores unpersisted new songs from auto-saving'
  )
  assert.ok(
    appSource.includes('const isExisting = songs.some(s => String(s.id) === String(targetId))\n    const nextSongs = isExisting'),
    'App.tsx handleSaveSongFromEditor prepends new songs on explicit save'
  )
})
