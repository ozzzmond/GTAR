const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { readSource } = require('./helpers/sourceText.cjs')
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
const { DOCK_SIZE } = require('../src/components/StageControlDock.tsx')

// =============================================================================
// 2. HEADER UPPERBOX & STAGE VIEW ORDER (#333, #359, #434)
// =============================================================================
test('DEV3_HEADER_TOOLBAR_ORDER: Header cloud button retired, Settings gear present per #434; Stage follows Back -> Editor -> Band Sync', () => {
  const headerSource = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')
  const stageSource = fs.readFileSync(path.join(webDir, 'src/components/StageView.tsx'), 'utf8')

  // #434: Header cloud button retired, settings gear replaces profile avatar
  assert.equal(headerSource.indexOf('<SyncStatusPill'), -1, 'SyncStatusPill removed from Header')
  assert.ok(headerSource.includes('data-testid="header-settings"'), 'Settings gear button must exist in Header')

  // #359: Theme, Trash, More removed from top header toolbar
  assert.equal(headerSource.indexOf('ToolbarIconButton'), -1, 'ToolbarIconButton removed from header toolbar')
  assert.equal(headerSource.indexOf('label="Theme"'), -1, 'Theme removed from header toolbar')
  assert.equal(headerSource.indexOf('label="More"'), -1, 'More removed from header toolbar')

  // Relocated actions in Settings popover (#434, #503)
  assert.ok(headerSource.includes('data-testid="settings-theme-button"'), 'Theme in Settings popover')
  assert.ok(headerSource.includes('data-testid="header-advanced-tools"'), 'Advanced Tools in header toolbar per #503')
  assert.ok(!headerSource.includes('data-testid="profile-web-sources"'), 'Web Sources row removed per #503')
  assert.ok(headerSource.includes('data-testid="profile-trash-button"'), 'Trash in Settings popover (<md)')

  // Verify Stage Box ordering
  const backIdx = stageSource.indexOf('aria-label="Back"')
  const editorIdx = stageSource.indexOf('aria-label="Editor"')
  const bandSyncIdx = stageSource.indexOf('aria-label="Band Sync"')

  assert.ok(backIdx !== -1, 'Back action must exist in StageView')
  assert.ok(editorIdx !== -1, 'Editor action must exist in StageView')
  assert.ok(bandSyncIdx !== -1, 'Band Sync action must exist in StageView')
  assert.ok(backIdx < editorIdx, 'Back must precede Editor')
  assert.ok(editorIdx < bandSyncIdx, 'Editor must precede Band Sync')

  // Home navigation preserved via the logo entry (#224: hover tooltip removed)
  assert.ok(headerSource.includes('onClick={onNavigateHome}'), 'Logo home entry preserved')
  assert.ok(!headerSource.includes('title="Return to Songbook Library Home (Alt+0)"'), '#224: no hover tooltip')
})

// =============================================================================
// 3. WEB SOURCES REMOVAL (#503) & PROFILE POPOVER RETIREMENT
// =============================================================================
test('DEV3_WEB_SOURCES_REMOVAL_AND_ADVANCED_TOOLS: Web Sources row removed per #503; More menu retired per #359', () => {
  const headerSource = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')

  // Web Sources not in primary header toolbar (#332)
  assert.ok(!headerSource.includes('label="Web Sources"'), 'Web Sources not in primary header')

  // More menu retired (#359)
  assert.ok(!headerSource.includes('3-Dots Overflow Menu'), 'More menu retired')
  assert.ok(!headerSource.includes('moreButtonRef'), 'moreButtonRef retired')

  // Web Sources removed from popover per #503
  assert.ok(!headerSource.includes('data-testid="profile-web-sources"'), 'Web Sources row removed')
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
    stageViewSource.includes('const targetScrollTop = stageSectionScrollTop(currentScrollTop, elRect.top, containerRect.top, headerOffset)'),
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
// 9. DESKTOP GLOBAL KEYBOARD NAVIGATION SHORTCUTS (removed by owner ruling)
// =============================================================================
test('DEV3_KEYBOARD_SHORTCUTS_REMOVED: no global Alt+ navigation shortcuts remain in App', () => {
  const appSource = readSource(path.join(webDir, 'src/App.tsx'))

  assert.ok(!appSource.includes('handleGlobalNavShortcuts'), 'Global navigation shortcuts listener removed')
  assert.ok(!appSource.includes('Global Navigation Shortcuts'), 'Shortcut comment removed')
  for (const key of ['0', '1', '2', '3', '4', '5', '6']) {
    assert.ok(!appSource.includes(`case '${key}':`), `Alt+${key} shortcut case removed`)
  }
  assert.ok(!appSource.includes("case 'h':"), 'Alt+H shortcut case removed')
})

// =============================================================================
// 10. CAST NAVIGATION IN APP & HEADER
// =============================================================================
test('DEV3_CAST_MAIN_TOOLBAR: Cast exposed as primary action hooked to StageCastEngine session', () => {
  const appSource = readSource(path.join(webDir, 'src/App.tsx'))

  assert.ok(appSource.includes('import { TvPresentationModal }'), 'App imports TvPresentationModal')
  assert.ok(appSource.includes('import { stageCast }'), 'App imports stageCast')
  assert.ok(appSource.includes('onOpenCast={handleTogglePresentation}'), 'Header receives onOpenCast')
  assert.ok(appSource.includes('isCastActive={isCastActive}'), 'Header receives isCastActive')
  assert.ok(appSource.includes('<TvPresentationModal'), 'App renders TvPresentationModal')
})
