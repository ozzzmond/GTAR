const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)
const { pullCloudBackup, pushCloudBackup, prepareCloudResolution, clearDriveSession } = require('../src/utils/driveSync.ts')
const { mergeSyncLibrary } = require('../src/utils/syncMerge.ts')
const { normalizeBackupSong } = require('../src/utils/jsonBackup.ts')
const { readGoogleSession, validSession, saveGoogleSession } = require('../src/utils/googleAuth.ts')
const song = normalizeBackupSong({ id: 'a', title: 'A', rawContent: 'original' })
const library = { songs: [song], setlists: [] }
const payload = { ...library, app: 'GTAR', exportType: 'FULL_BACKUP', version: '1', exportedAt: new Date().toISOString() }
const json = (data, headers = {}) => new Response(JSON.stringify(data), { headers })
test('cached auth expires without requesting GIS and tolerates blocked storage', () => {
  const session = { token: 'secret', expiresAt: Date.now() + 60000, user: { sub: '1', email: 'a@example.com' } }
  global.sessionStorage = { getItem: () => JSON.stringify(session), removeItem() {}, setItem() {} }
  assert.deepEqual(readGoogleSession(), session)
  assert.equal(validSession({ ...session, expiresAt: 0 }), false)
  global.sessionStorage.getItem = () => { throw Error('blocked') }
  assert.equal(readGoogleSession(), null)
  saveGoogleSession(null)
})
test('three-way merge preserves independent edits, deletions and resolves divergent edits in favor of local', () => {
  const local = { ...library, songs: [{ ...song, rawContent: 'local' }] }
  assert.equal(mergeSyncLibrary(local, library, library).songs[0].rawContent, 'local')
  assert.equal(mergeSyncLibrary(library, local, library).songs[0].rawContent, 'local')
  assert.equal(mergeSyncLibrary({ songs: [], setlists: [] }, library, library).songs.length, 0)
  assert.equal(mergeSyncLibrary(local, { ...library, songs: [{ ...song, rawContent: 'remote' }] }, library).songs[0].rawContent, 'local')
  assert.throws(() => mergeSyncLibrary(library, { songs: [], setlists: [{ id: 's', name: 'S', songs: [{ id: 'missing', title: 'Missing' }] }] }, null), /missing/)
})

const REVISION_NAME = 'gtar_songbook_revision_v1.json'
function driveServer() {
  const files = new Map()
  let sequence = 0, loseResponse = false
  global.fetch = async (url, init) => {
    const params = new URL(url).searchParams
    if (params.has('uploadType')) {
      assert.equal(init.method, 'POST')
      assert.equal(init.headers['If-Match'], undefined)
      const parts = init.body.split('Content-Type: application/json\r\n\r\n')
      const body = JSON.parse(parts[1].split('\r\n--')[0])
      const file = { id: `file-${++sequence}`, name: REVISION_NAME, version: '1' }
      files.set(file.id, { file, body })
      if (loseResponse) { loseResponse = false; throw Error('response lost') }
      return json(file)
    }
    if (params.has('spaces')) return json({ files: [...files.values()].map(v => v.file) })
    const record = files.get(new URL(url).pathname.split('/').at(-1))
    return json(params.has('alt') ? record.body : record.file)
  }
  return { files, loseNextResponse() { loseResponse = true } }
}
test('interleaved initial writers retain both branches and consolidate divergent heads cleanly', async () => {
  const original = global.fetch
  const server = driveServer()
  try {
    assert.equal(await pullCloudBackup('one'), null)
    assert.equal(await pullCloudBackup('two'), null)
    await pushCloudBackup('one', payload)
    await pushCloudBackup('two', {...payload, songs:[{...song, rawContent:'second writer'}]})
    assert.equal(server.files.size, 2)
    const pulled = await pullCloudBackup('one')
    assert.ok(pulled)
    assert.deepEqual([...server.files.values()].map(v => v.body.songs[0].rawContent), ['original','second writer'])
  } finally { global.fetch = original; clearDriveSession('one'); clearDriveSession('two') }
})
test('sequential writes append and supersede only observed parents; uncertain uploads are recovered by pulling', async () => {
  const original = global.fetch
  const server = driveServer()
  try {
    await assert.rejects(pushCloudBackup('retry', payload), /Download/)
    await pullCloudBackup('retry')
    server.loseNextResponse()
    await assert.rejects(pushCloudBackup('retry', payload), /response lost/)
    await assert.rejects(pushCloudBackup('retry', payload), /Download/)
    assert.equal((await pullCloudBackup('retry')).songs[0].rawContent, 'original')
    await pushCloudBackup('retry', {...payload, songs:[{...song, rawContent:'next'}]})
    assert.equal(server.files.size, 2)
    assert.equal((await pullCloudBackup('retry')).songs[0].rawContent, 'next')
    assert.deepEqual(server.files.get('file-2').body.syncParents, ['file-1@version:1'])
  } finally { global.fetch = original; clearDriveSession('retry') }
})
test('identical concurrent creations can be reconciled without choosing a writer', async () => {
  const original = global.fetch
  const server = driveServer()
  try {
    await pullCloudBackup('a'); await pullCloudBackup('b')
    await pushCloudBackup('a', payload); await pushCloudBackup('b', payload)
    await pullCloudBackup('a'); await pushCloudBackup('a', payload)
    assert.equal(server.files.size, 3)
    assert.equal(server.files.get('file-3').body.syncParents.length, 2)
  } finally { global.fetch = original; clearDriveSession('a'); clearDriveSession('b') }
})

