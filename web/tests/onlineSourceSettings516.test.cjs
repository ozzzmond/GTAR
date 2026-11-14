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

const ok = result => { assert.equal(result.ok, true, result.error); return result.value }
const fail = result => { assert.equal(result.ok, false); return result.error }

const fakeProvider = (id, impl = async () => []) => ({ id, name: id.toUpperCase(), search: impl, fetchSheet: async () => ({ title: id }) })
const hit = (id, extra = {}) => ({ id, songName: `Song ${id}`, artistName: 'Artist', type: 'Chords', version: 1, votes: 1, rating: 5, tabUrl: `https://example.com/${id}`, ...extra })
const providerSettings = (ids, mode = 'all') => ({
  version: 1, mode, sources: ids.map(id => ({ kind: 'provider', id, name: id, providerId: id, enabled: true })),
})
const lookupOf = providers => id => providers.find(provider => provider.id === id)

test('#516 defaults keep Ultimate Guitar enabled and search all', () => {
  const defaults = settings.createDefaultSettings()
  assert.equal(defaults.mode, 'all')
  assert.deepEqual(defaults.sources.map(source => [source.id, source.kind, source.enabled]), [['ultimate-guitar', 'provider', true]])
})

test('#516 migration: nothing stored or corrupt storage keeps the UG default for existing users', () => {
  const storage = memory()
  assert.equal(settings.loadOnlineSourceSettings(storage).sources[0].id, 'ultimate-guitar')
  storage.setItem(settings.ONLINE_SOURCE_SETTINGS_KEY, '{not json')
  assert.equal(settings.loadOnlineSourceSettings(storage).sources[0].id, 'ultimate-guitar')
  storage.setItem(settings.ONLINE_SOURCE_SETTINGS_KEY, JSON.stringify({ version: 99, sources: [] }))
  assert.equal(settings.loadOnlineSourceSettings(storage).sources[0].id, 'ultimate-guitar')
  assert.equal(settings.loadOnlineSourceSettings(null).sources[0].id, 'ultimate-guitar')
})

test('#516 removing UG persists across reloads and is never silently re-added', () => {
  const storage = memory()
  const removed = settings.removeSource(settings.loadOnlineSourceSettings(storage), 'ultimate-guitar')
  assert.equal(settings.saveOnlineSourceSettings(removed, storage), true)
  const reloaded = settings.loadOnlineSourceSettings(storage)
  assert.deepEqual(reloaded.sources, [])
  assert.equal(settings.loadOnlineSourceSettings(storage).sources.some(source => source.id === 'ultimate-guitar'), false)
})

test('#516 manual restore defaults and manual re-add bring UG back', () => {
  const empty = settings.removeSource(settings.createDefaultSettings(), 'ultimate-guitar')
  assert.equal(settings.restoreDefaultSettings().sources[0].id, 'ultimate-guitar')
  const added = ok(settings.addSupportedSource(empty, 'ultimate-guitar'))
  assert.equal(added.sources[0].kind, 'provider')
  assert.match(fail(settings.addSupportedSource(added, 'ultimate-guitar')), /already/)
  assert.match(fail(settings.addSupportedSource(added, 'nope')), /Unknown/)
})

test('#516 WorshipChords is only an external shortcut candidate, never an integrated provider', () => {
  const supported = settings.SUPPORTED_SOURCES.find(source => source.id === 'worshipchords')
  assert.equal(supported.kind, 'shortcut')
  assert.equal(supported.defaultEnabled, false)
  const added = ok(settings.addSupportedSource(settings.createDefaultSettings(), 'worshipchords'))
  const entry = added.sources.find(source => source.id === 'worshipchords')
  assert.equal(entry.kind, 'shortcut')
  assert.equal(search.getSearchableProviders(added, () => undefined).length, 0)
})

