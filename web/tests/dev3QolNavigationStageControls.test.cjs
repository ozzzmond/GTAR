const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText, filename
  )
}
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }

const React = require('react')
const webDir = path.resolve(__dirname, '..')
const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
const { DOCK_SIZE } = require('../src/components/StageControlDock.tsx')

// =============================================================================
// 1. VERSION IDENTITY CONTRACT
// =============================================================================
test('DEV3_VERSION_CONTRACT: Canonical version rolled to 1.0.123-dev.3j across manifests and types', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.3j', 'GTAR_DEV_VERSION in gtar.ts must be 1.0.123-dev.3j')

  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.123-dev.3j', 'package.json version must be 1.0.123-dev.3j')

  const pkgLockJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  assert.equal(pkgLockJson.version, '1.0.123-dev.3j', 'package-lock.json root must be 1.0.123-dev.3j')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.3j', 'package-lock.json packages[""] must be 1.0.123-dev.3j')

  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(authCore.includes('v1.0.123-dev.3j'), 'authCore.ts must reference v1.0.123-dev.3j')
})

// =============================================================================
// 2. HEADER PRIMARY TOOLBAR ORDER & REPLACEMENTS
// =============================================================================
test('DEV3_HEADER_TOOLBAR_ORDER: Primary toolbar follows Stage Preview -> Editor -> Band Sync -> Cast -> Theme -> Trash -> More', () => {
  const headerSource = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')
  const tier2Section = headerSource.substring(
    headerSource.indexOf('TIER 2 (Middle Action Bar)'),
    headerSource.indexOf('TIER 3 (Bottom Search Bar)')
  )

  // Stage Preview is first; uses PlaySquare, not Eye
  const stagePreviewIdx = tier2Section.indexOf('label="Stage Preview (Alt+1)"')
  const editorIdx = tier2Section.indexOf('label="Editor (Alt+2)"')
  const bandSyncIdx = tier2Section.indexOf('label="Band Sync (Alt+3)"')
  const castIdx = tier2Section.indexOf('label="Cast (Alt+4)"')
  const themeIdx = tier2Section.indexOf('label="Theme (Alt+5)"')
  const trashIdx = tier2Section.indexOf('Trash')
  const moreIdx = tier2Section.indexOf('label="More"')

  assert.ok(stagePreviewIdx !== -1, 'Stage Preview action must exist')
  assert.ok(editorIdx !== -1, 'Editor action must exist')
  assert.ok(bandSyncIdx !== -1, 'Band Sync action must exist')
  assert.ok(castIdx !== -1, 'Cast action must exist')
  assert.ok(themeIdx !== -1, 'Theme action must exist')
  assert.ok(trashIdx !== -1, 'Trash action must exist')
  assert.ok(moreIdx !== -1, 'More action must exist')

  // Verify strict ordering
  assert.ok(stagePreviewIdx < editorIdx, 'Stage Preview must precede Editor')
  assert.ok(editorIdx < bandSyncIdx, 'Editor must precede Band Sync')
  assert.ok(bandSyncIdx < castIdx, 'Band Sync must precede Cast')
  assert.ok(castIdx < themeIdx, 'Cast must precede Theme')
  assert.ok(themeIdx < trashIdx, 'Theme must precede Trash')
  assert.ok(trashIdx < moreIdx, 'Trash must precede More')

  // Verify Stage Preview uses PlaySquare icon
  assert.ok(tier2Section.includes('icon={PlaySquare}'), 'Stage Preview must use PlaySquare icon')

  // Dedicated Songbook and Setlist buttons removed from primary Tier 2 toolbar
  assert.ok(!tier2Section.includes('label={`Songbook'), 'Dedicated Songbook button removed from primary toolbar')
  assert.ok(!tier2Section.includes('label={`Setlists'), 'Dedicated Setlists button removed from primary toolbar')

  // Home navigation preserved via Logo entry with Alt+0 shortcut hint
  assert.ok(
    headerSource.includes('title="Return to Songbook Library Home (Alt+0)"'),
    'Logo home entry preserved with Alt+0 shortcut hint'
  )
})

