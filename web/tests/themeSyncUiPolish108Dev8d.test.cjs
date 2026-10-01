const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webDir = path.resolve(__dirname, '..')

// 1. VERSION ALIGNMENT
test('VERSION_ALIGNMENT: dev checkpoint rolled to v1.0.108-dev.8d and prod untouched', () => {
  const gtarTypes = fs.readFileSync(path.join(webDir, 'src/types/gtar.ts'), 'utf8')
  assert.ok(
    gtarTypes.includes("export const GTAR_DEV_VERSION = '1.0.108-dev.8d';"),
    'gtar.ts must define GTAR_DEV_VERSION as 1.0.108-dev.8d'
  )
  assert.ok(
    gtarTypes.includes("export const GTAR_APP_VERSION = '1.1.108';"),
    'gtar.ts must preserve GTAR_APP_VERSION as 1.1.108'
  )

  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.108-dev.8d', 'package.json must be 1.0.108-dev.8d')

  const pkgLockJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  assert.equal(pkgLockJson.version, '1.0.108-dev.8d', 'package-lock.json root must be 1.0.108-dev.8d')
  assert.equal(pkgLockJson.packages[''].version, '1.0.108-dev.8d', 'package-lock.json packages[""] must be 1.0.108-dev.8d')

  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(authCore.includes('v1.0.108-dev.8d'), 'authCore.ts must reference v1.0.108-dev.8d')
})

// 2. PAPER CREAM LIGHT READABILITY & CONTRAST
test('PAPER_CREAM_LIGHT_THEME: readable warm light surfaces, dark slate text, and proper tokens in index.css', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')

  // Theme presence and warm cream background
  assert.ok(css.includes('body.theme-paper-light {'), 'Must define body.theme-paper-light')
  assert.ok(css.includes('background-color: #f4ecd8 !important;'), 'Preserves warm cream page identity (#f4ecd8)')

  // Normal card surfaces: warm near-white / very light cream (#FFFDF7)
  assert.ok(css.includes('background-color: #FFFDF7 !important;'), 'Card surfaces use warm near-white #FFFDF7')

  // Primary text: deep slate (#172033)
  assert.ok(css.includes('color: #172033 !important;'), 'Primary text uses deep slate #172033')

  // Secondary text: muted readable slate (#64748B)
  assert.ok(css.includes('color: #64748B !important;'), 'Secondary text uses muted readable slate #64748B')

  // Selected active state: soft teal tint (#eef7f6) + teal border (#2AA198)
  assert.ok(css.includes('background-color: #eef7f6 !important;'), 'Selected active state has soft teal tint')
  assert.ok(css.includes('border-color: #2AA198 !important;'), 'Selected active state has teal border')

  // Filter toolbar light theme surface and controls
  assert.ok(css.includes('background-color: #ede4cf !important;'), 'Filter toolbar surface is light-theme appropriate')

  // GTAR teal + burnt amber identity preserved
  assert.ok(css.includes('#b45309'), 'Burnt amber chord color preserved in paper-light')
  assert.ok(css.includes('#0f766e'), 'Teal tab line color preserved in paper-light')

  // Other themes untouched
  assert.ok(css.includes('body.theme-amber-stage'), 'Preserves amber-stage theme')
  assert.ok(css.includes('body.theme-oled-black'), 'Preserves oled-black theme')
  assert.ok(css.includes('body.theme-custom'), 'Preserves custom theme')
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
  assert.ok(normalActionsBlock.includes('bg-[#002B36]'), 'Download from Cloud retains secondary card surface')

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
