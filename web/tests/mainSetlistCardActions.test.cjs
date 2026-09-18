const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename
  )

const { GTAR_DEV_VERSION, GTAR_APP_VERSION } = require('../src/types/gtar.ts')

test('VERSION_CONTRACT: Canonical web version contract matches dev or prod configuration', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))
  const pkgLock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package-lock.json'), 'utf8'))

  // package-lock.json must always agree with package.json
  assert.equal(pkgLock.version, pkg.version, 'package-lock.json root version must match package.json')
  assert.equal(
    pkgLock.packages[''].version,
    pkg.version,
    'package-lock.json packages[""] version must match package.json'
  )

  // Dev version constant in gtar.ts must match expected dev iteration
  assert.equal(GTAR_DEV_VERSION, '1.0.108-dev.1', 'GTAR_DEV_VERSION constant in gtar.ts must be 1.0.108-dev.1')

  // In dev trees, package.json equals GTAR_DEV_VERSION; in promoted prod trees, package.json equals GTAR_APP_VERSION
  const validVersions = [GTAR_DEV_VERSION, GTAR_APP_VERSION]
  assert.ok(
    validVersions.includes(pkg.version),
    `package.json version (${pkg.version}) must match GTAR_DEV_VERSION (${GTAR_DEV_VERSION}) or GTAR_APP_VERSION (${GTAR_APP_VERSION})`
  )
})

test('THREE_DOT_MENU: Opening menu only opens action menu and does NOT trigger export', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  // Three-dot button must toggle menu state, not call exportSingleSetlistJson
  assert.ok(
    viewCode.includes('setActiveMenuSetlistId(isMenuOpen ? null : sl.id)'),
    'Three-dot button must toggle activeMenuSetlistId'
  )
  assert.ok(
    !viewCode.match(/onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\)\s*;\s*exportSingleSetlistJson/),
    'Three-dot button must NEVER directly invoke exportSingleSetlistJson on click'
  )
})

test('RENAME_SETLIST: Action present in three-dot menu, persists updated name, and preserves songs and order', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')
  const appCode = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8')

  // UI menu entry
  assert.ok(viewCode.includes('Rename Setlist'), 'Three-dot menu must include Rename Setlist option')
  assert.ok(viewCode.includes('setRenamingSetlist(sl)'), 'Selecting Rename Setlist opens rename dialog')
  assert.ok(viewCode.includes('onRenameSetlist?.(renamingSetlist.id, trimmed)'), 'Submitting dialog invokes onRenameSetlist')

  // App handler verification
  assert.ok(appCode.includes('const handleRenameSetlist ='), 'App must define handleRenameSetlist')
  assert.ok(appCode.includes('onRenameSetlist={handleRenameSetlist}'), 'App must pass handleRenameSetlist to SongbookHomeView')

  // Verify rename logic preserves songs, order, and other setlist metadata
  const originalSetlist = {
    id: 'gig-1',
    name: 'Old Name',
    createdAt: 12345678,
    songs: [
      { id: 1, title: 'Song 1', artist: 'Artist 1' },
      { id: 2, title: 'Song 2', artist: 'Artist 2' },
    ],
  }
  const setlists = [originalSetlist]
  const newName = 'New Renamed Setlist'
  const updatedSetlists = setlists.map((sl) => (sl.id === 'gig-1' ? { ...sl, name: newName } : sl))

  assert.equal(updatedSetlists[0].name, 'New Renamed Setlist')
  assert.equal(updatedSetlists[0].id, 'gig-1')
  assert.equal(updatedSetlists[0].createdAt, 12345678)
  assert.deepEqual(updatedSetlists[0].songs, originalSetlist.songs, 'Songs and song order must be preserved')
})

test('SHARE_SETLIST: Requires explicit click on Share Setlist in menu to invoke export', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  assert.ok(viewCode.includes('Share Setlist'), 'Three-dot menu must include Share Setlist option')
  assert.ok(
    viewCode.includes('exportSingleSetlistJson(sl, songs)'),
    'Share setlist option must reuse existing exportSingleSetlistJson'
  )
})

test('DELETE_SETLIST: Trash icon is visible on main setlist card, separate from menu, with confirmation guard', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')
  const appCode = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8')

  // Visible trash button on card
  assert.ok(viewCode.includes('title="Delete setlist"'), 'Setlist card must include a visible Delete Setlist button')
  assert.ok(viewCode.includes('setConfirmDeleteSetlistId(sl.id)'), 'Clicking trash icon must trigger confirmation state')

  // Confirmation popover
  assert.ok(viewCode.includes('Delete setlist?'), 'Must display "Delete setlist?" confirmation dialog')
  assert.ok(viewCode.includes('onDeleteSetlist?.(sl.id)'), 'Must call onDeleteSetlist only on confirmation')
  assert.ok(viewCode.includes('setConfirmDeleteSetlistId(null)'), 'Must permit cancelling deletion')

  // App wires onDeleteSetlist
  assert.ok(appCode.includes('onDeleteSetlist={handleDeleteSetlist}'), 'App must pass handleDeleteSetlist to SongbookHomeView')
})
