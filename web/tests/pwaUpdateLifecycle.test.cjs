const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webRoot = path.resolve(__dirname, '..')

test('PWA UI: header, stage settings and app have zero fake manual update controls or simulation modal', () => {
  const headerCode = fs.readFileSync(path.join(webRoot, 'src/components/Header.tsx'), 'utf8')
  const stageSettingsCode = fs.readFileSync(path.join(webRoot, 'src/components/StageSettingsModal.tsx'), 'utf8')
  const appCode = fs.readFileSync(path.join(webRoot, 'src/App.tsx'), 'utf8')

  // Header verification
  assert.equal(headerCode.includes('onCheckForUpdates'), false, 'Header must not accept onCheckForUpdates prop')
  assert.equal(headerCode.includes('isCheckingUpdates'), false, 'Header must not accept isCheckingUpdates prop')
  assert.equal(headerCode.includes('Click to check for updates'), false, 'Header must not contain check for updates button/title')
  assert.equal(headerCode.includes('RefreshCw'), false, 'Header must not import or render update spinner icon')

  // StageSettingsModal verification
  assert.equal(stageSettingsCode.includes('onCheckForUpdates'), false, 'StageSettingsModal must not accept onCheckForUpdates prop')
  assert.equal(stageSettingsCode.includes('Check for Updates'), false, 'StageSettingsModal must not render Check for Updates button')
  assert.equal(stageSettingsCode.includes('RefreshCw'), false, 'StageSettingsModal must not import or render update spinner icon')

  // App verification
  assert.equal(appCode.includes('handleCheckForUpdates'), false, 'App must not contain handleCheckForUpdates simulation')
  assert.equal(appCode.includes('showUpdateSuccessModal'), false, 'App must not contain showUpdateSuccessModal state')
  assert.equal(appCode.includes('isCheckingUpdates'), false, 'App must not contain isCheckingUpdates state')
  assert.equal(appCode.includes("You're Up to Date!"), false, 'App must not render fake Up to Date modal')
})

test('PWA SW: registerSW provides onNeedReload stage guard without unprompted reload', () => {
  const mainCode = fs.readFileSync(path.join(webRoot, 'src/main.tsx'), 'utf8')

  assert.ok(mainCode.includes('onNeedReload()'), 'main.tsx must define onNeedReload in registerSW options')
  assert.ok(mainCode.includes('isStageActive'), 'onNeedReload must guard active stage presence')
  assert.ok(mainCode.includes('__GTAR_STAGE_ACTIVE__'), 'onNeedReload must check __GTAR_STAGE_ACTIVE__')
  assert.equal(mainCode.includes('window.location.reload()'), false, 'onNeedReload must never force unconditional window reload')
})

test('PWA Config: autoUpdate, skipWaiting, clientsClaim, and cleanupOutdatedCaches remain enabled', () => {
  const viteConfig = fs.readFileSync(path.join(webRoot, 'vite.config.ts'), 'utf8')

  assert.ok(viteConfig.includes("registerType: 'autoUpdate'"), 'vite.config.ts must maintain autoUpdate')
  assert.ok(viteConfig.includes('skipWaiting: true'), 'workbox must maintain skipWaiting: true')
  assert.ok(viteConfig.includes('clientsClaim: true'), 'workbox must maintain clientsClaim: true')
  assert.ok(viteConfig.includes('cleanupOutdatedCaches: true'), 'workbox must maintain cleanupOutdatedCaches: true')
  assert.ok(viteConfig.includes("navigateFallback: '/index.html'"), 'workbox must maintain navigateFallback')
})