// =============================================================================
// 3. WEB SOURCES RELOCATION & MORE MENU ANCHORING
// =============================================================================
test('DEV3_WEB_SOURCES_RELOCATION_AND_MORE_MENU: Web Sources relocated to More menu; More menu uses dynamic viewport-anchored positioning', () => {
  const headerSource = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')

  // Web Sources removed from primary toolbar Tier 2
  const tier2Section = headerSource.substring(
    headerSource.indexOf('TIER 2 (Middle Action Bar)'),
    headerSource.indexOf('TIER 3 (Bottom Search Bar)')
  )
  assert.ok(!tier2Section.includes('label="Web Sources"'), 'Web Sources removed from Tier 2 toolbar')

  // Web Sources added inside More menu
  const moreMenuSection = headerSource.substring(headerSource.indexOf('3-Dots Overflow Menu'))
  assert.ok(moreMenuSection.includes('Web Sources'), 'Web Sources present inside 3-dots overflow menu')
  assert.ok(moreMenuSection.includes('onOpenWebsiteUrlSource()'), 'Web Sources triggers onOpenWebsiteUrlSource in More menu')

  // More menu positioning is dynamic and anchored via moreButtonRef
  assert.ok(headerSource.includes('moreButtonRef = useRef<HTMLButtonElement>(null)'), 'Header defines moreButtonRef')
  assert.ok(headerSource.includes('moreMenuCoords'), 'Header computes dynamic moreMenuCoords')
  assert.ok(headerSource.includes('buttonRef={moreButtonRef}'), 'More button receives buttonRef')
  assert.ok(headerSource.includes('top: `${moreMenuCoords.top}px`'), 'More menu anchored with dynamic top coordinate')
  assert.ok(headerSource.includes('left: `${moreMenuCoords.left}px`'), 'More menu anchored with dynamic left coordinate')
})

// =============================================================================
// 4. STAGE SETTINGS MODAL REDUNDANCY CLEANUP
// =============================================================================
test('DEV3_SETTINGS_CLEANUP: Slogan, Quick Shortcuts, and redundant Local Backup & Restore removed from StageSettingsModal', () => {
  const settingsSource = fs.readFileSync(path.join(webDir, 'src/components/StageSettingsModal.tsx'), 'utf8')

  assert.ok(
    !settingsSource.includes('Offline-First Stage Teleprompter & Chord Companion for Live Musicians'),
    'Slogan must be removed'
  )
  assert.ok(!settingsSource.includes('QUICK SHORTCUTS'), 'Quick Shortcuts section must be removed')
  assert.ok(!settingsSource.includes('LOCAL DATA BACKUP & RESTORE'), 'Local Backup & Restore section must be removed')
})

// =============================================================================
// 5. STAGE VIEW TOP CONTROLS CLEANUP
// =============================================================================
test('DEV3_STAGE_TOP_CONTROLS: Standalone Sync control beside autoscroll removed from StageView', () => {
  const stageViewSource = fs.readFileSync(path.join(webDir, 'src/components/StageView.tsx'), 'utf8')

  // Autoscroll button is retained
  assert.ok(stageViewSource.includes('Stage Top Bar Quick Autoscroll Action Button'), 'Autoscroll action retained')
  // Cast button is retained
  assert.ok(stageViewSource.includes('Cast / Pop-out Screen'), 'Cast popout action retained')

  // The standalone sync button with LEADER / SYNCED beside autoscroll was removed
  const topControlsSlice = stageViewSource.substring(
    stageViewSource.indexOf('Stage Top Bar Quick Autoscroll Action Button'),
    stageViewSource.indexOf('Cast / Pop-out Screen')
  )
  assert.ok(!topControlsSlice.includes('Band Sync Status Indicator'), 'Standalone Sync button beside scroll removed')
  assert.ok(!topControlsSlice.includes('LEADER'), 'LEADER indicator beside scroll removed')
  assert.ok(!topControlsSlice.includes('SYNCED'), 'SYNCED indicator beside scroll removed')
})

// =============================================================================
// 6. STAGE CONTROL DOCK ENLARGED TOUCH TARGETS
// =============================================================================
test('DEV3_STAGE_CONTROL_DOCK_SIZING: Touch targets increased to minimum 48px hit areas with enlarged dock', () => {
  const dockSource = fs.readFileSync(path.join(webDir, 'src/components/StageControlDock.tsx'), 'utf8')

  assert.ok(DOCK_SIZE.width >= 64, 'Dock width enlarged to at least 64px')
  assert.ok(DOCK_SIZE.height >= 200, 'Dock height enlarged to at least 200px')

  // Check prev/next button touch classes: minimum 48x48 (enlarged to 56x56 in DEV.3a)
  assert.ok(dockSource.includes('min-w-[56px] min-h-[56px]') || dockSource.includes('min-w-[48px] min-h-[48px]'), 'Previous/Next buttons provide touch targets')
  // Check center FAB: minimum 52x52 (enlarged to 60x60 in DEV.3a)
  assert.ok(dockSource.includes('min-w-[60px] min-h-[60px]') || dockSource.includes('min-w-[52px] min-h-[52px]'), 'Center FAB provides hit area')
  // Check enlarged chevron stroke
  assert.ok(dockSource.includes('stroke-[3]') || dockSource.includes('stroke-[2.5]'), 'Previous/Next chevrons enlarged')
})

