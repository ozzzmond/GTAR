const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const Module = require('node:module')
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options)
  } catch (err) {
    if (parent && parent.filename && request.startsWith('.')) {
      const dir = path.dirname(parent.filename)
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const candidate = path.resolve(dir, request + ext)
        if (fs.existsSync(candidate)) {
          return candidate
        }
      }
    }
    throw err
  }
}

require.extensions['.png'] = () => 'test-file-stub'
require.extensions['.svg'] = () => 'test-file-stub'

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
          jsx: ts.JsxEmit.React,
        },
      }).outputText,
      filename
    )
}

const React = require('react')
const ReactDOMServer = require('react-dom/server')

const { Header } = require('../src/components/Header.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { SetlistWorkspace } = require('../src/components/SetlistWorkspace.tsx')
const { AboutModal } = require('../src/components/AboutModal.tsx')
const { DeviceBackupCard } = require('../src/components/DeviceBackupCard.tsx')

test('GH436_CHECKLIST_01: About modal has no unverified MIT license claim', () => {
  const aboutSource = fs.readFileSync(path.resolve(__dirname, '../src/components/AboutModal.tsx'), 'utf8')
  assert.equal(aboutSource.toLowerCase().includes('mit license'), false, 'AboutModal must not claim MIT license')
})

test('GH436_CHECKLIST_02: Setlists card exposes hover Rename and Share actions; Song cards expose hover Rename and Delete', () => {
  const setlists = [
    {
      id: 'sl-1',
      name: 'Sunday Worship',
      songs: [{ title: 'Amazing Grace', artist: 'John Newton', key: 'G' }],
      createdAt: 1000,
    },
  ]

  const setlistHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(SetlistWorkspace, {
      scope: 'ALL_SETLISTS',
      setlists,
      songs: [],
      currentSelection: { type: 'ALL_SETLISTS' },
      onOpenSetlist: () => {},
      onDeleteSetlist: () => {},
      onRenameSetlist: () => {},
      menu: {
        sortValue: 'manual',
        sortOptions: [{ value: 'manual', label: 'Manual Order' }],
        onSortChange: () => {},
        onShareSetlist: () => {},
        onRenameSetlist: () => {},
        onRequestTrashSetlist: () => {},
      },
      onRequestTrashSetlist: () => {},
    })
  )

  // Setlist card: Share is in header row (before manage/delete in footer)
  assert.ok(setlistHtml.includes('data-testid="desktop-rename-setlist-sl-1"'), 'Setlist card has desktop hover rename pencil')
  assert.ok(setlistHtml.includes('data-testid="desktop-share-setlist-sl-1"'), 'Setlist card has desktop hover share button')
  assert.ok(setlistHtml.includes('data-testid="desktop-delete-setlist-sl-1"'), 'Setlist card preserves desktop delete button')
  const sharePos = setlistHtml.indexOf('data-testid="desktop-share-setlist-sl-1"')
  const managePos = setlistHtml.indexOf('data-testid="workspace-manage-sl-1"')
  assert.ok(sharePos < managePos, 'Share button is located in the setlist header row, before footer manage')

  const songs = [
    {
      id: 'song-1',
      title: 'Amazing Grace',
      artist: 'John Newton',
      key: 'G',
      originalKey: 'E',
      bpm: '72',
      time: '3/4',
      year: 1779,
      rawContent: '{title: Amazing Grace}\n{key: G}\n{original_key: E}\n{tempo: 72}\n{time: 3/4}\n{year: 1779}\n[G]Amazing Grace',
      createdAt: 1000,
    },
  ]

  const songHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(SongbookHomeView, {
      songs,
      setlists: [{ id: 'sl-1', name: 'Worship', songs: [{ id: 'song-1' }] }],
      onSelectSong: () => {},
      onSongMembershipChange: () => false,
      onCreateSetlistForSong: () => false,
      onDeleteSong: () => {},
    })
  )

  // Song card: Rename pencil in header next to kebab; Stage then Delete in footer
  assert.ok(songHtml.includes('data-testid="desktop-rename-song-0"'), 'Song card has desktop hover rename pencil')
  assert.ok(songHtml.includes('data-testid="song-menu-0"'), 'Song card has kebab menu trigger')
  const renamePos = songHtml.indexOf('data-testid="desktop-rename-song-0"')
  const menuPos = songHtml.indexOf('data-testid="song-menu-0"')
  assert.ok(renamePos < menuPos, 'Rename pencil sits in header row right next to kebab')

  assert.ok(songHtml.includes('data-testid="song-stage-0"'), 'Song card has Stage button')
  assert.ok(songHtml.includes('data-testid="desktop-delete-song-0"'), 'Song card has desktop hover delete button')
  const stagePos = songHtml.indexOf('data-testid="song-stage-0"')
  const deletePos = songHtml.indexOf('data-testid="desktop-delete-song-0"')
  assert.ok(stagePos < deletePos, 'Delete button sits after Stage button in footer')

  // Setlist-count badge still present
  assert.ok(songHtml.includes('data-testid="song-setlist-indicator-0"'), 'Song card preserves setlist-count indicator')
  assert.ok(songHtml.includes('data-testid="song-setlist-count-0"'), 'Song card preserves setlist-count badge')
})

