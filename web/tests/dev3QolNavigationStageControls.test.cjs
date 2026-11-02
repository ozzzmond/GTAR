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
// 2. HEADER PRIMARY TOOLBAR ORDER & REPLACEMENTS
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
// 9. DESKTOP GLOBAL KEYBOARD NAVIGATION SHORTCUTS
// =============================================================================
test('DEV3_KEYBOARD_SHORTCUTS: Alt+1..6 and Alt+0/H navigation shortcuts registered with editable-field exclusion', () => {
  const appSource = readSource(path.join(webDir, 'src/App.tsx'))

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
  const appSource = readSource(path.join(webDir, 'src/App.tsx'))

  assert.ok(appSource.includes('import { TvPresentationModal }'), 'App imports TvPresentationModal')
  assert.ok(appSource.includes('import { stageCast }'), 'App imports stageCast')
  assert.ok(appSource.includes('onOpenCast={handleTogglePresentation}'), 'Header receives onOpenCast')
  assert.ok(appSource.includes('isCastActive={isCastActive}'), 'Header receives isCastActive')
  assert.ok(appSource.includes('<TvPresentationModal'), 'App renders TvPresentationModal')
})
