const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)

const settings = require('../src/utils/onlineSourceSettings.ts')
const search = require('../src/utils/onlineSearch.ts')

const memory = () => {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data }
}

const fakeProvider = (id, impl = async () => []) => ({ id, name: id.toUpperCase(), search: impl, fetchSheet: async () => ({ title: id }) })
const hit = (id, extra = {}) => ({ id, songName: `Song ${id}`, artistName: 'Artist', type: 'Chords', version: 1, votes: 1, rating: 5, tabUrl: `https://example.com/${id}`, ...extra })
const providerSettings = (ids) => ({
  version: 1,
  sources: ids.map(id => ({ kind: 'provider', id, name: id, providerId: id, enabled: true })),
})
const lookupOf = providers => id => providers.find(provider => provider.id === id)
const alwaysPermitted = () => true

test('#632 defaults keep Ultimate Guitar enabled and GuitarSongs.club disabled', () => {
  const defaults = settings.createDefaultSettings()
  assert.deepEqual(
    defaults.sources.map(source => [source.id, source.kind, source.enabled]),
    [
      ['ultimate-guitar', 'provider', true],
      ['guitarsongs', 'provider', false],
    ]
  )
  assert.equal('mode' in defaults, false)
})

test('#632 migration: missing, corrupt or wrong-version storage yields safe defaults', () => {
  const storage = memory()
  assert.deepEqual(settings.loadOnlineSourceSettings(storage).sources.map(s => [s.id, s.enabled]), [
    ['ultimate-guitar', true],
    ['guitarsongs', false],
  ])
  storage.setItem(settings.ONLINE_SOURCE_SETTINGS_KEY, '{not json')
  assert.equal(settings.loadOnlineSourceSettings(storage).sources[0].enabled, true)
  storage.setItem(settings.ONLINE_SOURCE_SETTINGS_KEY, JSON.stringify({ version: 99, sources: [] }))
  assert.equal(settings.loadOnlineSourceSettings(storage).sources[0].enabled, true)
  assert.equal(settings.loadOnlineSourceSettings(null).sources[0].enabled, true)
})

test('#632 migration: preserves UG enabled/disabled state and discards WorshipChords, custom shortcuts and mode', () => {
  const legacyUgEnabled = JSON.stringify({
    version: 1,
    mode: 'primary',
    sources: [
      { kind: 'shortcut', id: 'worshipchords', name: 'WorshipChords', url: 'https://worshipchords.com/', enabled: true },
      { kind: 'provider', id: 'ultimate-guitar', name: 'Ultimate Guitar', providerId: 'ultimate-guitar', enabled: true },
      { kind: 'shortcut', id: 'custom-2', name: 'My Site', url: 'https://example.org/', enabled: true },
    ],
  })
  const migratedEnabled = settings.parseStoredSettings(legacyUgEnabled)
  assert.deepEqual(migratedEnabled.sources.map(s => [s.id, s.enabled]), [
    ['ultimate-guitar', true],
    ['guitarsongs', false],
  ])
  assert.equal('mode' in migratedEnabled, false)

  const legacyUgDisabled = JSON.stringify({
    version: 1,
    mode: 'all',
    sources: [
      { kind: 'provider', id: 'ultimate-guitar', name: 'Ultimate Guitar', providerId: 'ultimate-guitar', enabled: false },
    ],
  })
  assert.deepEqual(settings.parseStoredSettings(legacyUgDisabled).sources.map(s => [s.id, s.enabled]), [
    ['ultimate-guitar', false],
    ['guitarsongs', false],
  ])

  const legacyUgRemoved = JSON.stringify({ version: 1, mode: 'all', sources: [] })
  assert.deepEqual(settings.parseStoredSettings(legacyUgRemoved).sources.map(s => [s.id, s.enabled]), [
    ['ultimate-guitar', false],
    ['guitarsongs', false],
  ])
})

test('#632 migration preserves explicit permitted GuitarSongs.club preference without enabling missing ones', () => {
  const explicit = JSON.stringify({
    version: 1,
    sources: [
      { kind: 'provider', id: 'ultimate-guitar', name: 'Ultimate Guitar', providerId: 'ultimate-guitar', enabled: true },
      { kind: 'provider', id: 'guitarsongs', name: 'GuitarSongs.club', providerId: 'guitarsongs', enabled: true },
    ],
  })
  const parsed = settings.parseStoredSettings(explicit)
  assert.deepEqual(parsed.sources.map(s => [s.id, s.enabled]), [
    ['ultimate-guitar', true],
    ['guitarsongs', true],
  ])
})

