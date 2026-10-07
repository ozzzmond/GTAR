const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webDir = path.resolve(__dirname, '..')

test('UI_COPY_CLEANUP: CloudSyncModal removes technical jargon and redundant sync copy', () => {
  const modalContent = fs.readFileSync(path.join(webDir, 'src/components/CloudSyncModal.tsx'), 'utf8')

  // Proves removals
  assert.ok(!modalContent.includes('D1 SQLite'), 'CloudSyncModal must not contain "D1 SQLite"')
  assert.ok(!modalContent.includes('Server-authoritative cloud sync & multi-device backup'), 'CloudSyncModal must not contain "Server-authoritative cloud sync & multi-device backup"')
  assert.ok(!modalContent.includes('Cloud Revision'), 'CloudSyncModal must not contain "Cloud Revision"')
  assert.ok(!modalContent.includes('Songbook is in sync with cloud.'), 'CloudSyncModal must not contain "Songbook is in sync with cloud."')

  // Proves retentions
  assert.ok(modalContent.includes('In Sync'), 'CloudSyncModal must retain "In Sync"')
  assert.ok(modalContent.includes('Last Synced'), 'CloudSyncModal must retain "Last Synced"')
  assert.ok(modalContent.includes('Fingerprint'), 'CloudSyncModal must retain "Fingerprint"')
  assert.ok(modalContent.includes('Sync Now'), 'CloudSyncModal must retain "Sync Now"')
  assert.ok(modalContent.includes('handleForceUpload'), 'CloudSyncModal must retain underlying upload capability')
  assert.ok(modalContent.includes('Download from Cloud'), 'CloudSyncModal must retain "Download from Cloud"')
  assert.ok(modalContent.includes('Offline edits preserved safely'), 'CloudSyncModal must retain "Offline edits preserved safely"')
  assert.ok(modalContent.includes('session?.user?.email'), 'CloudSyncModal must retain user/account identity block')
})

test('UI_COPY_CLEANUP: SongbookHomeView removes redundant Stage View instruction', () => {
  const homeViewContent = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')

  // Proves removal
  assert.ok(!homeViewContent.includes('Click any song to launch Stage View'), 'SongbookHomeView must not contain "Click any song to launch Stage View"')

  // Proves retentions
  assert.ok(homeViewContent.includes('Songs Library'), 'SongbookHomeView must retain Songs Library title')
  assert.ok(homeViewContent.includes('filteredIndexedSongs.length'), 'SongbookHomeView must retain song count')
})

test('VERSION_ALIGNMENT: dev checkpoint rolled to v1.0.123-dev.4b and prod untouched', () => {
  const gtarTypes = fs.readFileSync(path.join(webDir, 'src/types/gtar.ts'), 'utf8')
  assert.ok(gtarTypes.includes("export const GTAR_DEV_VERSION = '1.0.123-dev.4b';"), 'gtar.ts must define GTAR_DEV_VERSION as 1.0.123-dev.4b')
  assert.ok(gtarTypes.includes("? __GTAR_PROD_VERSION__ : '1.1.108';"), 'gtar.ts must preserve GTAR_APP_VERSION as 1.1.108')

  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.123-dev.4b', 'package.json must be 1.0.123-dev.4b')

  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(authCore.includes('v1.0.123-dev.4b'), 'authCore.ts must reference v1.0.123-dev.4b')
})
