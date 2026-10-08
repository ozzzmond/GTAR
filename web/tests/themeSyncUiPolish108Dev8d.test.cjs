const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webDir = path.resolve(__dirname, '..')

test('PROD_VERSION_FALLBACK: tag-derived production version retains its fallback', () => {
  const gtarTypes = fs.readFileSync(path.join(webDir, 'src/types/gtar.ts'), 'utf8')
  assert.ok(
    gtarTypes.includes("? __GTAR_PROD_VERSION__ : '1.1.108';"),
    'gtar.ts must preserve GTAR_APP_VERSION as 1.1.108'
  )
})

// 2. PAPER CREAM LIGHT READABILITY & CONTRAST
test('PAPER_CREAM_LIGHT_THEME: color ownership belongs to the shared semantic runtime', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')
  assert.ok(!css.includes('body.theme-paper-light'))
  for (const token of ['--custom-stage-bg', '--custom-card-song-bg', '--custom-uiPrimaryText', '--custom-uiSecondaryText', '--custom-card-selected-bg', '--custom-chrome-filter-bg']) {
    assert.ok(css.includes(`var(${token}`), token)
  }
})

test('PAPER_CREAM_LIGHT_THEME: ThemeModal preset definition aligns with readable tokens', () => {
  const themeModal = fs.readFileSync(path.join(webDir, 'src/components/ThemeModal.tsx'), 'utf8')

  assert.ok(themeModal.includes("id: 'paper-light'"), 'ThemeModal contains paper-light preset')
  assert.ok(themeModal.includes("name: 'Paper Cream Light'"), 'Preset name is Paper Cream Light')
  assert.ok(themeModal.includes("surfaceHex: '#FFFDF7'"), 'Preset surfaceHex is #FFFDF7')
  assert.ok(themeModal.includes("textHex: '#172033'"), 'Preset textHex is #172033')
  assert.ok(themeModal.includes("bgHex: '#f4ecd8'"), 'Preset bgHex is #f4ecd8')
})

// 3. CLOUD SYNC MANUAL ACTION SAFETY
test('CLOUD_SYNC_MANUAL_ACTION_SAFETY: Upload to Cloud button removed from normal UI, Sync Now & Download preserved', () => {
  const modalContent = fs.readFileSync(path.join(webDir, 'src/components/CloudSyncModal.tsx'), 'utf8')

  // PROOF OF REMOVAL: The user-facing manual button is removed from normal actions
  const normalActionsBlock = modalContent.slice(
    modalContent.indexOf('{/* Sync Actions */}'),
    modalContent.indexOf('{/* Footer */}')
  )
  assert.ok(
    !normalActionsBlock.includes('Upload to Cloud'),
    'Normal sync actions must NOT contain "Upload to Cloud" button'
  )

  // PROOF OF RETENTION: Underlying upload capability and force upload handler preserved
  assert.ok(
    modalContent.includes('const handleForceUpload = async () => {'),
    'Underlying handleForceUpload handler must be preserved'
  )
  assert.ok(
    modalContent.includes('handleResolveConflict(\'upload\')'),
    'Underlying conflict upload resolution must be preserved'
  )

  // PROOF OF UX HIERARCHY: Sync Now is primary, Download from Cloud is secondary recovery action
  assert.ok(normalActionsBlock.includes('data-testid="sync-now-button"'), 'Sync Now has explicit test ID')
  assert.ok(normalActionsBlock.includes('Sync Now'), 'Sync Now button is retained as primary action')
  assert.ok(normalActionsBlock.includes('data-testid="download-from-cloud-button"'), 'Download from Cloud has explicit test ID')
  assert.ok(normalActionsBlock.includes('Download from Cloud'), 'Download from Cloud button is retained as secondary recovery action')

  // Secondary styling check: Download button has subtle background
  assert.ok(normalActionsBlock.includes('bg-app-base'), 'Download from Cloud retains secondary card surface')

  // Critical metadata & safety items preserved
  assert.ok(modalContent.includes('Last Synced'), 'Last Synced metadata retained')
  assert.ok(modalContent.includes('Fingerprint'), 'Fingerprint metadata retained')
  assert.ok(modalContent.includes('In Sync'), 'In Sync status indicator retained')
  assert.ok(modalContent.includes('Offline edits preserved safely'), 'Offline edits footer notice retained')
})

// 4. HEADER CLOUD SYNC STATUS INDICATOR
test('HEADER_SYNC_INDICATOR: Header cloud sync control provides state-aware health indicators and accessibility', () => {
  const headerContent = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')

  // PROOF OF STATE TRACKING: cloudSyncStatus and isCloudSyncProcessing
  assert.ok(headerContent.includes('cloudSyncStatus'), 'Header tracks cloudSyncStatus')
  assert.ok(headerContent.includes('isCloudSyncProcessing'), 'Header tracks isCloudSyncProcessing')

  // PROOF OF BUTTON TEST ID & ATTRIBUTES
  assert.ok(headerContent.includes('data-testid="header-cloud-sync-button"'), 'Header sync button has test ID')
  assert.ok(headerContent.includes('data-sync-state='), 'Header sync button exposes data-sync-state attribute')

  // PROOF OF EXPECTED LABELS: Cloud Sync, Syncing…, In Sync, Sync Issue
  assert.ok(headerContent.includes("'Cloud Sync'"), 'Includes idle/default label "Cloud Sync"')
  assert.ok(headerContent.includes("'Syncing\\u2026'") || headerContent.includes("'Syncing…'"), 'Includes active syncing label "Syncing…"')
  assert.ok(headerContent.includes("'In Sync'"), 'Includes verified in-sync label "In Sync"')
  assert.ok(headerContent.includes("'Sync Issue'"), 'Includes conflict/error label "Sync Issue"')

  // PROOF OF ICONS
  assert.ok(headerContent.includes('SyncIcon = Cloud'), 'Maps idle/unknown to Cloud icon')
  assert.ok(headerContent.includes('SyncIcon = RotateCw'), 'Maps syncing to RotateCw icon')
  assert.ok(headerContent.includes('SyncIcon = Check'), 'Maps in-sync to Check icon')
  assert.ok(headerContent.includes('SyncIcon = AlertTriangle'), 'Maps conflict/error to AlertTriangle icon')

  // PROOF OF ACCESSIBILITY & CLICK BEHAVIOR
  assert.ok(headerContent.includes('title={syncLabel}'), 'Button has dynamic accessible title')
  assert.ok(headerContent.includes('aria-label={syncLabel}'), 'Button has dynamic aria-label')
  assert.ok(headerContent.includes('onClick={() => setShowCloudSyncModal(true)}'), 'Click behavior is unchanged and opens CloudSyncModal')

  // PROOF OF COMPACTNESS & PRESERVED IDENTITY
  assert.ok(!headerContent.includes('large-status-panel'), 'No bloated status panel added')
  assert.ok(headerContent.includes('onSyncStateChange='), 'Wires onSyncStateChange to CloudSyncModal')
})

test('HEADER_SYNC_INDICATOR: reduced motion is respected for syncing animation', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')
  assert.ok(css.includes('.header-sync-spin'), 'Defines header-sync-spin class')
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'Includes prefers-reduced-motion media query')
  assert.ok(css.includes('animation: none !important;'), 'Disables animation when prefers-reduced-motion: reduce')
})