test('#516 URL validation accepts http(s) and rejects unsafe schemes, credentials and junk', () => {
  assert.equal(ok(settings.validateSourceUrl('example.com/songs')), 'https://example.com/songs')
  assert.equal(ok(settings.validateSourceUrl('  http://example.com ')), 'http://example.com/')
  for (const bad of ['', '   ', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.com', 'ftp://example.com',
    'https://user:pass@example.com', 'localhost', 'not a url', null, undefined, 42, `https://example.com/${'a'.repeat(2100)}`]) {
    assert.equal(settings.validateSourceUrl(bad).ok, false, `should reject ${String(bad).slice(0, 30)}`)
  }
})

test('#516 custom shortcuts can be added, edited and removed with validation and de-duplication', () => {
  let current = settings.createDefaultSettings()
  current = ok(settings.addShortcut(current, { name: '  My   Church  Site ', url: 'church.example.org' }))
  const added = current.sources.at(-1)
  assert.deepEqual([added.kind, added.name, added.url, added.enabled], ['shortcut', 'My Church Site', 'https://church.example.org/', true])
  assert.match(fail(settings.addShortcut(current, { url: 'https://church.example.org/' })), /already/)
  assert.match(fail(settings.addShortcut(current, { url: 'javascript:alert(1)' })), /http/)
  const unnamed = ok(settings.addShortcut(current, { url: 'https://www.chords.example.net/x' }))
  assert.equal(unnamed.sources.at(-1).name, 'chords.example.net')
  const edited = ok(settings.updateShortcut(unnamed, added.id, { name: 'Renamed', url: 'https://other.example.org' }))
  assert.deepEqual(edited.sources.find(source => source.id === added.id).url, 'https://other.example.org/')
  assert.match(fail(settings.updateShortcut(edited, added.id, { name: 'x', url: 'ftp://bad.example.org' })), /http/)
  assert.match(fail(settings.updateShortcut(edited, 'ultimate-guitar', { url: 'https://x.example.org' })), /not found/)
  assert.match(fail(settings.updateShortcut(edited, added.id, { url: unnamed.sources.at(-1).url })), /already/)
  assert.equal(settings.removeSource(edited, added.id).sources.some(source => source.id === added.id), false)
})

test('#516 custom ids stay unique after removals and the list is capped', () => {
  let current = settings.createDefaultSettings()
  current = ok(settings.addShortcut(current, { url: 'a.example.org' }))
  current = ok(settings.addShortcut(current, { url: 'b.example.org' }))
  current = settings.removeSource(current, current.sources[1].id)
  current = ok(settings.addShortcut(current, { url: 'c.example.org' }))
  assert.equal(new Set(current.sources.map(source => source.id)).size, current.sources.length)
  let full = settings.createDefaultSettings()
  for (let index = 0; full.sources.length < settings.MAX_SOURCES; index += 1) full = ok(settings.addShortcut(full, { url: `s${index}.example.org` }))
  assert.match(fail(settings.addShortcut(full, { url: 'extra.example.org' })), /full/)
})

test('#516 priority, enable/disable and search mode are deterministic', () => {
  let current = ok(settings.addShortcut(settings.createDefaultSettings(), { url: 'a.example.org' }))
  const shortcutId = current.sources[1].id
  assert.equal(settings.moveSource(current, 'ultimate-guitar', -1), current)
  assert.equal(settings.moveSource(current, shortcutId, 1), current)
  current = settings.moveSource(current, shortcutId, -1)
  assert.deepEqual(current.sources.map(source => source.id), [shortcutId, 'ultimate-guitar'])
  current = settings.setSourceEnabled(current, 'ultimate-guitar', false)
  assert.equal(current.sources.find(source => source.id === 'ultimate-guitar').enabled, false)
  assert.equal(settings.setSearchMode(current, 'primary').mode, 'primary')
  assert.equal(settings.setSearchMode(current, 'all'), current)
})

