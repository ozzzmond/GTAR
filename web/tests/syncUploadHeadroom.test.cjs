// #190 (RFC #188 S2): upload size estimate, headroom levels and a clear message before the 2 MB server limit.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)

const { makeLibrary } = require('./helpers/syntheticSongbook.cjs')
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const { createSessionToken } = require('../functions/lib/authCore.ts')
const { writeCloudBackup } = require('../src/utils/manualCloudBackup.ts')
const api = require('../functions/api/songbook/sync.ts')
const sync = require('../src/utils/cloudBackupFormat.ts')

async function cloud() {
  const db = createSongbookSqlite()
  const user = { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' }
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM users WHERE id = ?')
    ? { bind(id) { return { first: async () => id === user.id ? user : null } } } : original(sql)
  const env = { DB: db, AUTH_SECRET: 'headroom-test-secret' }
  const token = await createSessionToken(user, env.AUTH_SECRET)
  const posts = []
  const fetch = async (url, opts) => {
    if (opts.method === 'POST') posts.push(opts.body)
    return api[opts.method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env,
      request: new Request('https://example.com/api/songbook/sync', { method: opts.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers?.['X-GTAR-Library-Owner'] ? { 'X-GTAR-Library-Owner': opts.headers['X-GTAR-Library-Owner'] } : {}) }, ...(opts.body ? { body: opts.body } : {}) }) })
  }
  return { fetch, posts }
}
async function withFetch(fn, body) {
  const saved = global.fetch
  global.fetch = fn
  try { return await body() } finally { global.fetch = saved }
}

test('client limit matches the server limit', () => {
  assert.equal(sync.SONGBOOK_UPLOAD_LIMIT_BYTES, api.MAX_SONGBOOK_PAYLOAD_BYTES)
})

test('headroom levels: ok below 75%, warning from 75%, over above the limit', () => {
  const limit = sync.SONGBOOK_UPLOAD_LIMIT_BYTES
  assert.equal(sync.songbookUploadHeadroom(Math.floor(limit * 0.5)).level, 'ok')
  assert.equal(sync.songbookUploadHeadroom(Math.ceil(limit * 0.75)).level, 'warning')
  assert.equal(sync.songbookUploadHeadroom(limit).level, 'warning')
  assert.equal(sync.songbookUploadHeadroom(limit + 1).level, 'over')
})

test('non-ASCII charts are counted in UTF-8 bytes, as the server counts them', () => {
  const lib = { songs: [{ id: 's1', title: 'Awit', rawContent: 'Purihin ang Panginoon — ñ é ü ♪'.repeat(200) }], setlists: [] }
  const chars = JSON.stringify(lib).length
  assert.ok(sync.estimateSongbookUploadBytes(lib) > chars)
})

test('estimate is an upper bound of the manual backup request body, within 100 bytes', async () => {
  const lib = makeLibrary(40, 3, { chars: 3000 })
  const { fetch, posts } = await cloud()
  await withFetch(fetch, async () => {
    const result = await writeCloudBackup({ token: 'token', userId: 'user-a' }, lib, null)
    assert.equal(result.checksum, sync.computeSongbookChecksum(lib))
  })
  const actual = new TextEncoder().encode(posts[0]).byteLength
  const estimate = sync.estimateSongbookUploadBytes(lib)
  assert.ok(estimate >= actual && estimate - actual < 100, `estimate ${estimate}, actual ${actual}`)
})
