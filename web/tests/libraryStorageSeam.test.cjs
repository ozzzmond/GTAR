// #171 B1a: the persisted library is reached only through the syncJournal storage seam.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
const api = require('../src/utils/syncJournal.ts')

const src = path.join(__dirname, '../src')
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [])

test('no module outside syncJournal touches the library key directly', () => {
  const offenders = []
  for (const file of files(src)) {
    if (file.endsWith(path.join('utils', 'syncJournal.ts'))) continue
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // comments may name the key
      if (/(getItem|setItem|removeItem)\(\s*LIBRARY_KEY/.test(line) || /['"`]gtar_library_v1['"`]/.test(line)) offenders.push(`${path.relative(src, file)}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [], 'use libraryRevision / restoreLibraryRevision / isLibraryStorageKey / peekPersistedLibrary')
})

test('seam helpers behave exactly like the v1 key today', () => {
  localStorage.clear()
  assert.equal(api.libraryRevision(localStorage), null)
  assert.equal(api.peekPersistedLibrary(localStorage), null)
  const library = { songs: [{ id: 'a', title: 'A', rawContent: 'x' }], setlists: [] }
  api.persistLibrary(library, localStorage)
  const revision = api.libraryRevision(localStorage)
  assert.equal(revision, localStorage.getItem(api.LIBRARY_KEY))
  assert.deepEqual(api.peekPersistedLibrary(localStorage).songs.map(s => s.id), ['a'])
  api.persistLibrary({ ...library, songs: [] }, localStorage)
  api.restoreLibraryRevision(revision, localStorage)
  assert.equal(api.libraryRevision(localStorage), revision)
  api.restoreLibraryRevision(null, localStorage)
  assert.equal(localStorage.getItem(api.LIBRARY_KEY), null)
  assert.equal(api.isLibraryStorageKey('gtar_library_v1'), true)
  assert.equal(api.isLibraryStorageKey('gtar_other'), false)
  assert.equal(api.isLibraryStorageKey(null), false)
})