test('#516 sanitizing stored data drops unsafe or duplicate entries and bounds the list', () => {
  const clean = settings.sanitizeSettings({
    version: 1, mode: 'weird', sources: [
      { kind: 'provider', id: 'ultimate-guitar', name: 'Ultimate Guitar', providerId: 'ultimate-guitar', enabled: true },
      { kind: 'provider', id: 'ultimate-guitar', name: 'Dup', providerId: 'ultimate-guitar', enabled: true },
      { kind: 'shortcut', id: 'bad', name: 'Bad', url: 'javascript:alert(1)', enabled: true },
      { kind: 'shortcut', id: 'good', name: 'Good', url: 'https://good.example.org', enabled: false },
      { kind: 'provider', id: 'x', name: 'No provider id' },
      'junk', null,
    ],
  })
  assert.equal(clean.mode, 'all')
  assert.deepEqual(clean.sources.map(source => [source.id, source.enabled]), [['ultimate-guitar', true], ['good', false]])
  assert.equal(settings.sanitizeSettings({ version: 1, sources: Array.from({ length: 100 }, (_, index) => ({ kind: 'shortcut', id: `s${index}`, name: 's', url: `https://s${index}.example.org` })) }).sources.length, settings.MAX_SOURCES)
})

test('#516 empty list is a valid persisted state', () => {
  const storage = memory()
  settings.saveOnlineSourceSettings({ version: 1, mode: 'all', sources: [] }, storage)
  assert.deepEqual(settings.loadOnlineSourceSettings(storage).sources, [])
})

test('#516 unavailable storage never throws', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(settings.loadOnlineSourceSettings(broken).sources[0].id, 'ultimate-guitar')
  assert.equal(settings.saveOnlineSourceSettings(settings.createDefaultSettings(), broken), false)
  assert.equal(settings.saveOnlineSourceSettings(settings.createDefaultSettings(), null), false)
})

test('#516 searchable providers skip shortcuts, disabled and unregistered entries; primary keeps the first', () => {
  const a = fakeProvider('a')
  const b = fakeProvider('b')
  const lookup = lookupOf([a, b])
  const mixed = {
    version: 1, mode: 'all', sources: [
      { kind: 'shortcut', id: 's', name: 's', url: 'https://s.example.org/', enabled: true },
      { kind: 'provider', id: 'ghost', name: 'ghost', providerId: 'ghost', enabled: true },
      { kind: 'provider', id: 'b', name: 'b', providerId: 'b', enabled: true },
      { kind: 'provider', id: 'a', name: 'a', providerId: 'a', enabled: false },
    ],
  }
  assert.deepEqual(search.getSearchableProviders(mixed, lookup).map(provider => provider.id), ['b'])
  const both = providerSettings(['b', 'a'])
  assert.deepEqual(search.getSearchableProviders(both, lookup).map(provider => provider.id), ['b', 'a'])
  assert.deepEqual(search.getSearchableProviders({ ...both, mode: 'primary' }, lookup).map(provider => provider.id), ['b'])
  assert.deepEqual(search.getSearchableProviders({ ...both, sources: [] }, lookup), [])
})

test('#516 default settings return the Ultimate Guitar results unchanged and tag the provider', async () => {
  const ug = fakeProvider('ultimate-guitar', async () => [hit('1'), hit('2')])
  const outcome = await search.searchConfiguredSources('toxic', settings.createDefaultSettings(), { lookup: lookupOf([ug]) })
  assert.deepEqual(outcome.results.map(item => item.id), ['1', '2'])
  assert.ok(outcome.results.every(item => item.providerId === 'ultimate-guitar'))
  assert.deepEqual(outcome.errors, [])
  assert.deepEqual(outcome.searchedProviderIds, ['ultimate-guitar'])
})

test('#516 search all merges in priority order and de-duplicates per provider', async () => {
  const first = fakeProvider('first', async () => [hit('1'), hit('1'), hit('2')])
  const second = fakeProvider('second', async () => [hit('1')])
  const outcome = await search.searchConfiguredSources('q', providerSettings(['second', 'first']), { lookup: lookupOf([first, second]) })
  assert.deepEqual(outcome.results.map(item => `${item.providerId}:${item.id}`), ['second:1', 'first:1', 'first:2'])
})

