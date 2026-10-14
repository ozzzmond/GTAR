const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}

require.extensions['.png'] = (module) => {
  module.exports = '/assets/dev-logo.png'
}

if (typeof global.localStorage === 'undefined') {
  global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  }
}

const webDir = path.resolve(__dirname, '..')
const rootDir = path.resolve(webDir, '..')

const { Header } = require('../src/components/Header.tsx')
const { StageView } = require('../src/components/StageView.tsx')

// 1: STAGE_HEADER_ARTIST_VISIBILITY
test('SCOPE_1: StageView header renders artist line with descender clearance and without clipping or overlap', () => {
  const stageSource = fs.readFileSync(path.join(webDir, 'src/components/StageView.tsx'), 'utf8')

  // Top app bar left side (non-performance mode)
  assert.ok(
    stageSource.includes('text-[11px] sm:text-xs text-app-action font-semibold truncate leading-normal mt-0.5 pb-0.5'),
    'StageView top bar must use leading-normal and pb-0.5 for artist line'
  )
  assert.ok(
    !stageSource.includes('text-[11px] sm:text-xs text-app-action font-semibold truncate leading-none mt-0.5'),
    'StageView top bar must not use leading-none that clips descenders'
  )

  // Floating overlay HUD (performance mode)
  assert.ok(
    stageSource.includes('text-[10px] sm:text-xs text-app-action font-semibold truncate leading-normal mt-0.5 pb-0.5'),
    'StageView overlay HUD must use leading-normal and pb-0.5 for artist line'
  )
  assert.ok(
    !stageSource.includes('text-[10px] sm:text-xs text-app-action font-semibold truncate leading-none mt-0.5'),
    'StageView overlay HUD must not use leading-none that clips descenders'
  )

  // Verify rendering of a song with descender characters ("Hillsong Live")
  const stageHtml = renderToStaticMarkup(
    React.createElement(StageView, {
      song: {
        id: 'test-song',
        title: 'Mighty To Save',
        artist: 'Hillsong Live',
        rawContent: '[C]Everyone needs compassion',
      },
      songs: [],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      queueMode: 'library',
      onToggleQueueMode: () => {},
      isInSetlistMode: false,
      activeSetlistSongs: [],
      activeSetlistSongIndex: 0,
      onSelectSetlistSongIndex: () => {},
      setlists: [],
      onSelectSetlist: () => {},
      onOpenSetlistDrawer: () => {},
      isSetlistDrawerOpen: false,
      isStageSettingsModalOpen: false,
      isAnyModalOpen: false,
      onBack: () => {},
      transposeOffset: 0,
      onTransposeChange: () => {},
      fontStyle: 'mono',
      onSelectFontStyle: () => {},
      isTwoColumn: false,
      onToggleTwoColumn: () => {},
    })
  )

  assert.ok(stageHtml.includes('Hillsong Live'), 'StageView must render artist text')
  assert.ok(stageHtml.includes('Mighty To Save'), 'StageView must render song title')
  assert.ok(stageHtml.includes('font-extrabold text-app-text tracking-tight leading-tight truncate'), 'Song title retains bold emphasis and truncate')
})

// 2: STAGE_TOOLBAR_ORDER
test('SCOPE_2: Stage/main toolbar orders right-side controls TRASH -> KEBAB -> HAMBURGER, with Hamburger far right', () => {
  const headerHtml = renderToStaticMarkup(
    React.createElement(Header, {
      title: 'GTAR',
      version: 'v1.0.130-dev.2c',
      activeTab: 'stage',
      onSelectTab: () => {},
      onOpenSettings: () => {},
      onOpenSetlistDrawer: () => {},
      onOpenSyncStatus: () => {},
      onOpenTrash: () => {},
      onOpenChangelog: () => {},
      onOpenThemeStudio: () => {},
      allSongs: [],
      onSelectSong: () => {},
      onNavigate: () => {},
    })
  )

  // Check positions in HTML output
  const trashIdx = headerHtml.indexOf('aria-label="Trash (Alt+6)"')
  const kebabIdx = headerHtml.indexOf('aria-label="More"')
  const hamburgerIdx = headerHtml.indexOf('data-testid="canonical-sidepanel-toggle-btn"')

  assert.ok(trashIdx !== -1, 'Trash button must exist')
  assert.ok(kebabIdx !== -1, 'More (kebab) button must exist')
  assert.ok(hamburgerIdx !== -1, 'Side Panel (hamburger) button must exist')

  assert.ok(
    trashIdx < kebabIdx,
    `Trash (${trashIdx}) must appear before Kebab (${kebabIdx}) in toolbar`
  )
  assert.ok(
    kebabIdx < hamburgerIdx,
    `Kebab (${kebabIdx}) must sit between Trash and Hamburger (${hamburgerIdx})`
  )

  // Ensure hamburger is the final control in main-toolbar-group
  const headerSource = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')
  const toolbarGroupMatch = headerSource.match(/data-testid="main-toolbar-group">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)
  assert.ok(toolbarGroupMatch, 'Toolbar group must be found in Header.tsx')

  const groupContent = toolbarGroupMatch[1]
  const lastButtonIndex = groupContent.lastIndexOf('<ToolbarIconButton')
  const hamburgerPosInGroup = groupContent.indexOf('testId="canonical-sidepanel-toggle-btn"')

  assert.ok(
    hamburgerPosInGroup > lastButtonIndex,
    'Hamburger (canonical-sidepanel-toggle-btn) must be the far-right control in the toolbar'
  )
})

// 3: REPO_RECEIPT_RETIREMENT
test('SCOPE_3: Repository does not generate or assert local outputs/ txt receipts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts || {})) {
    assert.ok(
      !scriptCmd.includes('outputs/') && !scriptCmd.includes('outputs\\'),
      `web/package.json script "${scriptName}" must not write to outputs/`
    )
  }

  const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8')
  assert.ok(gitignore.includes('/outputs/'), '.gitignore must ignore root /outputs/')
  assert.ok(gitignore.includes('/web/outputs/'), '.gitignore must ignore /web/outputs/')

  const standingProtocol = fs.readFileSync(path.join(rootDir, 'gtar_standing_protocol_v1.md'), 'utf8')
  assert.ok(
    standingProtocol.includes('Local receipt files are non-canonical and not required'),
    'Standing protocol documents local receipts as non-canonical and not required'
  )
})