// =============================================================================
// 7. SECTION NAVIGATION PREVIOUS/UP FROM ABSOLUTE BOTTOM
// =============================================================================
test('DEV3_SECTION_NAVIGATION_ABSOLUTE_BOTTOM: Up from absolute bottom navigates reliably without collapsing at maxScroll', () => {
  const stageViewSource = fs.readFileSync(path.join(webDir, 'src/components/StageView.tsx'), 'utf8')

  // handlePrevSection uses raw targetScrollTop unclamped initially to prevent maxScroll collapsing
  assert.ok(
    stageViewSource.includes('const targetScrollTop = Math.round(currentScrollTop + distanceFromTop - headerOffset)'),
    'Calculates unclamped targetScrollTop'
  )
  // Backward iteration looks for preceding target strictly scrolling upward
  assert.ok(
    stageViewSource.includes('clampedPreceding < currentScrollTop - 4'),
    'Checks clampedPreceding is strictly less than currentScrollTop to ensure upward jump from bottom'
  )
  // Down navigation ensures not jumping past end
  assert.ok(
    stageViewSource.includes('currentScrollTop >= maxScroll - 4'),
    'Guards down navigation at bottom boundary'
  )
})

// =============================================================================
// 8. MANAGE SETLIST DIRECT STAGE NAVIGATION
// =============================================================================
test('DEV3_SETLIST_DRAWER_NAVIGATION: Selecting song from SetlistDrawer or Header setlist directly routes to Stage view', () => {
  const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')

  // SetlistDrawer onSelectSongIndex and onSelectSetlistSong route to stage
  const setlistDrawerBlock = appSource.substring(appSource.indexOf('<SetlistDrawer'))
  assert.ok(
    setlistDrawerBlock.includes("handleSelectLibrarySong(idx)\n            setActiveView('stage')") ||
    setlistDrawerBlock.includes("handleSelectLibrarySong(idx)") && setlistDrawerBlock.includes("setActiveView('stage')"),
    'Selecting song in SetlistDrawer activates stage view'
  )
  assert.ok(
    setlistDrawerBlock.includes("handleSelectSetlistSong(setlistId, songIdx)\n            setActiveView('stage')") ||
    setlistDrawerBlock.includes("handleSelectSetlistSong(setlistId, songIdx)") && setlistDrawerBlock.includes("setActiveView('stage')"),
    'Selecting setlist song in SetlistDrawer activates stage view'
  )
})

// =============================================================================
// 9. DESKTOP GLOBAL KEYBOARD NAVIGATION SHORTCUTS
// =============================================================================
test('DEV3_KEYBOARD_SHORTCUTS: Alt+1..6 and Alt+0/H navigation shortcuts registered with editable-field exclusion', () => {
  const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')

  assert.ok(appSource.includes('handleGlobalNavShortcuts'), 'Global navigation shortcuts listener registered')
  assert.ok(appSource.includes("case '1':"), 'Alt+1 navigates to stage')
  assert.ok(appSource.includes("case '2':"), 'Alt+2 navigates to editor')
  assert.ok(appSource.includes("case '3':"), 'Alt+3 opens Band Sync tools')
  assert.ok(appSource.includes("case '4':"), 'Alt+4 toggles Cast presentation')
  assert.ok(appSource.includes("case '5':"), 'Alt+5 opens Theme modal')
  assert.ok(appSource.includes("case '6':"), 'Alt+6 navigates to Trash')
  assert.ok(appSource.includes("case '0':"), 'Alt+0 navigates Home')

  // Editable element guard
  assert.ok(appSource.includes('isEditable'), 'Shortcuts check isEditable helper')
  assert.ok(appSource.includes("tagName === 'input'"), 'Guards input elements')
  assert.ok(appSource.includes("tagName === 'textarea'"), 'Guards textarea elements')
  assert.ok(appSource.includes('el.isContentEditable'), 'Guards contentEditable elements')
})

// =============================================================================
// 10. CAST NAVIGATION IN APP & HEADER
// =============================================================================
test('DEV3_CAST_MAIN_TOOLBAR: Cast exposed as primary action hooked to StageCastEngine session', () => {
  const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')

  assert.ok(appSource.includes('import { TvPresentationModal }'), 'App imports TvPresentationModal')
  assert.ok(appSource.includes('import { stageCast }'), 'App imports stageCast')
  assert.ok(appSource.includes('onOpenCast={handleTogglePresentation}'), 'Header receives onOpenCast')
  assert.ok(appSource.includes('isCastActive={isCastActive}'), 'Header receives isCastActive')
  assert.ok(appSource.includes('<TvPresentationModal'), 'App renders TvPresentationModal')
})
