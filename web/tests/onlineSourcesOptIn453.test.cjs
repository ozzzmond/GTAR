const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)

const sources = require('../src/utils/onlineSources.ts')
const { UltimateGuitarProvider, OnlineSearchError } = require('../src/utils/onlineSearchProvider.ts')

const memory = () => {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), data }
}

test('#453 online sources are off by default and only the exact opt-in value enables them', () => {
  const storage = memory()
  assert.equal(sources.isOnlineSourcesEnabled(storage), false)
  storage.setItem(sources.ONLINE_SOURCES_KEY, 'true')
  assert.equal(sources.isOnlineSourcesEnabled(storage), false)
  sources.setOnlineSourcesEnabled(true, storage)
  assert.equal(storage.data.get(sources.ONLINE_SOURCES_KEY), '1')
  assert.equal(sources.isOnlineSourcesEnabled(storage), true)
  sources.setOnlineSourcesEnabled(false, storage)
  assert.equal(storage.data.has(sources.ONLINE_SOURCES_KEY), false)
  assert.equal(sources.isOnlineSourcesEnabled(storage), false)
})

test('#453 unavailable or throwing storage means off and never throws', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.equal(sources.isOnlineSourcesEnabled(broken), false)
  assert.doesNotThrow(() => sources.setOnlineSourcesEnabled(true, broken))
  assert.equal(sources.isOnlineSourcesEnabled(null), false)
})

test('#453 provider calls the proxy without credentials and maps a disabled deployment', async () => {
  const saved = global.fetch
  const calls = []
  try {
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      return Response.json({ success: false, error: 'ONLINE_SOURCES_DISABLED' }, { status: 503 })
    }
    await assert.rejects(new UltimateGuitarProvider().search('wonderwall'), error => {
      assert.ok(error instanceof OnlineSearchError)
      assert.equal(error.code, 'DISABLED')
      assert.equal(error.message, 'Online song sources are not available on this site.')
      return true
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].options?.headers?.Authorization, undefined)
    // A bare 503 stays a generic error, and 401 is no longer a login prompt.
    global.fetch = async () => new Response('x', { status: 401 })
    await assert.rejects(new UltimateGuitarProvider().search('wonderwall'), error => {
      assert.notEqual(error.code, 'UNAUTHORIZED')
      assert.doesNotMatch(error.message, /login/i)
      return true
    })
  } finally { global.fetch = saved }
})

test('#453 search bar queries online only when the toggle is on and the menu exposes it as a checkbox', () => {
  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.match(header, /useOnlineSourcesEnabled\(\)/)
  assert.match(header, /if \(!onlineSourcesEnabled \|\| !trimmed \|\| trimmed\.length < 2\)/)
  assert.match(header, /\[searchQuery, onlineSourcesEnabled\]/)
  assert.match(header, /role="menuitemcheckbox"[\s\S]*?aria-checked=\{onlineSourcesEnabled\}[\s\S]*?data-testid="settings-online-sources"/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/utils/onlineSearchProvider.ts'), 'utf8'), /Active account login required/)
})
