// #139: indexed setlist resolution must return exactly what resolveSetlistSong returns,
// and an oversized publish must explain its size and the limit.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { resolveSetlistSong, resolveSetlistSongIndexed, songIdIndex } = require('../src/utils/setlistSongs.ts')
const { snapshotFromSongbook } = require('../src/utils/sharedSetlistSnapshot.ts')
const { makeLibrary, prng } = require('./helpers/syntheticSongbook.cjs')

test('indexed resolution is identical to resolveSetlistSong, including duplicates, numeric IDs and legacy title refs', () => {
  const songs = [
    { id: 'a', title: 'Alpha', artist: 'One', rawContent: '' },
    { id: 'a', title: 'Alpha duplicate id', artist: 'Two', rawContent: '' },
    { id: 7, title: 'Seven', artist: 'Num', rawContent: '' },
    { id: 'b', title: 'Same Title', artist: 'X', rawContent: '' },
    { id: 'c', title: 'same title ', artist: 'Y', rawContent: '' },
    { id: 'd', title: 'Unique', artist: 'Z', rawContent: '' },
  ]
  const refs = [
    { id: 'a', title: 'ignored' }, { id: '7', title: 'string form of numeric id' }, { id: 7, title: 'numeric' },
    { id: 'missing', title: 'Unique' }, { title: 'Same Title' }, { title: 'same title', artist: 'y' },
    { title: 'unique' }, { title: 'Nope' },
  ]
  const index = songIdIndex(songs)
  for (const ref of refs) assert.equal(resolveSetlistSongIndexed(ref, songs, index), resolveSetlistSong(ref, songs), JSON.stringify(ref))

  // Randomized parity over a synthetic library with mixed reference styles.
  const rand = prng(1390)
  const library = makeLibrary(300, 0, { chars: 200 })
  const big = songIdIndex(library.songs)
  for (let i = 0; i < 500; i++) {
    const song = library.songs[Math.floor(rand() * library.songs.length)]
    const ref = rand() < 0.7 ? { id: rand() < 0.9 ? song.id : 'nope-' + i, title: song.title }
      : { title: rand() < 0.5 ? song.title.toUpperCase() : 'Missing ' + i, artist: rand() < 0.5 ? song.artist : undefined }
    assert.equal(resolveSetlistSongIndexed(ref, library.songs, big), resolveSetlistSong(ref, library.songs))
  }
})

test('oversized shared setlist reports its size and the 256 KB limit', () => {
  const library = makeLibrary(62, 62, { chars: 8000 })
  assert.throws(() => snapshotFromSongbook(library, library.setlists[0].id),
    /^Error: Snapshot too large: \d+ KB exceeds the 256 KB shared setlist limit\. Split the setlist or shorten long charts/)
})
