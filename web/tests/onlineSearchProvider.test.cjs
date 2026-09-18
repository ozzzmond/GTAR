const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Transpile TypeScript modules on the fly
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const {
  searchOnlineChords,
  fetchOnlineChordSheet,
  OnlineSearchError,
  getActiveSearchProvider,
  setActiveSearchProvider,
  registerSearchProvider,
  resetSearchProvider,
  getRegisteredSearchProviders,
  UltimateGuitarProvider,
} = require('../src/utils/onlineSearch.ts')

const {
  validateSearchQuery,
  validateTabUrl,
  sanitizeUgMarkup,
  parseSearchResults,
  parseTabSheet,
  ALLOWED_UG_HOSTS,
  MAX_URL_LENGTH,
  MAX_QUERY_LENGTH,
} = require('../src/utils/ugCore.ts')

test.afterEach(() => {
  resetSearchProvider()
})

// ---------------------------------------------------------------------------
// 1. Active Provider Routing & Deterministic Selection
// ---------------------------------------------------------------------------

test('PROVIDER_BOUNDARY: Active provider defaults to Ultimate Guitar and routes search and sheet retrieval', async () => {
  resetSearchProvider()
  const active = getActiveSearchProvider()
  assert.equal(active.id, 'ultimate-guitar')
  assert.equal(active.name, 'Ultimate Guitar')
  assert.ok(active instanceof UltimateGuitarProvider)

  // Prove searchOnlineChords delegates to active provider
  const originalFetch = global.fetch
  let searchCalled = false
  let tabCalled = false

  try {
    global.fetch = async (url) => {
      const urlStr = String(url)
      if (urlStr.startsWith('/api/ug-search')) {
        searchCalled = true
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            results: [
              {
                id: 501,
                songName: 'Blackbird',
                artistName: 'The Beatles',
                type: 'Chords',
                version: 1,
                votes: 8000,
                rating: 4.9,
                tabUrl: 'https://tabs.ultimate-guitar.com/tab/the-beatles/blackbird-chords-501',
                tonality: 'G',
              },
            ],
          }),
        }
      }
      if (urlStr.startsWith('/api/ug-tab')) {
        tabCalled = true
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sheet: {
              title: 'Blackbird',
              artist: 'The Beatles',
              key: 'G',
              capo: 'No Capo',
              bpm: '94',
              format: 'CHORD_PRO',
              rawContent: '{title: Blackbird}\n[G]Blackbird singing in the dead of night',
              sourceUrl: 'https://tabs.ultimate-guitar.com/tab/the-beatles/blackbird-chords-501',
            },
          }),
        }
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`)
    }

    const results = await searchOnlineChords('Blackbird Beatles')
    assert.equal(searchCalled, true, 'Active provider search must be invoked')
    assert.equal(results.length, 1)
    assert.equal(results[0].songName, 'Blackbird')

    const sheet = await fetchOnlineChordSheet(results[0])
    assert.equal(tabCalled, true, 'Active provider fetchSheet must be invoked')
    assert.equal(sheet.title, 'Blackbird')
    assert.equal(sheet.key, 'G')
  } finally {
    global.fetch = originalFetch
  }
})

test('PROVIDER_SELECTION: Explicit and deterministic provider activation and registration', () => {
  resetSearchProvider()

  // Setting unknown provider ID throws explicit error
  assert.throws(
    () => setActiveSearchProvider('non-existent-provider'),
    /Cannot activate unknown provider ID: "non-existent-provider"/
  )

  // Registering an extensible provider
  const mockCustomProvider = {
    id: 'custom-community',
    name: 'Custom Community Provider',
    search: async () => [],
    fetchSheet: async () => ({
      title: 'Custom',
      artist: 'Artist',
      key: 'C',
      capo: 'No Capo',
      bpm: '120',
      format: 'CHORD_PRO',
      rawContent: '{title: Custom}',
      sourceUrl: 'https://custom.example.com',
    }),
  }

  registerSearchProvider(mockCustomProvider)
  setActiveSearchProvider('custom-community')

  const active = getActiveSearchProvider()
  assert.equal(active.id, 'custom-community')
  assert.equal(active.name, 'Custom Community Provider')

  // Reset restores default Ultimate Guitar
  resetSearchProvider()
  assert.equal(getActiveSearchProvider().id, 'ultimate-guitar')
})

// ---------------------------------------------------------------------------
// 2. Normalized Contract Compliance
// ---------------------------------------------------------------------------

test('CONTRACT: Normalized search result contract adheres to required schema', async () => {
  const originalFetch = global.fetch
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        results: [
          {
            id: 1234,
            songName: 'Wonderwall',
            artistName: 'Oasis',
            type: 'Chords',
            version: 2,
            votes: 15400,
            rating: 4.88,
            tabUrl: 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1234',
            tonality: 'F#m',
          },
        ],
      }),
    })

    const results = await searchOnlineChords('Wonderwall')
    assert.equal(results.length, 1)
    const r = results[0]

    // Verify all normalized search fields
    assert.equal(typeof r.id, 'number')
    assert.equal(r.songName, 'Wonderwall')
    assert.equal(r.artistName, 'Oasis')
    assert.equal(r.type, 'Chords')
    assert.equal(r.version, 2)
    assert.equal(r.votes, 15400)
    assert.equal(r.rating, 4.88)
    assert.equal(r.tabUrl, 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1234')
    assert.equal(r.tonality, 'F#m')
  } finally {
    global.fetch = originalFetch
  }
})

test('CONTRACT: Normalized sheet result contract adheres to required schema', async () => {
  const originalFetch = global.fetch
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        sheet: {
          title: 'Wonderwall',
          artist: 'Oasis',
          key: 'Em',
          capo: 'Capo 2',
          bpm: '88',
          format: 'CHORD_PRO',
          rawContent: '{title: Wonderwall}\n[Em7]Today is gonna be the day',
          sourceUrl: 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1234',
        },
      }),
    })

    const sheet = await fetchOnlineChordSheet({
      id: 1234,
      songName: 'Wonderwall',
      artistName: 'Oasis',
      type: 'Chords',
      version: 2,
      votes: 15400,
      rating: 4.88,
      tabUrl: 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1234',
    })

    assert.equal(sheet.title, 'Wonderwall')
    assert.equal(sheet.artist, 'Oasis')
    assert.equal(sheet.key, 'Em')
    assert.equal(sheet.capo, 'Capo 2')
    assert.equal(sheet.bpm, '88')
    assert.equal(sheet.format, 'CHORD_PRO')
    assert.match(sheet.rawContent, /Today is gonna be the day/)
    assert.equal(sheet.sourceUrl, 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1234')
  } finally {
    global.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// 3. Structured Failure Semantics & Zero Automatic Failover
// ---------------------------------------------------------------------------

test('FAILOVER_SAFETY: Active provider error throws directly with zero automatic failover or fallback chain', async () => {
  resetSearchProvider()

  // Register a secondary provider to confirm it is NEVER called when active provider fails
  let secondarySearchCalled = false
  const mockSecondary = {
    id: 'backup-provider',
    name: 'Backup Provider',
    search: async () => {
      secondarySearchCalled = true
      return []
    },
    fetchSheet: async () => {
      throw new Error('Should never reach secondary')
    },
  }
  registerSearchProvider(mockSecondary)

  const originalFetch = global.fetch
  const originalWarn = console.warn
  console.warn = () => {}

  try {
    global.fetch = async () => {
      throw new Error('Connection reset by peer')
    }

    await assert.rejects(
      searchOnlineChords('Test Query'),
      (err) => {
        assert.equal(err.name, 'OnlineSearchError')
        assert.equal(err.code, 'NETWORK_ERROR')
        assert.match(err.message, /Network error — unable to reach search service/)
        return true
      }
    )

    // Secondary provider must NOT have been called (no automatic failover)
    assert.equal(secondarySearchCalled, false, 'No automatic failover to registered secondary providers permitted')
  } finally {
    global.fetch = originalFetch
    console.warn = originalWarn
    resetSearchProvider()
  }
})

test('ERRORS: Preserves distinct HTTP 400, 403, 429, 502, 504 and network structured error codes', async () => {
  resetSearchProvider()
  const originalFetch = global.fetch
  const originalWarn = console.warn
  console.warn = () => {}

  const cases = [
    { status: 400, code: 'INVALID_QUERY', msg: 'Invalid search query' },
    { status: 403, code: 'RESTRICTED', msg: 'Online search temporarily restricted' },
    { status: 429, code: 'RATE_LIMITED', msg: 'Search rate limit reached — please wait a moment' },
    { status: 502, code: 'PARSE_ERROR', msg: 'Unable to parse online search results' },
    { status: 504, code: 'TIMEOUT', msg: 'Online search timed out — please try again' },
  ]

  try {
    for (const c of cases) {
      global.fetch = async () => ({
        ok: false,
        status: c.status,
        json: async () => ({ error: 'Error payload' }),
      })

      await assert.rejects(
        searchOnlineChords('Stand By Me'),
        (err) => {
          assert.equal(err.name, 'OnlineSearchError')
          assert.equal(err.status, c.status)
          assert.equal(err.code, c.code)
          assert.equal(err.message, c.msg)
          return true
        },
        `HTTP ${c.status} must reject with code ${c.code} without fallback`
      )
    }
  } finally {
    global.fetch = originalFetch
    console.warn = originalWarn
  }
})

// ---------------------------------------------------------------------------
// 4. Offline Handling & Curated Fallback Guards
// ---------------------------------------------------------------------------

test('OFFLINE_GUARDS: Curated catalog offline showcase works, but live search failures NEVER fall back to catalog', async () => {
  resetSearchProvider()
  const originalFetch = global.fetch
  const originalWarn = console.warn
  console.warn = () => {}

  const originalOnLine = typeof navigator !== 'undefined' ? navigator.onLine : undefined
  try {
    // 1. Offline search: navigator.onLine = false
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true })
    } else {
      global.navigator = { onLine: false }
    }

    let fetchCalled = false
    global.fetch = async () => {
      fetchCalled = true
      throw new Error('Should not reach fetch when offline')
    }

    const offlineResults = await searchOnlineChords('Toxic')
    assert.equal(fetchCalled, false)
    assert.equal(offlineResults.length, 1)
    assert.equal(offlineResults[0].songName, 'Toxic')
    assert.equal(offlineResults[0].offlineExample, true)

    // Non-curated query returns [] without network call
    const unknownResults = await searchOnlineChords('Completely Unknown Song')
    assert.deepEqual(unknownResults, [])

    // 2. Online search: navigator.onLine = true, network fails
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true })
    } else {
      global.navigator = { onLine: true }
    }

    global.fetch = async () => {
      throw new Error('Connection refused')
    }

    // Query for 'Toxic' (exists in CURATED_CATALOG), but online fetch fails
    await assert.rejects(
      searchOnlineChords('Toxic'),
      (err) => {
        assert.equal(err.name, 'OnlineSearchError')
        assert.equal(err.code, 'NETWORK_ERROR')
        return true
      },
      'Live search failure must NEVER fall back to curated catalog'
    )
  } finally {
    global.fetch = originalFetch
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true, writable: true })
    }
    console.warn = originalWarn
  }
})

// ---------------------------------------------------------------------------
// 5. Security Guards Verification
// ---------------------------------------------------------------------------

test('SECURITY_GUARDS: SSRF protection, URL validation, and query bounds are strictly preserved', () => {
  // Query bounds
  assert.equal(MAX_QUERY_LENGTH, 200)
  assert.equal(validateSearchQuery('a'.repeat(200)).valid, true)
  assert.equal(validateSearchQuery('a'.repeat(201)).valid, false)

  // Tab URL length bounds
  assert.equal(MAX_URL_LENGTH, 2048)
  assert.equal(validateTabUrl('https://tabs.ultimate-guitar.com/' + 'a'.repeat(2048)).valid, false)

  // SSRF protocol & host guards
  assert.equal(validateTabUrl('http://tabs.ultimate-guitar.com/tab/test').status, 403)
  assert.equal(validateTabUrl('https://attacker.com/tab/test').status, 403)
  assert.equal(validateTabUrl('https://127.0.0.1/tab/test').status, 403)
  assert.equal(validateTabUrl('https://tabs.ultimate-guitar.com:8443/tab/test').status, 403)

  // Legitimate Ultimate Guitar hosts accepted
  for (const host of ALLOWED_UG_HOSTS) {
    const validUrl = `https://${host}/tab/test-artist/test-song-chords-123`
    assert.equal(validateTabUrl(validUrl).valid, true)
  }

  // Markup sanitization
  assert.equal(sanitizeUgMarkup('[ch]Am[/ch] [ch]F[/ch]'), 'Am F')
})

// ---------------------------------------------------------------------------
// 6. Source Cleanliness
// ---------------------------------------------------------------------------

test('SOURCE_CLEANLINESS: Zero deprecated proxy paths in provider implementation', () => {
  const files = [
    path.resolve(__dirname, '../src/utils/onlineSearch.ts'),
    path.resolve(__dirname, '../src/utils/onlineSearchProvider.ts'),
  ]

  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8')
    assert.equal(content.includes('corsproxy.io'), false, `${path.basename(f)} must not contain corsproxy.io`)
    assert.equal(content.includes('codetabs'), false, `${path.basename(f)} must not contain codetabs`)
    assert.equal(content.includes('PROXY_CANDIDATES'), false, `${path.basename(f)} must not contain PROXY_CANDIDATES`)
    assert.equal(content.includes('fetchHtml'), false, `${path.basename(f)} must not contain fetchHtml`)
  }
})
