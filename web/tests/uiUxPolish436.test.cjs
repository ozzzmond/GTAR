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

  // Hover rename pencil and hover share button
  assert.ok(setlistHtml.includes('data-testid="desktop-rename-setlist-sl-1"'), 'Setlist card has desktop hover rename pencil')
  assert.ok(setlistHtml.includes('data-testid="desktop-share-setlist-sl-1"'), 'Setlist card has desktop hover share button')
  assert.ok(setlistHtml.includes('data-testid="desktop-delete-setlist-sl-1"'), 'Setlist card preserves desktop delete button')

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
      setlists: [],
      onSelectSong: () => {},
      onSongMembershipChange: () => false,
      onCreateSetlistForSong: () => false,
      onDeleteSong: () => {},
    })
  )

  assert.ok(songHtml.includes('data-testid="desktop-rename-song-0"'), 'Song card has desktop hover rename pencil')
  assert.ok(songHtml.includes('data-testid="desktop-delete-song-0"'), 'Song card has desktop hover delete button')
  assert.ok(songHtml.includes('data-testid="song-menu-0"'), 'Song card has kebab menu trigger')
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

test('GH436_CHECKLIST_04: Song card metadata row displays verified orig key, chart key, tempo, time, year without inventing missing fields', () => {
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

  // Song 1 has all verified metadata
  assert.ok(songHtml.includes('data-testid="meta-row-0"'), 'Song 1 has metadata row')
  assert.ok(songHtml.includes('data-testid="meta-orig-key-0"'), 'Song 1 has original key tag')
  assert.ok(songHtml.includes('Orig E'), 'Song 1 displays Orig E')
  assert.ok(songHtml.includes('data-testid="meta-chart-key-0"'), 'Song 1 has chart key tag')
  assert.ok(songHtml.includes('Chart G'), 'Song 1 displays Chart G')
  assert.ok(songHtml.includes('data-testid="meta-tempo-0"'), 'Song 1 has tempo tag')
  assert.ok(songHtml.includes('72 BPM'), 'Song 1 displays 72 BPM')
  assert.ok(songHtml.includes('data-testid="meta-time-0"'), 'Song 1 has time signature tag')
  assert.ok(songHtml.includes('3/4'), 'Song 1 displays 3/4')
  assert.ok(songHtml.includes('data-testid="meta-year-0"'), 'Song 1 has year tag')
  assert.ok(songHtml.includes('1779'), 'Song 1 displays 1779')

  // Song 2 has no metadata and must not invent fake placeholders
  assert.equal(songHtml.includes('data-testid="meta-row-1"'), false, 'Song 2 does not render empty metadata row')
})
