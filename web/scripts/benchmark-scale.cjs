#!/usr/bin/env node
// #139 local benchmark: synthetic libraries at 100..1,500 songs, measured in Node with the
// real persistence/snapshot/setlist-resolution code. Prints a table; writes nothing to disk.
// Browser numbers (quota, heap, render/scroll) still need a real-device run.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const root = path.join(__dirname, '..')
const { makeLibrary, QuotaStorage } = require(path.join(root, 'tests/helpers/syntheticSongbook.cjs'))
const { persistLibrary, LIBRARY_KEY } = require(path.join(root, 'src/utils/syncJournal.ts'))
const { resolveSetlistSong, resolveSetlistSongIndexed, songIdIndex } = require(path.join(root, 'src/utils/setlistSongs.ts'))

const QUOTA = 5 * 1024 * 1024
const scales = (process.argv[2] || '100,250,500,1000,1500').split(',').map(Number)
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const time = fn => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6 }

// Mirrors SongbookHomeView's title/artist search predicate.
const search = (songs, q) => songs.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
// Pre-#139 SongbookHomeView setlist filter: every song re-resolves every setlist ref.
const legacySetlistFilter = (songs, setlist) => songs.filter(song => setlist.songs.some(ref => resolveSetlistSong(ref, songs)?.id === song.id))
// Current SongbookHomeView: resolve refs once through the ID index, then Set membership.
const setlistFilter = (songs, setlist) => {
  const index = songIdIndex(songs)
  const members = new Set(setlist.songs.map(ref => resolveSetlistSongIndexed(ref, songs, index)?.id))
  return songs.filter(song => members.has(song.id))
}

const rows = []
for (const n of scales) {
  const library = makeLibrary(n, Math.min(n, 62))
  const raw = JSON.stringify(library)
  const storage = new QuotaStorage(QUOTA)
  let persisted = 'ok'
  let persistMs = null
  try { persistMs = time(() => persistLibrary(library, storage)) } catch (error) { persisted = /quota/i.test(error.message) ? 'QUOTA' : 'ERROR' }
  const parseMs = persisted === 'ok' ? time(() => JSON.parse(storage.getItem(LIBRARY_KEY))) : null
  const queries = ['song 0001', 'artist 4', 'synthetic', 'zzz-no-match', 'test artist 9']
  const searchRuns = []
  for (let r = 0; r < 20; r++) for (const q of queries) searchRuns.push(time(() => search(library.songs, q)))
  const legacyFilterMs = time(() => legacySetlistFilter(library.songs, library.setlists[0]))
  const filterMs = time(() => setlistFilter(library.songs, library.setlists[0]))
  rows.push({
    songs: n,
    libraryKB: Math.round(Buffer.byteLength(raw) / 1024),
    quotaUsedPct: Math.round(raw.length / QUOTA * 100),
    persist: persisted,
    persistMs: persistMs?.toFixed(1) ?? '-',
    parseMs: parseMs?.toFixed(1) ?? '-',
    searchP50ms: percentile(searchRuns, 0.5).toFixed(2),
    searchP95ms: percentile(searchRuns, 0.95).toFixed(2),
    legacyFilterMs: legacyFilterMs.toFixed(1),
    setlistFilterMs: filterMs.toFixed(2),
  })
}
console.table(rows)
console.log(`Node ${process.version}; modeled quota ${QUOTA} chars (key+value); fixtures: deterministic synthetic ChordPro, ~4 KB average chart.`)
