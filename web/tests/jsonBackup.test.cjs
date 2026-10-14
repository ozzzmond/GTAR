const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)
const { parseBackupJson } = require('../src/utils/jsonBackup.ts')
const song = { title: 'Good', rawContent: '[C]Lyrics' }
test('rejects every malformed entry without returning partial data or writing storage', () => {
  global.localStorage = { setItem() { assert.fail('validation must not mutate storage') } }
  for (const bad of [{ title: 12, rawContent: '' }, { title: 'Bad', rawContent: {} }, null, { title: ' ' }, { ...song, artist: [] }]) {
    const result = parseBackupJson(JSON.stringify({ songs: [song, bad], setlists: [] }))
    assert.equal(result.isValid, false)
    assert.match(result.error, /songs\[1\]/)
    assert.deepEqual(result.songs, [])
    assert.deepEqual(result.setlists, [])
  }
})
test('rejects malformed structures, references and single setlist entries', () => {
  for (const payload of [{}, { songs: {} }, { songs: [], setlists: null }, { songs: [song], setlists: [null] },
    { songs: [song], setlists: [{ name: 'Gig', songs: [{ title: 2 }] }] },
    { songs: [song], setlists: [{ name: 'Gig', songs: [{ title: 'Good', id: {} }] }] },
    { exportType: 'SINGLE_SETLIST', setlist: { name: 'Gig', songs: [null] } }]) {
    assert.equal(parseBackupJson(JSON.stringify(payload)).isValid, false, JSON.stringify(payload))
  }
})
test('accepts explicit empty backups and existing numeric IDs; preserves empty content', () => {
  assert.equal(parseBackupJson('{"songs":[],"setlists":[]}').isValid, true)
  const parsed = parseBackupJson(JSON.stringify({ songs: [{ ...song, id: 123, rawContent: '', content: 'fallback' }], setlists: [{ id: 'gig', name: 'Gig', songs: [{ title: 'Good', id: 123 }] }] }))
  assert.equal(parsed.isValid, true)
  assert.equal(parsed.songs[0].rawContent, '')
})
test('reports all invalid fields with item paths', () => {
  const parsed = parseBackupJson('{"songs":[{"title":1,"content":{}},null]}')
  assert.match(parsed.error, /songs\[0\].title/)
  assert.match(parsed.error, /songs\[0\].content/)
  assert.match(parsed.error, /songs\[1\]/)
})
