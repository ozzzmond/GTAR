const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webDir = path.resolve(__dirname, '..')



test('UI_COPY_CLEANUP: SongbookHomeView removes redundant Stage View instruction', () => {
  const homeViewContent = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')

  // Proves removal
  assert.ok(!homeViewContent.includes('Click any song to launch Stage View'), 'SongbookHomeView must not contain "Click any song to launch Stage View"')

  // Proves retentions
  assert.ok(homeViewContent.includes('Songs Library'), 'SongbookHomeView must retain Songs Library title')
  assert.ok(homeViewContent.includes('filteredIndexedSongs.length'), 'SongbookHomeView must retain song count')
})

test('PROD_VERSION_FALLBACK: tag-derived production version retains its fallback', () => {
  const gtarTypes = fs.readFileSync(path.join(webDir, 'src/types/gtar.ts'), 'utf8')
  assert.ok(gtarTypes.includes("? __GTAR_PROD_VERSION__ : '1.1.108';"), 'gtar.ts must preserve GTAR_APP_VERSION as 1.1.108')
})