test('GH436_CHECKLIST_03: Header logo is normalized to 40x40px (w-10 h-10)', () => {
  const headerHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Header, {
      currentView: 'songbook',
      onNavigate: () => {},
    })
  )
  assert.ok(headerHtml.includes('w-10 h-10'), 'Header logo container is normalized to w-10 h-10 (40x40px)')
})

test('GH436_MUST_FIX_2: Stage Options close button and modified controls stay >=44px below sm', () => {
  const stageOptionsSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageOptionsSheet.tsx'), 'utf8')
  assert.ok(
    stageOptionsSource.includes('min-w-11 min-h-11 sm:min-w-9 sm:min-h-9'),
    'StageOptionsSheet close button must be min-w-11 min-h-11 on mobile and sm:min-w-9 sm:min-h-9 on desktop'
  )

  const songbookSource = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')
  assert.ok(
    songbookSource.includes('min-h-11 sm:min-h-9'),
    'SongbookHomeView filter selects stay min-h-11 on mobile (< sm)'
  )

  const stageViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/StageView.tsx'), 'utf8')
  assert.ok(
    stageViewSource.includes('min-h-11 sm:min-h-9 min-w-11 sm:min-w-9'),
    'StageView toolbar controls stay min-h-11 min-w-11 on mobile (< sm)'
  )
})

