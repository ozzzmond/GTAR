const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)

const { deduplicateLibrary } = require('../src/utils/syncMerge.ts')
const { parseBackupJson } = require('../src/utils/jsonBackup.ts')

const parse = value => value === null ? null : parseBackupJson(JSON.stringify(value))

test('same-name stable songs and setlists are retained without rewriting their IDs', () => {
  const library = parse({
    songs: [
      { id: 'a', title: 'Same', rawContent: 'First' },
      { id: 'b', title: 'Same', rawContent: 'Second' }
    ],
    setlists: [
      { id: 'x', name: 'Gig', songs: [{ id: 'a', title: 'Same' }] },
      { id: 'y', name: 'Gig', songs: [{ id: 'b', title: 'Same' }] }
    ]
  })
  const result = deduplicateLibrary(library)
  assert.equal(result.songs.length, 2)
  assert.equal(result.setlists.length, 2)
  assert.deepEqual(result.setlists.map(s => s.songs[0].id), ['a', 'b'])
})
