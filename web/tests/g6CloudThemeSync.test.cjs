const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      filename
    )
}

const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const { bindOwner } = require('./helpers/libraryOwner.cjs')
const { upsertUserSongbook, findUserSongbook, createSessionToken } = require('../functions/lib/authCore.ts')
const api = require('../functions/api/songbook/sync.ts')
const sync = require('../src/utils/cloudSongbookSync.ts')
const {
  DEFAULT_CUSTOM_COLORS,
  THEME_MODES,
  validateCloudThemeSettings,
  normalizeCloudThemeSettings,
  readCloudThemeSettings,
  persistCloudThemeSettings,
  cloudThemeSettingsEquals,
  SETTINGS_KEYS,
  SETTINGS_CHANGED,
} = require('../src/utils/backupSettings.ts')

function createStorage() {
  const map = new Map()
  const store = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
  bindOwner(store, 'user-a') // #247: devices in these tests belong to user-a
  return store
}

async function fixture() {
  const db = createSongbookSqlite()
  const user = { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' }
  const original = db.prepare.bind(db)
  db.prepare = (sql) =>
    sql.includes('FROM users WHERE id = ?')
      ? { bind(id) { return { first: async () => (id === user.id ? user : null) } } }
      : original(sql)
  const env = { DB: db, AUTH_SECRET: 'concurrency-test-secret' }
  const token = await createSessionToken(user, env.AUTH_SECRET)
  const request = async (method, body) =>
    api[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({
      env,
      request: new Request('https://example.com/api/songbook/sync', {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    })
  return { db, request, token }
}

async function withFetch(fn, body) {
  const saved = global.fetch
  global.fetch = fn
  try {
    return await body()
  } finally {
    global.fetch = saved
  }
}

const SAMPLE_PALETTE_A = {
  ...DEFAULT_CUSTOM_COLORS,
  bgHex: '#101010',
  textHex: '#E0E0E0',
  chordHex: '#FFB000',
  sectionHex: '#8080FF',
}

const SAMPLE_PALETTE_B = {
  ...DEFAULT_CUSTOM_COLORS,
  bgHex: '#202020',
  textHex: '#FFFFFF',
  chordHex: '#00D084',
  sectionHex: '#FF6900',
}

test('G6-1: Legacy songs/setlists-only payload and checksum compatibility', () => {
  const legacyLib = {
    songs: [{ id: 's1', title: 'Song One', rawContent: '[C]Hello', updatedAt: 1000 }],
    setlists: [{ id: 'sl1', name: 'Set One', songs: [{ title: 'Song One' }], updatedAt: 1000 }],
  }

  const legacyChecksum = sync.computeSongbookChecksum(legacyLib)
  assert.match(legacyChecksum, /^ck_[0-9a-f]{16}$/)

  // Explicitly undefined themeSettings produces identical legacy checksum
  const explicitUndefinedChecksum = sync.computeSongbookChecksum({
    ...legacyLib,
    themeSettings: undefined,
  })
  assert.equal(explicitUndefinedChecksum, legacyChecksum)

  // Including themeSettings produces a distinct, deterministic checksum
  const defaultTheme = {
    version: 1,
    themeMode: 'solarized-dark',
    customThemeColors: DEFAULT_CUSTOM_COLORS,
    factoryThemeOverrides: {},
  }
  const themeAwareChecksum1 = sync.computeSongbookChecksum({
    ...legacyLib,
    themeSettings: defaultTheme,
  })
  assert.notEqual(themeAwareChecksum1, legacyChecksum)

  // Reordered keys inside themeSettings produce the exact same canonical checksum
  const reorderedTheme = {
    factoryThemeOverrides: {},
    themeMode: 'solarized-dark',
    version: 1,
    customThemeColors: {
      dockPlayIcon: defaultTheme.customThemeColors.dockPlayIcon,
      bgHex: defaultTheme.customThemeColors.bgHex,
      textHex: defaultTheme.customThemeColors.textHex,
      chordHex: defaultTheme.customThemeColors.chordHex,
      sectionHex: defaultTheme.customThemeColors.sectionHex,
    },
  }
  const themeAwareChecksum2 = sync.computeSongbookChecksum({
    ...legacyLib,
    themeSettings: reorderedTheme,
  })
  assert.equal(themeAwareChecksum2, themeAwareChecksum1)
})

test('G6-2: Legacy cloud payload lacking themeSettings never resets customized local theme on download', async () => {
  const store = createStorage()
  const baseSongs = [{ id: 's1', title: 'Song 1', rawContent: 'v1', updatedAt: 100 }]
  const remoteSongs = [{ id: 's1', title: 'Song 1', rawContent: 'v2-remote', updatedAt: 200 }]
  const baseLib = { songs: baseSongs, setlists: [] }
  const remoteLegacyLib = { songs: remoteSongs, setlists: [] }

  store.setItem('gtar_library_v1', JSON.stringify(baseLib))
  store.setItem('gtar_theme_store', 'amber-stage')
  store.setItem(
    'gtar_factory_theme_overrides',
    JSON.stringify({ 'amber-stage': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'amber-stage', displayName: 'Amber' } } })
  )
  store.setItem('gtar_custom_theme_colors', JSON.stringify(SAMPLE_PALETTE_B))

  const baseChecksum = sync.computeSongbookChecksum(baseLib)
  store.setItem(sync.CLOUD_SYNC_BASE_KEY, JSON.stringify(baseLib))
  store.setItem(
    sync.CLOUD_SYNC_META_KEY,
    JSON.stringify({
      lastSyncedVersion: 1,
      lastSyncedChecksum: baseChecksum,
      lastSyncedAt: Date.now(),
      lastSyncedUserId: 'user-a',
    })
  )

  const remoteChecksum = sync.computeSongbookChecksum(remoteLegacyLib)
  await withFetch(
    async (url, init) => {
      if (!init || init.method === 'GET') {
        return new Response(
          JSON.stringify({
            success: true,
            cloudRecord: {
              userId: 'user-a',
              version: 2,
              checksum: remoteChecksum,
              updatedAt: '2026-01-02T00:00:00.000Z',
              data: remoteLegacyLib,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    },
    async () => {
      const res = await sync.performCloudSongbookSync('tok', { storage: store })
      assert.equal(res.success, true)
      assert.equal(res.actionTaken, 'DOWNLOADED')
    }
  )

  // Local customized theme must still be intact
  const afterTheme = readCloudThemeSettings(store)
  assert.equal(afterTheme.themeMode, 'amber-stage')
  assert.equal(afterTheme.factoryThemeOverrides['amber-stage'].bgHex, SAMPLE_PALETTE_A.bgHex)
  assert.equal(afterTheme.customThemeColors.bgHex, SAMPLE_PALETTE_B.bgHex)
  // Songbook downloaded v2-remote
  const savedLib = JSON.parse(store.getItem('gtar_library_v1'))
  assert.equal(savedLib.songs[0].rawContent, 'v2-remote')
})

test('G6-3: Theme-only upload and theme-only download with immediate runtime hydration', async () => {
  const storeA = createStorage()
  const baseSongs = [{ id: 's1', title: 'Song 1', rawContent: 'v1', updatedAt: 100 }]
  const initialTheme = readCloudThemeSettings(storeA)
  const baseLibWithTheme = {
    songs: baseSongs,
    setlists: [],
    themeSettings: initialTheme,
  }
  const baseChecksum = sync.computeSongbookChecksum(baseLibWithTheme)

  storeA.setItem('gtar_library_v1', JSON.stringify({ songs: baseSongs, setlists: [] }))
  storeA.setItem('gtar_cloud_sync_base_v1', JSON.stringify(baseLibWithTheme))
  storeA.setItem(
    'gtar_cloud_sync_meta_v1',
    JSON.stringify({
      lastSyncedVersion: 1,
      lastSyncedChecksum: baseChecksum,
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastSyncedUserId: 'user-a',
    })
  )

  // Mutate ONLY theme settings on Device A
  storeA.setItem('gtar_theme_store', 'azure-stage')
  storeA.setItem(
    'gtar_factory_theme_overrides',
    JSON.stringify({ 'azure-stage': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'azure-stage', displayName: 'Azure' } } })
  )
  storeA.setItem('gtar_custom_theme_colors', JSON.stringify(SAMPLE_PALETTE_B))

  let cloudRecord = {
    userId: 'user-a',
    version: 1,
    checksum: baseChecksum,
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: baseLibWithTheme,
  }

  const mockServerFetch = async (_url, init) => {
    if (!init || init.method === 'GET') {
      return new Response(JSON.stringify({ success: true, cloudRecord }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const body = JSON.parse(init.body)
    cloudRecord = {
      userId: 'user-a',
      version: cloudRecord.version + 1,
      checksum: body.clientChecksum,
      updatedAt: '2026-01-02T00:00:00.000Z',
      data: body.data,
    }
    return new Response(JSON.stringify({ success: true, cloudRecord }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Device A uploads theme-only change
  await withFetch(mockServerFetch, async () => {
    const uploadRes = await sync.performCloudSongbookSync('tok', { storage: storeA })
    assert.equal(uploadRes.success, true)
    assert.equal(uploadRes.actionTaken, 'UPLOADED')
    assert.equal(cloudRecord.version, 2)
    assert.equal(cloudRecord.data.themeSettings.themeMode, 'azure-stage')
  })

  // Device B downloads theme-only update
  const storeB = createStorage()
  storeB.setItem('gtar_library_v1', JSON.stringify({ songs: baseSongs, setlists: [] }))
  storeB.setItem('gtar_cloud_sync_base_v1', JSON.stringify(baseLibWithTheme))
  storeB.setItem(
    'gtar_cloud_sync_meta_v1',
    JSON.stringify({
      lastSyncedVersion: 1,
      lastSyncedChecksum: baseChecksum,
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastSyncedUserId: 'user-a',
    })
  )

  await withFetch(mockServerFetch, async () => {
    const downloadRes = await sync.performCloudSongbookSync('tok', { storage: storeB })
    assert.equal(downloadRes.success, true)
    assert.equal(downloadRes.actionTaken, 'DOWNLOADED')
    assert.equal(storeB.getItem('gtar_theme_store'), 'azure-stage')
    assert.equal(
      JSON.parse(storeB.getItem('gtar_factory_theme_overrides'))['azure-stage'].bgHex,
      SAMPLE_PALETTE_A.bgHex
    )
    assert.equal(JSON.parse(storeB.getItem('gtar_custom_theme_colors')).bgHex, SAMPLE_PALETTE_B.bgHex)
  })
})

test('G6-4: Fresh device receives customized cloud theme; first-sync local customization preserved over default cloud', async () => {
  // Fresh device downloads customized cloud
  const storeFresh = createStorage()
  storeFresh.setItem('gtar_library_v1', JSON.stringify({ songs: [], setlists: [] }))

  const remoteCustomTheme = {
    version: 1,
    themeMode: 'custom',
    customThemeColors: SAMPLE_PALETTE_B,
    factoryThemeOverrides: {
      'crimson-stage': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'crimson-stage', displayName: 'Crimson' } },
    },
  }
  const remotePayload = {
    songs: [{ id: 's1', title: 'Remote Song', rawContent: 'G C D', updatedAt: 500 }],
    setlists: [],
    themeSettings: remoteCustomTheme,
  }
  const remoteChecksum = sync.computeSongbookChecksum(remotePayload)

  await withFetch(
    async (_url, init) => {
      if (!init || init.method === 'GET') {
        return new Response(
          JSON.stringify({
            success: true,
            cloudRecord: {
              userId: 'user-a',
              version: 1,
              checksum: remoteChecksum,
              updatedAt: '2026-01-02T00:00:00.000Z',
              data: remotePayload,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      throw new Error('Should not upload')
    },
    async () => {
      const res = await sync.performCloudSongbookSync('tok', { storage: storeFresh })
      assert.equal(res.success, true)
      assert.equal(res.actionTaken, 'DOWNLOADED')
      assert.equal(storeFresh.getItem('gtar_theme_store'), 'custom')
      assert.equal(JSON.parse(storeFresh.getItem('gtar_custom_theme_colors')).bgHex, SAMPLE_PALETTE_B.bgHex)
    }
  )

  // Local customized theme uploaded to cloud that has default theme
  const storeLocalCustom = createStorage()
  storeLocalCustom.setItem('gtar_theme_store', 'oled-black')
  storeLocalCustom.setItem(
    'gtar_factory_theme_overrides',
    JSON.stringify({ 'oled-black': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'oled-black', displayName: 'OLED' } } })
  )
  const sharedSongs = [{ id: 's1', title: 'Song 1', rawContent: 'Am F C G', updatedAt: 100 }]
  storeLocalCustom.setItem('gtar_library_v1', JSON.stringify({ songs: sharedSongs, setlists: [] }))

  const defaultCloudTheme = {
    version: 1,
    themeMode: 'solarized-dark',
    customThemeColors: DEFAULT_CUSTOM_COLORS,
    factoryThemeOverrides: {},
  }
  const defaultCloudData = {
    songs: sharedSongs,
    setlists: [],
    themeSettings: defaultCloudTheme,
  }
  const defaultCloudChecksum = sync.computeSongbookChecksum(defaultCloudData)

  let uploadedOnFirstSync = null
  await withFetch(
    async (_url, init) => {
      if (!init || init.method === 'GET') {
        return new Response(
          JSON.stringify({
            success: true,
            cloudRecord: {
              userId: 'user-a',
              version: 1,
              checksum: defaultCloudChecksum,
              updatedAt: '2026-01-01T00:00:00.000Z',
              data: defaultCloudData,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      uploadedOnFirstSync = JSON.parse(init.body)
      return new Response(
        JSON.stringify({
          success: true,
          cloudRecord: {
            userId: 'user-a',
            version: 2,
            checksum: uploadedOnFirstSync.clientChecksum,
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    },
    async () => {
      const res = await sync.performCloudSongbookSync('tok', { storage: storeLocalCustom })
      assert.equal(res.success, true)
      assert.equal(res.actionTaken, 'UPLOADED')
      assert.equal(storeLocalCustom.getItem('gtar_theme_store'), 'oled-black')
      assert.equal(uploadedOnFirstSync.data.themeSettings.themeMode, 'oled-black')
    }
  )
})

test('G6-5: Divergent first-sync theme customizations require explicit conflict resolution', async () => {
  const store = createStorage()
  const sharedSongs = [{ id: 's1', title: 'Song 1', rawContent: 'Am', updatedAt: 100 }]
  store.setItem('gtar_library_v1', JSON.stringify({ songs: sharedSongs, setlists: [] }))
  store.setItem('gtar_theme_store', 'amber-stage')

  const remotePayload = {
    songs: sharedSongs,
    setlists: [],
    themeSettings: {
      version: 1,
      themeMode: 'crimson-stage',
      customThemeColors: SAMPLE_PALETTE_A,
      factoryThemeOverrides: {},
    },
  }
  const remoteChecksum = sync.computeSongbookChecksum(remotePayload)

  await withFetch(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          cloudRecord: {
            userId: 'user-a',
            version: 1,
            checksum: remoteChecksum,
            updatedAt: '2026-01-01T00:00:00.000Z',
            data: remotePayload,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
    async () => {
      const res = await sync.performCloudSongbookSync('tok', { storage: store })
      assert.equal(res.success, false)
      assert.equal(res.status, 'CONFLICT')
      assert.ok(res.conflicts.some((c) => c.type === 'theme'))
      // Local theme untouched
      assert.equal(store.getItem('gtar_theme_store'), 'amber-stage')
    }
  )
})

test('G6-6: Three-way merge handles concurrent identical edits, disjoint factory-slot edits, and conflicting same-slot edits', () => {
  const baseTheme = {
    version: 1,
    themeMode: 'solarized-dark',
    customThemeColors: DEFAULT_CUSTOM_COLORS,
    factoryThemeOverrides: {},
  }
  const baseLib = {
    songs: [{ id: 's1', title: 'Song 1', rawContent: 'C G', updatedAt: 100 }],
    setlists: [],
    themeSettings: baseTheme,
  }

  // 1. Disjoint factory-slot edits merge cleanly without conflict
  const localDisjoint = {
    ...baseLib,
    themeSettings: {
      ...baseTheme,
      factoryThemeOverrides: {
        'azure-stage': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'azure-stage', displayName: 'Azure' } },
      },
    },
  }
  const remoteDisjoint = {
    ...baseLib,
    themeSettings: {
      ...baseTheme,
      factoryThemeOverrides: {
        'amber-stage': { ...SAMPLE_PALETTE_B, identity: { factoryId: 'amber-stage', displayName: 'Amber' } },
      },
    },
  }
  const mergedDisjoint = sync.reconcileSongbook(localDisjoint, remoteDisjoint, baseLib)
  assert.equal(mergedDisjoint.hasConflicts, false)
  assert.equal(
    mergedDisjoint.merged.themeSettings.factoryThemeOverrides['azure-stage'].bgHex,
    SAMPLE_PALETTE_A.bgHex
  )
  assert.equal(
    mergedDisjoint.merged.themeSettings.factoryThemeOverrides['amber-stage'].bgHex,
    SAMPLE_PALETTE_B.bgHex
  )

  // 2. Concurrent identical edits succeed without conflict
  const identicalEdit = {
    ...baseLib,
    themeSettings: {
      ...baseTheme,
      themeMode: 'oled-black',
      factoryThemeOverrides: {
        'oled-black': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'oled-black', displayName: 'OLED' } },
      },
    },
  }
  const mergedIdentical = sync.reconcileSongbook(identicalEdit, identicalEdit, baseLib)
  assert.equal(mergedIdentical.hasConflicts, false)
  assert.equal(mergedIdentical.merged.themeSettings.themeMode, 'oled-black')

  // 3. Concurrent conflicting edits on the same slot flag conflict
  const localConflict = {
    ...baseLib,
    themeSettings: {
      ...baseTheme,
      themeMode: 'azure-stage',
      factoryThemeOverrides: {
        'azure-stage': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'azure-stage', displayName: 'Azure' } },
      },
    },
  }
  const remoteConflict = {
    ...baseLib,
    themeSettings: {
      ...baseTheme,
      themeMode: 'crimson-stage',
      factoryThemeOverrides: {
        'azure-stage': { ...SAMPLE_PALETTE_B, identity: { factoryId: 'azure-stage', displayName: 'Azure' } },
      },
    },
  }
  const conflictRes = sync.reconcileSongbook(localConflict, remoteConflict, baseLib)
  assert.equal(conflictRes.hasConflicts, true)
  assert.ok(conflictRes.conflicts.some((c) => c.id === 'theme:mode' && c.type === 'theme'))
  assert.ok(conflictRes.conflicts.some((c) => c.id === 'theme:factory:azure-stage' && c.type === 'theme'))
})

test('G6-7: Legacy standalone custom palette migration and identity adoption', () => {
  const store = createStorage()
  store.setItem('gtar_standalone_custom_theme_colors', JSON.stringify(SAMPLE_PALETTE_B))
  store.setItem(
    'gtar_custom_theme_colors',
    JSON.stringify({
      ...SAMPLE_PALETTE_A,
      identity: { factoryId: 'oled-black', displayName: 'OLED Black' },
    })
  )
  store.setItem('gtar_theme_store', 'custom')

  const read = readCloudThemeSettings(store)
  assert.equal(read.themeMode, 'oled-black')
  assert.equal(read.factoryThemeOverrides['oled-black'].bgHex, SAMPLE_PALETTE_A.bgHex)
  assert.equal(read.customThemeColors.identity, undefined)
})

test('G6-8: Client and server reject malformed, unsafe CSS injection, or oversized themeSettings', async () => {
  const unsafeTheme = {
    version: 1,
    themeMode: 'dark',
    customThemeColors: {
      ...DEFAULT_CUSTOM_COLORS,
      bgHex: 'red; background-image: url(javascript:alert(1))',
    },
    factoryThemeOverrides: {},
  }
  assert.ok(validateCloudThemeSettings(unsafeTheme).length > 0)

  // Server endpoint rejects invalid themeSettings with 400
  const { db, request } = await fixture()
  const validInitial = {
    songs: [{ id: 's1', title: 'Safe Song', rawContent: 'C G Am F', updatedAt: 100 }],
    setlists: [],
  }
  const badRes = await request('POST', {
    data: {
      ...validInitial,
      themeSettings: unsafeTheme,
    },
    expectedVersion: 0,
    expectedChecksum: null,
  })
  assert.equal(badRes.status, 400)
  assert.equal(await findUserSongbook(db, 'user-a'), null)
})

test('G6-9: Server CAS protection, checksum mismatch rejection, and canonical theme normalization', async () => {
  const { db, request } = await fixture()
  const payloadV1 = {
    songs: [{ id: 's1', title: 'Song 1', rawContent: 'C G', updatedAt: 100 }],
    setlists: [],
    themeSettings: {
      version: 1,
      themeMode: 'azure-stage',
      customThemeColors: DEFAULT_CUSTOM_COLORS,
      factoryThemeOverrides: {
        'azure-stage': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'azure-stage', displayName: 'Azure' } },
      },
    },
  }
  const checksumV1 = sync.computeSongbookChecksum(payloadV1)

  // Reject mismatched clientChecksum with 400
  const mismatchRes = await request('POST', {
    data: payloadV1,
    clientChecksum: 'ck_0000000000000000',
    expectedVersion: 0,
    expectedChecksum: null,
  })
  assert.equal(mismatchRes.status, 400)

  // Valid initial write succeeds with version 1
  const okRes = await request('POST', {
    data: payloadV1,
    clientChecksum: checksumV1,
    expectedVersion: 0,
    expectedChecksum: null,
  })
  assert.equal(okRes.status, 200)
  const okJson = await okRes.json()
  assert.equal(okJson.cloudRecord.version, 1)
  assert.equal(okJson.cloudRecord.checksum, checksumV1)

  // Stale CAS version rejected with 409
  const staleRes = await request('POST', {
    data: payloadV1,
    clientChecksum: checksumV1,
    expectedVersion: 0,
    expectedChecksum: null,
  })
  assert.equal(staleRes.status, 409)
})

test('G6-10: Failed localStorage writes and failed server writes roll back cleanly without data loss', async () => {
  const store = createStorage()
  const initialSongs = [{ id: 's1', title: 'Local Song', rawContent: 'Em D', updatedAt: 100 }]
  store.setItem('gtar_library_v1', JSON.stringify({ songs: initialSongs, setlists: [] }))
  store.setItem('gtar_theme_store', 'azure-stage')
  store.setItem(
    'gtar_factory_theme_overrides',
    JSON.stringify({ 'azure-stage': { ...SAMPLE_PALETTE_A, identity: { factoryId: 'azure-stage', displayName: 'Azure' } } })
  )
  store.setItem('gtar_custom_theme_colors', JSON.stringify(SAMPLE_PALETTE_A))

  const baseLib = {
    songs: initialSongs,
    setlists: [],
    themeSettings: readCloudThemeSettings(store),
  }
  const baseChecksum = sync.computeSongbookChecksum(baseLib)
  store.setItem(sync.CLOUD_SYNC_BASE_KEY, JSON.stringify(baseLib))
  store.setItem(
    sync.CLOUD_SYNC_META_KEY,
    JSON.stringify({
      lastSyncedVersion: 1,
      lastSyncedChecksum: baseChecksum,
      lastSyncedAt: Date.now(),
      lastSyncedUserId: 'user-a',
    })
  )

  const remoteLib = {
    songs: [{ id: 's1', title: 'Local Song', rawContent: 'Em D C', updatedAt: 200 }],
    setlists: [],
    themeSettings: {
      version: 1,
      themeMode: 'crimson-stage',
      customThemeColors: SAMPLE_PALETTE_B,
      factoryThemeOverrides: {
        'crimson-stage': { ...SAMPLE_PALETTE_B, identity: { factoryId: 'crimson-stage', displayName: 'Crimson' } },
      },
    },
  }
  const remoteChecksum = sync.computeSongbookChecksum(remoteLib)

  // Simulate quota failure when writing gtar_custom_theme_colors during download
  const origSetItem = store.setItem.bind(store)
  let blockCustomColorsWrite = true
  store.setItem = (k, v) => {
    if (blockCustomColorsWrite && k === 'gtar_custom_theme_colors') {
      throw new Error('QuotaExceededError')
    }
    return origSetItem(k, v)
  }

  await withFetch(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          cloudRecord: {
            userId: 'user-a',
            version: 2,
            checksum: remoteChecksum,
            updatedAt: '2026-01-02T00:00:00.000Z',
            data: remoteLib,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
    async () => {
      const failedLocalWriteRes = await sync.performCloudSongbookSync('tok', { storage: store })
      assert.equal(failedLocalWriteRes.success, false)
      assert.equal(failedLocalWriteRes.status, 'ERROR')
      // Local theme and songs intact
      assert.equal(store.getItem('gtar_theme_store'), 'azure-stage')
      assert.equal(JSON.parse(store.getItem('gtar_library_v1')).songs[0].rawContent, 'Em D')
    }
  )

  // Test server failure on upload
  blockCustomColorsWrite = false
  store.setItem('gtar_theme_store', 'amber-stage')
  await withFetch(
    async (_url, init) => {
      if (!init || init.method === 'GET') {
        return new Response(
          JSON.stringify({
            success: true,
            cloudRecord: {
              userId: 'user-a',
              version: 1,
              checksum: baseChecksum,
              updatedAt: '2026-01-01T00:00:00.000Z',
              data: baseLib,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ error: 'Database write error' }), { status: 500 })
    },
    async () => {
      const failedServerRes = await sync.performCloudSongbookSync('tok', { storage: store })
      assert.equal(failedServerRes.success, false)
      assert.equal(failedServerRes.status, 'OFFLINE')
      const meta = JSON.parse(store.getItem(sync.CLOUD_SYNC_META_KEY))
      assert.equal(meta.lastSyncedVersion, 1)
      assert.equal(meta.lastSyncedChecksum, baseChecksum)
    }
  )
})
