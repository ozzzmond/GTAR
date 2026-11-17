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

// #562 allows exactly one update control: "Check for updates" in About, backed by utils/pwaUpdate.ts.
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [path.relative(webRoot, full).split(path.sep).join('/')] : []
  })
}
// Whole-line comments are not controls.
const filesMatching = pattern => sourceFiles(path.join(webRoot, 'src'))
  .filter(file => pattern.test(fs.readFileSync(path.join(webRoot, file), 'utf8').replace(/^\s*\/\/.*$/gm, ''))).sort()

test('PWA UI: the only update control is "Check for updates" in About', () => {
  assert.deepEqual(filesMatching(/check\s+for\s+updates/i), ['src/components/AboutModal.tsx'], 'update control copy outside About')
  assert.deepEqual(filesMatching(/checkForUpdates/i), ['src/components/AboutModal.tsx', 'src/utils/pwaUpdate.ts'], 'update check wired outside About')
  assert.deepEqual(filesMatching(/from\s+['"][^'"]*\/pwaUpdate['"]/), ['src/components/AboutModal.tsx', 'src/main.tsx'], 'pwaUpdate imported outside About and main.tsx')

  const aboutCode = fs.readFileSync(path.join(webRoot, 'src/components/AboutModal.tsx'), 'utf8')
  assert.equal(aboutCode.split('Check for updates').length, 2, 'About renders one Check for updates control')
  assert.equal(aboutCode.split('checkForUpdates(').length, 2, 'About runs the check from one place')

  const mainCode = fs.readFileSync(path.join(webRoot, 'src/main.tsx'), 'utf8')
  assert.equal(mainCode.includes('checkForUpdates'), false, 'main.tsx must not run the manual check')
})

test('PWA update: the one page reload is user-started and Stage-guarded', () => {
  assert.deepEqual(filesMatching(/location\s*\.\s*reload/), ['src/utils/pwaUpdate.ts'], 'page reload outside utils/pwaUpdate.ts')
  const updateCode = fs.readFileSync(path.join(webRoot, 'src/utils/pwaUpdate.ts'), 'utf8')
  assert.equal(updateCode.split('location.reload').length, 2, 'pwaUpdate.ts reloads from one place')
  assert.ok(
    updateCode.includes("if ((deps.stageActive ?? isStageActive)()) return result('next-launch')\n    ;(deps.reload ?? (() => window.location.reload()))()"),
    'the reload must sit directly behind the Stage guard',
  )
  for (const check of ["window.location.pathname.includes('/stage')", "window.location.search.includes('view=present')", "window.location.hash.includes('present')", '__GTAR_STAGE_ACTIVE__']) {
    assert.ok(updateCode.includes(check), `isStageActive must keep the ${check} check`)
  }
  assert.ok(updateCode.includes('await registration.update()'), 'the check must ask the worker to update')
  assert.ok(updateCode.includes("{ cache: 'no-store', redirect: 'manual' }"), 'release.json must bypass caches and never follow a redirect')
  assert.ok(updateCode.includes('`/release.json?check=${now()}`'), 'release.json needs a cache-busting query: older workers precache it')
})

test('PWA update: the update path never clears caches, unregisters the worker or touches stored data', () => {
  for (const file of ['src/utils/pwaUpdate.ts', 'src/components/AboutModal.tsx']) {
    const code = fs.readFileSync(path.join(webRoot, file), 'utf8')
    for (const forbidden of [/\bcaches\s*\./, /\bCacheStorage\b/, /\.\s*unregister\b/, /indexedDB/i, /\bidb\b/i, /localStorage/, /sessionStorage/, /\.clear\s*\(/, /\.delete\s*\(/]) {
      assert.equal(forbidden.test(code), false, `${file} must not match ${forbidden}`)
    }
  }
  const imports = fs.readFileSync(path.join(webRoot, 'src/utils/pwaUpdate.ts'), 'utf8').match(/^import .*$/gm)
  assert.deepEqual(imports, ["import { GTAR_APP_VERSION } from '../types/gtar'"], 'pwaUpdate.ts must not pull in storage modules')
})

test('PWA SW: registerSW provides onNeedReload stage guard without unprompted reload', () => {
  const mainCode = fs.readFileSync(path.join(webRoot, 'src/main.tsx'), 'utf8')

  assert.ok(mainCode.includes('onNeedReload()'), 'main.tsx must define onNeedReload in registerSW options')
  assert.ok(mainCode.includes('isStageActive'), 'onNeedReload must guard active stage presence')
  // #562: the Stage checks moved unchanged to utils/pwaUpdate.ts so About reuses them; main.tsx calls them.
  assert.ok(mainCode.includes("import { isStageActive } from './utils/pwaUpdate'"), 'main.tsx must use the shared Stage guard')
  assert.match(mainCode, /onNeedReload\(\) \{\s*(?:\/\/[^\n]*\s*)*if \(isStageActive\(\)\) \{\s*return\s*\}/, 'onNeedReload must return first while Stage is active')
  assert.ok(fs.readFileSync(path.join(webRoot, 'src/utils/pwaUpdate.ts'), 'utf8').includes('__GTAR_STAGE_ACTIVE__'), 'the shared Stage guard must check __GTAR_STAGE_ACTIVE__')
  assert.equal(mainCode.includes('window.location.reload()'), false, 'onNeedReload must never force unconditional window reload')
  assert.equal(/location\s*\.\s*reload/.test(mainCode), false, 'main.tsx must not reload the page in any form')
})

test('PWA Config: autoUpdate, skipWaiting, clientsClaim, and cleanupOutdatedCaches remain enabled', () => {
  const viteConfig = fs.readFileSync(path.join(webRoot, 'vite.config.ts'), 'utf8')

  assert.ok(viteConfig.includes("registerType: 'autoUpdate'"), 'vite.config.ts must maintain autoUpdate')
  assert.ok(viteConfig.includes('skipWaiting: true'), 'workbox must maintain skipWaiting: true')
  assert.ok(viteConfig.includes('clientsClaim: true'), 'workbox must maintain clientsClaim: true')
  assert.ok(viteConfig.includes('cleanupOutdatedCaches: true'), 'workbox must maintain cleanupOutdatedCaches: true')
  assert.ok(viteConfig.includes("navigateFallback: '/index.html'"), 'workbox must maintain navigateFallback')
})