test('#516 primary only searches just the first enabled provider with no fallback', async () => {
  const calls = []
  const primary = fakeProvider('primary', async () => { calls.push('primary'); throw new search.OnlineSearchError('boom', { code: 'NETWORK_ERROR' }) })
  const other = fakeProvider('other', async () => { calls.push('other'); return [hit('9')] })
  const outcome = await search.searchConfiguredSources('q', providerSettings(['primary', 'other'], 'primary'), { lookup: lookupOf([primary, other]) })
  assert.deepEqual(calls, ['primary'])
  assert.deepEqual(outcome.results, [])
  assert.deepEqual(outcome.errors.map(error => [error.providerId, error.code]), [['primary', 'NETWORK_ERROR']])
})

test('#516 a failing provider does not block results from the others', async () => {
  const broken = fakeProvider('broken', async () => { throw new search.OnlineSearchError('Search error (500)', { status: 500 }) })
  const sync = fakeProvider('sync', () => { throw new Error('sync boom') })
  const good = fakeProvider('good', async () => [hit('7')])
  const outcome = await search.searchConfiguredSources('q', providerSettings(['broken', 'sync', 'good']), { lookup: lookupOf([broken, sync, good]) })
  assert.deepEqual(outcome.results.map(item => item.id), ['7'])
  assert.deepEqual(outcome.errors.map(error => [error.providerId, error.code]), [['broken', 'UNKNOWN'], ['sync', 'UNKNOWN']])
  assert.equal(search.summarizeSearchErrors(outcome), null)
})

test('#516 a slow provider times out without delaying the others', async () => {
  const slow = fakeProvider('slow', () => new Promise(() => {}))
  const good = fakeProvider('good', async () => [hit('1')])
  const started = Date.now()
  const outcome = await search.searchConfiguredSources('q', providerSettings(['slow', 'good']), { lookup: lookupOf([slow, good]), timeoutMs: 40 })
  assert.ok(Date.now() - started < 1000)
  assert.deepEqual(outcome.results.map(item => item.id), ['1'])
  assert.deepEqual(outcome.errors.map(error => [error.providerId, error.code]), [['slow', 'TIMEOUT']])
})

test('#516 no searchable providers is a quiet empty result with no network calls', async () => {
  let called = false
  const never = fakeProvider('never', async () => { called = true; return [] })
  const empty = await search.searchConfiguredSources('q', { version: 1, mode: 'all', sources: [] }, { lookup: lookupOf([never]) })
  assert.deepEqual(empty, { results: [], errors: [], searchedProviderIds: [] })
  const shortcutOnly = await search.searchConfiguredSources('q', ok(settings.addShortcut({ version: 1, mode: 'all', sources: [] }, { url: 'a.example.org' })), { lookup: lookupOf([never]) })
  assert.deepEqual(shortcutOnly.searchedProviderIds, [])
  assert.equal(called, false)
  assert.equal(search.summarizeSearchErrors(empty), null)
})

test('#516 duplicate provider errors collapse into one message only when nothing was found', async () => {
  const one = fakeProvider('one', async () => { throw new search.OnlineSearchError('Network error — unable to reach search service', { code: 'NETWORK_ERROR' }) })
  const two = fakeProvider('two', async () => { throw new search.OnlineSearchError('Network error — unable to reach search service', { code: 'NETWORK_ERROR' }) })
  const outcome = await search.searchConfiguredSources('q', providerSettings(['one', 'two']), { lookup: lookupOf([one, two]) })
  assert.equal(search.summarizeSearchErrors(outcome), 'Network error — unable to reach search service')
})

test('#516 sheet retrieval routes to the provider that returned the result', async () => {
  const custom = fakeProvider('custom-516')
  search.registerSearchProvider(custom)
  try {
    assert.equal((await search.fetchOnlineChordSheet(hit('1', { providerId: 'custom-516' }))).title, 'custom-516')
  } finally {
    search.resetSearchProvider()
  }
})

test('#516 Header uses the configured-sources search and keeps the global ON/OFF guard', () => {
  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.match(header, /searchConfiguredSources\(trimmed, onlineSourceSettings\)/)
  assert.match(header, /if \(!onlineSourcesEnabled \|\| !trimmed \|\| trimmed\.length < 2\)/)
  assert.doesNotMatch(header, /searchOnlineChords\(/)
})
