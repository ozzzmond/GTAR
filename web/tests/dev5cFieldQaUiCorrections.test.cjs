const { readSource } = require('./helpers/sourceText.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const ts = require('typescript')

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

const React = require('react')
const { renderToString } = require('react-dom/server')
const { JSDOM } = require('jsdom')
global.localStorage = new JSDOM('', {url:'https://gtar.test'}).window.localStorage
const { SongbookHomeView: SongbookView } = require('../src/components/SongbookHomeView.tsx')
const { AuthContext } = require('../src/utils/authContext.ts')
const SongbookHomeView = props => React.createElement(AuthContext.Provider, {value:{session:{user:{id:'layout-user'}},accessStatus:'active',role:'USER'}}, React.createElement(SongbookView,props))
const { getSongMetadataStatus } = require('../src/utils/chordProMetadata.ts')

const webDir = path.resolve(__dirname, '..')

const sampleCompleteSong = {
  id: 'song-1',
  title: 'Hotel California',
  artist: 'Eagles',
  originalKey: 'Bm',
  bpm: '75',
  time: '4/4',
  year: '1976',
  rawContent: '{title: Hotel California}\n{artist: Eagles}\n{original_key: Bm}\n{tempo: 75}\n{time: 4/4}\n{year: 1976}\n[Bm]Welcome',
}

const sampleIncompleteSong = {
  id: 'song-2',
  title: 'Untitled Draft',
  artist: '',
  rawContent: '[C]Hello world',
}

const sampleSetlists = [
  {
    id: 'sl-1',
    name: 'Acoustic Set',
    songs: [{ id: 'song-1', title: 'Hotel California', artist: 'Eagles' }],
  },
]

// 3. MAIN SONGS LIBRARY CARDS METADATA STATUS ICON
test('DEV5C_QA_4: Main Songs Library cards render compact canonical metadata status icons', () => {
  const songs = [sampleCompleteSong, sampleIncompleteSong]

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs,
      activeSongIndex: 0,
      onSelectSong: () => {},
      onNewSong: () => {},
      onOpenSetlists: () => {},
      onOpenSongbook: () => {},
      onDeleteSong: () => {},
      setlists: sampleSetlists,
      onSongMembershipChange: () => {},
      onCreateSetlistForSong: () => {},
    })
  )

  // Complete song card
  assert.ok(html.includes('data-testid="song-metadata-status-0"'), 'Main card 0 renders metadata status container')
  assert.ok(html.includes('aria-label="Metadata OK"'), 'Main card 0 has aria-label="Metadata OK"')

  // Incomplete song card
  assert.ok(html.includes('data-testid="song-metadata-status-1"'), 'Main card 1 renders metadata status container')
  assert.ok(html.includes('Needs Metadata'), 'Main card 1 renders Needs Metadata status')

  // Source code check: canonical helper is called for each card
  const songbookSource = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')
  assert.ok(
    songbookSource.includes('const metadataStatus = getSongMetadataStatus(song)'),
    'SongbookHomeView must use canonical getSongMetadataStatus for card status'
  )
})

// 4. GIG SETLISTS TOOLBAR COMPACT QR/SHARE ICON