test('interleaved existing writers and manual resolution retain history and acknowledge both heads', async () => {
  const original=global.fetch, server=driveServer()
  try {
    await pullCloudBackup('seed');await pushCloudBackup('seed',payload)
    await pullCloudBackup('left');await pullCloudBackup('right')
    await pushCloudBackup('left',{...payload,songs:[{...song,rawContent:'left'}]})
    await pushCloudBackup('right',{...payload,songs:[{...song,rawContent:'right'}]})
    const pulled = await pullCloudBackup('resolve')
    assert.ok(pulled)
    await prepareCloudResolution('resolve')
    await pushCloudBackup('resolve',{...payload,songs:[{...song,rawContent:'resolved both'}]})
    assert.equal(server.files.size,4)
    assert.deepEqual(server.files.get('file-4').body.syncParents,['file-2@version:1','file-3@version:1'])
    assert.equal((await pullCloudBackup('resolve')).songs[0].rawContent,'resolved both')
  } finally {global.fetch=original;for(const token of ['seed','left','right','resolve'])clearDriveSession(token)}
})
test('invalid historical payloads, missing revisions, and expired credentials fail before writes',async()=>{
  const original=global.fetch
  try {
    global.fetch=async()=>new Response('',{status:401})
    await assert.rejects(pullCloudBackup('invalid'),error=>error.status===401)
    global.fetch=async url=>url.includes('alt=media')?json({songs:[{}]}):json({files:[{id:'bad',version:'1'}]})
    await assert.rejects(pullCloudBackup('invalid'),/rejected/)
    await assert.rejects(pushCloudBackup('invalid',payload),/Download/)
    global.fetch=async url=>url.includes('alt=media')?json(payload):new URL(url).searchParams.has('spaces')?json({files:[{id:'missing-revision'}]}):json({id:'missing-revision'})
    await assert.rejects(pullCloudBackup('invalid'),/no revision/)
  } finally {global.fetch=original;clearDriveSession('invalid')}
})

test('Google Drive API quota and storage quota limits are classified explicitly', async () => {
  const original = global.fetch
  try {
    global.fetch = async () => new Response(JSON.stringify({
      error: { code: 403, message: 'User storage quota exceeded', errors: [{ reason: 'storageQuotaExceeded' }] }
    }), { status: 403 })
    await assert.rejects(pullCloudBackup('test-quota'), err => {
      return err.status === 403 && err.isDriveQuota === true && /Google Drive storage quota exceeded/.test(err.message)
    })

    global.fetch = async () => new Response(JSON.stringify({
      error: { code: 403, message: 'Rate limit exceeded', errors: [{ reason: 'rateLimitExceeded' }] }
    }), { status: 403 })
    await assert.rejects(pullCloudBackup('test-quota'), err => {
      return err.status === 403 && err.isDriveQuota === true && /Google Drive API quota limit reached/.test(err.message)
    })
  } finally {
    global.fetch = original
    clearDriveSession('test-quota')
  }
})

test('pullCloudWhitelist extracts allowedUsers from cloud sync files', async () => {
  const { pullCloudWhitelist } = require('../src/utils/driveSync.ts')
  const original = global.fetch
  try {
    const customPayload = { ...payload, allowedUsers: ['johncriscaculitan01@gmail.com', 'jlopez3rd@gmail.com'] }
    global.fetch = async url => {
      if (url.includes('spaces')) return json({ files: [{ id: 'file-wl', name: 'gtar_songbook_revision_v1.json', version: '1' }] })
      if (url.includes('alt=media')) return json(customPayload)
      return json({ id: 'file-wl', version: '1' })
    }
    const whitelist = await pullCloudWhitelist('test-wl')
    assert.deepEqual(whitelist, ['johncriscaculitan01@gmail.com', 'jlopez3rd@gmail.com'])
  } finally {
    global.fetch = original
    clearDriveSession('test-wl')
  }
})


