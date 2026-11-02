const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

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
const sync = require('../src/utils/cloudBackupFormat.ts')
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
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GTAR-Library-Owner': user.id },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    })
  return { db, request, token }
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