test('#632 setSourceEnabled and restoreDefaultSettings toggle permitted providers cleanly', () => {
  let current = settings.createDefaultSettings()
  current = settings.setSourceEnabled(current, 'ultimate-guitar', false)
  assert.equal(current.sources[0].enabled, false)
  current = settings.setSourceEnabled(current, 'guitarsongs', true)
  assert.equal(current.sources[1].enabled, true)
  const restored = settings.restoreDefaultSettings()
  assert.deepEqual(restored.sources.map(s => [s.id, s.enabled]), [
    ['ultimate-guitar', true],
    ['guitarsongs', false],
  ])
})

test('#632 unavailable storage never throws', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(settings.loadOnlineSourceSettings(broken).sources[0].id, 'ultimate-guitar')
  assert.equal(settings.saveOnlineSourceSettings(settings.createDefaultSettings(), broken), false)
  assert.equal(settings.saveOnlineSourceSettings(settings.createDefaultSettings(), null), false)
})

test('#632 getSearchLinks always returns empty array after shortcut removal', () => {
  assert.deepEqual(settings.getSearchLinks(settings.createDefaultSettings(), 'relentless'), [])
})

test('#632 searchable providers filter by enabled AND permitted', () => {
  const ug = fakeProvider('ultimate-guitar')
  const gs = fakeProvider('guitarsongs')
  const lookup = lookupOf([ug, gs])
  const bothEnabled = providerSettings(['ultimate-guitar', 'guitarsongs'])

  assert.deepEqual(
    search.getSearchableProviders(bothEnabled, lookup, id => id === 'ultimate-guitar').map(p => p.id),
    ['ultimate-guitar']
  )
  assert.deepEqual(
    search.getSearchableProviders(bothEnabled, lookup, alwaysPermitted).map(p => p.id),
    ['ultimate-guitar', 'guitarsongs']
  )
  assert.deepEqual(
    search.getSearchableProviders(bothEnabled, lookup, () => false),
    []
  )
})

test('#632 concurrent search merges results, isolates failures and timeouts, and tags providers', async () => {
  const ug = fakeProvider('ultimate-guitar', async () => [hit('1'), hit('1'), hit('2')])
  const gs = fakeProvider('guitarsongs', async () => [hit('1')])
  const outcome = await search.searchConfiguredSources('q', providerSettings(['ultimate-guitar', 'guitarsongs']), {
    lookup: lookupOf([ug, gs]),
    permitted: alwaysPermitted,
  })
  assert.deepEqual(outcome.results.map(item => `${item.providerId}:${item.id}`), [
    'ultimate-guitar:1',
    'ultimate-guitar:2',
    'guitarsongs:1',
  ])

  const broken = fakeProvider('ultimate-guitar', async () => { throw new search.OnlineSearchError('WAF', { status: 403, code: 'RESTRICTED' }) })
  const slow = fakeProvider('slow', () => new Promise(() => {}))
  const good = fakeProvider('guitarsongs', async () => [hit('7')])
  const partial = await search.searchConfiguredSources('q', providerSettings(['ultimate-guitar', 'slow', 'guitarsongs']), {
    lookup: lookupOf([broken, slow, good]),
    permitted: alwaysPermitted,
    timeoutMs: 40,
  })
  assert.deepEqual(partial.results.map(item => item.id), ['7'])
  assert.deepEqual(partial.errors.map(e => [e.providerId, e.code]), [
    ['ultimate-guitar', 'RESTRICTED'],
    ['slow', 'TIMEOUT'],
  ])
  assert.equal(search.summarizeSearchErrors(partial), null)
})

test('#632 neither provider enabled or permitted yields quiet local-only empty outcome', async () => {
  let called = false
  const never = fakeProvider('ultimate-guitar', async () => { called = true; return [] })
  const disabled = { version: 1, sources: [{ kind: 'provider', id: 'ultimate-guitar', name: 'Ultimate Guitar', providerId: 'ultimate-guitar', enabled: false }] }
  const outcome = await search.searchConfiguredSources('q', disabled, { lookup: lookupOf([never]), permitted: alwaysPermitted })
  assert.deepEqual(outcome, { results: [], errors: [], searchedProviderIds: [] })
  assert.equal(called, false)
})

test('#632 Header uses configured-sources search and keeps global ON/OFF guard', () => {
  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.match(header, /searchConfiguredSources\(trimmed, onlineSourceSettings\)/)
  assert.match(header, /if \(!onlineSourcesEnabled \|\| !trimmed \|\| trimmed\.length < 2\)/)
  assert.doesNotMatch(header, /searchOnlineChords\(/)
})