test('GH436_CHECKLIST_04: Song card metadata row displays verified uniform pills (Orig Key, Chart Key, Tempo, Time, Year) without old chips or footer key/BPM', () => {
  const songs = [
    {
      id: 'song-1',
      title: 'Amazing Grace',
      artist: 'John Newton',
      key: 'G',
      originalKey: 'E',
      bpm: '72',
      time: '3/4',
      year: 1779,
      rawContent: '{title: Amazing Grace}\n{key: G}\n{original_key: E}\n{tempo: 72}\n{time: 3/4}\n{year: 1779}\n[G]Amazing Grace',
      createdAt: 1000,
    },
    {
      id: 'song-2',
      title: 'Bare Song',
      artist: 'Unknown',
      createdAt: 2000,
    },
    {
      id: 'song-3',
      title: 'Matching Keys Song',
      artist: 'Artist',
      key: 'D',
      originalKey: 'D',
      createdAt: 3000,
    },
  ]

  const songHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(SongbookHomeView, {
      songs,
      setlists: [],
      onSelectSong: () => {},
      onSongMembershipChange: () => false,
      onCreateSetlistForSong: () => false,
      onDeleteSong: () => {},
    })
  )

  // Song 1 has all verified metadata in uniform pills
  assert.ok(songHtml.includes('data-testid="meta-row-0"'), 'Song 1 has metadata row')
  assert.ok(songHtml.includes('data-testid="meta-orig-key-0"'), 'Song 1 has original key pill')
  assert.ok(songHtml.includes('Orig Key:</span><span class="text-app-heading font-bold">E</span>'), 'Song 1 displays Orig Key: E')
  assert.ok(songHtml.includes('data-testid="meta-chart-key-0"'), 'Song 1 has chart key pill')
  assert.ok(songHtml.includes('Chart Key:</span><span class="text-app-heading font-bold">G</span>'), 'Song 1 displays Chart Key: G')
  assert.ok(songHtml.includes('data-testid="meta-tempo-0"'), 'Song 1 has tempo pill')
  assert.ok(songHtml.includes('Tempo:</span><span class="text-app-heading font-bold">72 BPM</span>'), 'Song 1 displays Tempo: 72 BPM')
  assert.ok(songHtml.includes('data-testid="meta-time-0"'), 'Song 1 has time signature pill')
  assert.ok(songHtml.includes('Time:</span><span class="text-app-heading font-bold">3/4</span>'), 'Song 1 displays Time: 3/4')
  assert.ok(songHtml.includes('data-testid="meta-year-0"'), 'Song 1 has year pill')
  assert.ok(songHtml.includes('Year:</span><span class="text-app-heading font-bold">1779</span>'), 'Song 1 displays Year: 1779')

  // Uniform pill style: rounded-full, border, font-mono
  assert.ok(songHtml.includes('rounded-full bg-app-base/80 border border-app-border text-[10px] sm:text-[11px] font-mono'), 'Pills have uniform rounded-full style')

  // Replaces old amber Orig/Chart chips
  assert.equal(songHtml.includes('>Orig E<'), false, 'Old amber Orig chip removed')
  assert.equal(songHtml.includes('>Chart G<'), false, 'Old amber Chart chip removed')

  // Redundant footer key badge and footer BPM text removed
  assert.equal(songHtml.includes('px-1.5 py-0.5 rounded bg-app-base border border-app-border text-app-accent font-mono font-bold text-[11px]'), false, 'Footer key badge removed')

  // Song 2 has no metadata and must not invent fake placeholders
  assert.equal(songHtml.includes('data-testid="meta-row-1"'), false, 'Song 2 does not render empty metadata row')

  // Song 3: Chart Key is displayed even when equal to Orig Key
  assert.ok(songHtml.includes('data-testid="meta-orig-key-2"'), 'Song 3 has Orig Key pill')
  assert.ok(songHtml.includes('data-testid="meta-chart-key-2"'), 'Song 3 has Chart Key pill even when equal')
})

test('GH436_ROUND_3_BACKUP_LABELS: DeviceBackupCard renders Download backup and Copy backup without raw JSON labels', () => {
  const backupHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(DeviceBackupCard, {
      isOpen: true,
      allSongs: [],
      setlists: [],
      onClose: () => {},
    })
  )

  assert.ok(backupHtml.includes('Download backup'), 'Renders Download backup label')
  assert.ok(backupHtml.includes('Copy backup'), 'Renders Copy backup label')
  assert.equal(backupHtml.includes('Download .json'), false, 'Does not render Download .json')
  assert.equal(backupHtml.includes('Copy JSON'), false, 'Does not render Copy JSON')
})

test('GH436_ROUND_3_ENVIRONMENT_LABEL: AboutModal renders Preview on CF preview deployments, Production on release, and Development locally', () => {
  // 1. Local / Dev mode (import.meta.env.DEV: true or default isDevEnv)
  const defaultHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(AboutModal, {
      isOpen: true,
      onClose: () => {},
    })
  )
  assert.ok(defaultHtml.includes('data-testid="about-environment-string"'), 'Environment element present')
  assert.match(defaultHtml, /Production|Development|Preview/)

  // 2. Verified environment resolution rule in AboutModal source
  const aboutSource = fs.readFileSync(path.resolve(__dirname, '../src/components/AboutModal.tsx'), 'utf8')
  assert.ok(
    /GTAR_PREVIEW_IDENTITY\s*\?\s*['"]Preview['"]\s*:\s*['"]Production['"]/.test(aboutSource),
    'AboutModal checks GTAR_PREVIEW_IDENTITY for Preview environment'
  )
})
