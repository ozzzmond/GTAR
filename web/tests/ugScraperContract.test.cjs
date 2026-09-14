const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
  validateSearchQuery,
  validateTabUrl,
  extractJsStore,
  sanitizeUgMarkup,
  parseSearchResults,
  parseTabSheet,
  ALLOWED_UG_HOSTS,
  MAX_URL_LENGTH,
  MAX_QUERY_LENGTH,
} = require('../src/utils/ugCore.ts')

// ---------------------------------------------------------------------------
// 1. Search Query Input Validation
// ---------------------------------------------------------------------------

test('validateSearchQuery handles valid, empty, and bounded queries correctly', () => {
  // Empty or whitespace query
  assert.deepEqual(validateSearchQuery(''), { valid: true, query: '' })
  assert.deepEqual(validateSearchQuery('   '), { valid: true, query: '' })
  assert.deepEqual(validateSearchQuery(null), { valid: true, query: '' })
  assert.deepEqual(validateSearchQuery(undefined), { valid: true, query: '' })

  // Normal query
  assert.deepEqual(validateSearchQuery('Creep Radiohead'), { valid: true, query: 'Creep Radiohead' })
  assert.deepEqual(validateSearchQuery('  Ang Huling El Bimbo  '), { valid: true, query: 'Ang Huling El Bimbo' })

  // Boundary tests: 200 chars passes, 201+ chars rejected
  assert.equal(MAX_QUERY_LENGTH, 200)

  const boundary200 = 'x'.repeat(200)
  const res200 = validateSearchQuery(boundary200)
  assert.deepEqual(res200, { valid: true, query: boundary200 })

  const oversized201 = 'x'.repeat(201)
  const res201 = validateSearchQuery(oversized201)
  assert.deepEqual(res201, {
    valid: false,
    query: '',
    error: 'Query exceeds maximum length of 200 characters',
  })
})

// ---------------------------------------------------------------------------
// 2. SSRF Protection & Tab URL Validation
// ---------------------------------------------------------------------------

test('validateTabUrl strictly guards against SSRF, arbitrary hosts, and invalid protocols', () => {
  // Missing or empty
  assert.equal(validateTabUrl('').valid, false)
  assert.equal(validateTabUrl('').status, 400)
  assert.equal(validateTabUrl(null).status, 400)

  // Malformed URL string
  assert.equal(validateTabUrl('ht tp://invalid').status, 400)
  assert.equal(validateTabUrl('just-a-string').status, 400)

  // Exceeds max length (2048 chars)
  const longUrl = 'https://tabs.ultimate-guitar.com/tab/' + 'a'.repeat(MAX_URL_LENGTH)
  const resLong = validateTabUrl(longUrl)
  assert.equal(resLong.valid, false)
  assert.equal(resLong.status, 400)
  assert.match(resLong.error, /exceeds maximum length of 2048/)

  // Insecure HTTP protocol rejected with 403
  const httpUrl = 'http://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-4169'
  const resHttp = validateTabUrl(httpUrl)
  assert.equal(resHttp.valid, false)
  assert.equal(resHttp.status, 403)
  assert.match(resHttp.error, /Only HTTPS target URLs are permitted/)

  // Disallowed hosts rejected with 403
  const forbiddenHosts = [
    'https://www.google.com/search',
    'https://attacker.com/steal',
    'https://127.0.0.1/internal',
    'https://localhost:8080/secret',
    'https://169.254.169.254/latest/meta-data',
    'https://tabs.ultimate-guitar.com.attacker.com/spoof',
  ]
  for (const hostUrl of forbiddenHosts) {
    const res = validateTabUrl(hostUrl)
    assert.equal(res.valid, false, `Expected ${hostUrl} to be rejected`)
    assert.equal(res.status, 403, `Expected 403 for ${hostUrl}`)
    assert.match(res.error, /Only Ultimate Guitar domains are permitted/)
  }

  // Non-standard port rejected with 403
  const nonStdPort = 'https://tabs.ultimate-guitar.com:8443/tab/test'
  const resPort = validateTabUrl(nonStdPort)
  assert.equal(resPort.valid, false)
  assert.equal(resPort.status, 403)
  assert.match(resPort.error, /Only standard HTTPS \(443\) is permitted/)

  // Allowed valid targets accepted with 200
  const validTargets = [
    'https://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-4169',
    'https://www.ultimate-guitar.com/tab/eraserheads/ang-huling-el-bimbo-chords-93614',
    'https://TABS.ULTIMATE-GUITAR.COM/tab/queen/bohemian-rhapsody-chords-1716013',
  ]
  for (const target of validTargets) {
    const res = validateTabUrl(target)
    assert.equal(res.valid, true, `Expected ${target} to be valid`)
    assert.equal(res.status, 200)
    assert.ok(res.parsedUrl instanceof URL)
    assert.ok(ALLOWED_UG_HOSTS.includes(res.parsedUrl.hostname.toLowerCase()))
  }
})

// ---------------------------------------------------------------------------
// 3. Search Results Extraction & Parsing
// ---------------------------------------------------------------------------

test('parseSearchResults extracts, filters, and sorts search results accurately', () => {
  const mockPayload = {
    store: {
      page: {
        data: {
          results: [
            {
              id: 101,
              song_name: 'Creep',
              artist_name: 'Radiohead',
              type: 'Chords',
              version: 1,
              votes: 44000,
              rating: 4.87,
              tab_url: 'https://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-101',
              tonality_name: 'G',
            },
            {
              id: 102,
              song_name: 'Creep',
              artist_name: 'Radiohead',
              type: 'Chords',
              version: 2,
              votes: 5000,
              rating: 4.84,
              tab_url: 'https://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-102',
              tonality_name: 'C',
            },
            {
              id: 103,
              song_name: 'Creep (Bass)',
              artist_name: 'Radiohead',
              type: 'Bass Tabs',
              version: 1,
              votes: 1200,
              rating: 4.5,
              tab_url: 'https://tabs.ultimate-guitar.com/tab/radiohead/creep-bass-103',
            },
            {
              id: 104,
              song_name: 'Fake Plastic Trees',
              artist_name: 'Radiohead',
              type: 'Chords',
              version: 1,
              votes: 12000,
              rating: 4.88,
              tab_url: 'https://tabs.ultimate-guitar.com/tab/radiohead/fake-plastic-trees-chords-104',
              tonality_name: 'A',
            },
          ],
        },
      },
    },
  }

  const encodedJson = JSON.stringify(mockPayload)
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <div class="js-store" data-content="${encodedJson}"></div>
      </body>
    </html>
  `

  const results = parseSearchResults(html)
  assert.equal(Array.isArray(results), true)
  // Bass tab filtered out; only chords and chord-bearing tabs retained
  assert.equal(results.length, 3)

  // Sorted by votes descending: Creep (44000) -> Fake Plastic Trees (12000) -> Creep v2 (5000)
  assert.equal(results[0].songName, 'Creep')
  assert.equal(results[0].votes, 44000)
  assert.equal(results[0].tonality, 'G')

  assert.equal(results[1].songName, 'Fake Plastic Trees')
  assert.equal(results[1].votes, 12000)
  assert.equal(results[1].tonality, 'A')

  assert.equal(results[2].songName, 'Creep')
  assert.equal(results[2].version, 2)
  assert.equal(results[2].votes, 5000)
})

test('parseSearchResults gracefully handles empty and malformed store HTML', () => {
  // Empty HTML
  assert.deepEqual(parseSearchResults(''), [])
  assert.deepEqual(parseSearchResults('<html><body>No store here</body></html>'), [])

  // Broken JSON in data-content
  const brokenHtml = '<div class="js-store" data-content="not-valid-json"></div>'
  assert.deepEqual(parseSearchResults(brokenHtml), [])

  // Empty results array
  const emptyStore = { store: { page: { data: { results: [] } } } }
  const emptyHtml = `<div class="js-store" data-content='${JSON.stringify(emptyStore)}'></div>`
  assert.deepEqual(parseSearchResults(emptyHtml), [])
})

// ---------------------------------------------------------------------------
// 4. Tab Sheet Extraction & Markup Sanitization
// ---------------------------------------------------------------------------

test('sanitizeUgMarkup cleanly strips [ch] and [tab] tags', () => {
  assert.equal(sanitizeUgMarkup(''), '')
  assert.equal(sanitizeUgMarkup('[ch]G[/ch] [ch]D/F#[/ch] [ch]Em[/ch]'), 'G D/F# Em')
  assert.equal(sanitizeUgMarkup('[tab]Intro solo line[/tab]'), 'Intro solo line')
  assert.equal(sanitizeUgMarkup('  [ch]Am7[/ch]  \n[ch]C[/ch]  '), 'Am7  \nC')
})

test('parseTabSheet extracts complete sheet metadata, chords, and directives', () => {
  const rawTabContent = `
[Intro]
[ch]G[/ch] [ch]B[/ch] [ch]C[/ch] [ch]Cm[/ch]

[Verse 1]
                     [ch]G[/ch]                              [ch]B[/ch]
When you were here before, couldn't look you in the eyes
                    [ch]C[/ch]                         [ch]Cm[/ch]
You're just like an angel, your skin makes me cry
  `.trim()

  const mockTabPayload = {
    store: {
      page: {
        data: {
          tab: {
            song_name: 'Creep',
            artist_name: 'Radiohead',
            tonality_name: 'G',
            capo: 0,
          },
          tab_view: {
            wiki_tab: {
              content: rawTabContent,
            },
            meta: {
              tonality: 'G',
              capo: 0,
            },
          },
        },
      },
    },
  }

  const encoded = JSON.stringify(mockTabPayload)
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const html = `<html><body><div class="js-store" data-content="${encoded}"></div></body></html>`
  const sourceUrl = 'https://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-4169'

  const res = parseTabSheet(html, sourceUrl)
  assert.equal(res.success, true)
  assert.equal(res.status, 200)
  assert.ok(res.sheet)

  const sheet = res.sheet
  assert.equal(sheet.title, 'Creep')
  assert.equal(sheet.artist, 'Radiohead')
  assert.equal(sheet.key, 'G')
  assert.equal(sheet.capo, 'No Capo')
  assert.equal(sheet.bpm, '120')
  assert.equal(sheet.sourceUrl, sourceUrl)

  // Directives are present in rawContent
  assert.match(sheet.rawContent, /\{title: Creep\}/)
  assert.match(sheet.rawContent, /\{artist: Radiohead\}/)
  assert.match(sheet.rawContent, /\{key: G\}/)
  assert.match(sheet.rawContent, /\{capo: No Capo\}/)
  assert.match(sheet.rawContent, /\{tempo: 120\}/)

  // [ch] tags stripped from chord line
  assert.match(sheet.rawContent, /\[Intro\]\r?\nG B C Cm/)
  assert.doesNotMatch(sheet.rawContent, /\[ch\]/)
})

test('parseTabSheet supports capo metadata and fallback regex extraction', () => {
  // Capo 2 metadata test
  const mockCapoPayload = {
    store: {
      page: {
        data: {
          tab: { song_name: 'Love Story', artist_name: 'Taylor Swift', tonality_name: 'D', capo: 2 },
          tab_view: { wiki_tab: { content: '[Intro]\n[ch]C[/ch] [ch]G[/ch] [ch]Am[/ch] [ch]F[/ch]' }, meta: { capo: 2 } },
        },
      },
    },
  }
  const capoHtml = `<div class="js-store" data-content='${JSON.stringify(mockCapoPayload)}'></div>`
  const resCapo = parseTabSheet(capoHtml, 'https://tabs.ultimate-guitar.com/tab/taylor-swift/love-story-chords-730809')
  assert.equal(resCapo.success, true)
  assert.equal(resCapo.sheet.capo, 'Capo 2')
  assert.equal(resCapo.sheet.key, 'D')

  // Pre-tag fallback test when js-store lacks content
  const preHtml = `
    <html>
      <body>
        <div class="js-store" data-content='{"store":{"page":{"data":{"tab":{"song_name":"Old Tab","artist_name":"Old Artist"}}}}}'></div>
        <pre>[Intro]\nC G Am F\n\n[Verse 1]\nWe were both young</pre>
      </body>
    </html>
  `
  const resPre = parseTabSheet(preHtml, 'https://tabs.ultimate-guitar.com/tab/old/old-chords-1')
  assert.equal(resPre.success, true)
  assert.equal(resPre.sheet.title, 'Old Tab')
  assert.match(resPre.sheet.rawContent, /We were both young/)
})

test('parseTabSheet returns 404 error when chord sheet content is missing', () => {
  const emptyTabHtml = `
    <html>
      <body>
        <div class="js-store" data-content='{"store":{"page":{"data":{"tab":{"song_name":"Ghost Tab"}}}}}'></div>
      </body>
    </html>
  `
  const res = parseTabSheet(emptyTabHtml, 'https://tabs.ultimate-guitar.com/tab/ghost/ghost-chords-1')
  assert.equal(res.success, false)
  assert.equal(res.status, 404)
  assert.match(res.error, /No chord sheet text in tab data/)
})

// ---------------------------------------------------------------------------
// 5. Client Cutover & Proxy Deprecation Invariants
// ---------------------------------------------------------------------------

const { searchOnlineChords, fetchOnlineChordSheet, OnlineSearchError } = require('../src/utils/onlineSearch.ts')

test('onlineSearch.ts source code has zero deprecated third-party proxy paths or candidate infrastructure', () => {
  const source = fs.readFileSync(require.resolve('../src/utils/onlineSearch.ts'), 'utf8')
  assert.equal(source.includes('corsproxy.io'), false, 'corsproxy.io must be completely removed')
  assert.equal(source.includes('codetabs'), false, 'codetabs must be completely removed')
  assert.equal(source.includes('PROXY_CANDIDATES'), false, 'PROXY_CANDIDATES array must be eliminated')
  assert.equal(source.includes('fetchHtml'), false, 'fetchHtml scraper helper must be eliminated')
})

test('searchOnlineChords successful 200 with empty list returns empty result array', async () => {
  const originalFetch = global.fetch
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, results: [] }),
    })
    const results = await searchOnlineChords('nonexistent query')
    assert.deepEqual(results, [], '200 OK with empty list must yield empty results')
  } finally {
    global.fetch = originalFetch
  }
})

test('searchOnlineChords live attempt network failure throws structured error and never falls back to curated catalog', async () => {
  const originalFetch = global.fetch
  const originalWarn = console.warn
  console.warn = () => {}

  try {
    global.fetch = async () => {
      throw new Error('Connection refused')
    }

    // Query 'Stand By Me' (which exists in CURATED_CATALOG)
    await assert.rejects(
      searchOnlineChords('Stand By Me'),
      (err) => {
        assert.equal(err.name, 'OnlineSearchError')
        assert.equal(err.code, 'NETWORK_ERROR')
        assert.match(err.message, /Network error — unable to reach search service/)
        return true
      },
      'Live fetch failure must throw OnlineSearchError and never return curated catalog'
    )
  } finally {
    global.fetch = originalFetch
    console.warn = originalWarn
  }
})

test('searchOnlineChords backend HTTP 400, 403, 429, 502, 504 return distinct structured failure semantics', async () => {
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
        `HTTP ${c.status} must reject with code ${c.code} and exact message "${c.msg}" without curated fallback`
      )
    }
  } finally {
    global.fetch = originalFetch
    console.warn = originalWarn
  }
})

test('fetchOnlineChordSheet calls /api/ug-tab directly with encoded URL', async () => {
  const originalFetch = global.fetch
  let requestedUrl = ''

  try {
    global.fetch = async (url) => {
      requestedUrl = String(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          sheet: {
            title: 'Yellow',
            artist: 'Coldplay',
            key: 'B',
            capo: 'No Capo',
            bpm: '88',
            format: 'CHORD_PRO',
            rawContent: '{title: Yellow}\n[B]Look at the stars',
            sourceUrl: 'https://tabs.ultimate-guitar.com/tab/coldplay/yellow-chords-92843',
          },
        }),
      }
    }

    const sheet = await fetchOnlineChordSheet({
      id: 999,
      songName: 'Yellow',
      artistName: 'Coldplay',
      type: 'Chords',
      version: 1,
      votes: 500,
      rating: 4.8,
      tabUrl: 'https://tabs.ultimate-guitar.com/tab/coldplay/yellow-chords-92843',
    })

    assert.equal(
      requestedUrl,
      `/api/ug-tab?url=${encodeURIComponent('https://tabs.ultimate-guitar.com/tab/coldplay/yellow-chords-92843')}`
    )
    assert.equal(sheet.title, 'Yellow')
    assert.equal(sheet.key, 'B')
  } finally {
    global.fetch = originalFetch
  }
})

test('searchOnlineChords and fetchOnlineChordSheet handle offline state gracefully', async () => {
  const originalFetch = global.fetch
  const originalWarn = console.warn
  console.warn = () => {}

  const originalOnLine = typeof navigator !== 'undefined' ? navigator.onLine : undefined
  try {
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true })
    } else {
      global.navigator = { onLine: false }
    }
    let fetchCalled = false
    global.fetch = async () => {
      fetchCalled = true
      throw new Error('Should not call fetch when offline')
    }

    // 1. Offline search: returns curated example for matching showcase song
    const offlineCurated = await searchOnlineChords('Toxic')
    assert.equal(fetchCalled, false, 'Fetch must not be called when navigator.onLine is false')
    assert.equal(offlineCurated.length, 1)
    assert.equal(offlineCurated[0].songName, 'Toxic')
    assert.equal(offlineCurated[0].type, 'Offline example')

    // 2. Offline search for non-curated song returns [] without throwing
    const offlineUnknown = await searchOnlineChords('Nonexistent Unknown Song')
    assert.deepEqual(offlineUnknown, [])

    // 3. Offline tab fetch for non-curated song rejects with offline guidance
    await assert.rejects(
      fetchOnlineChordSheet({
        id: 123,
        songName: 'Nonexistent Song',
        artistName: 'Unknown',
        type: 'Chords',
        version: 1,
        votes: 10,
        rating: 4.0,
        tabUrl: 'https://tabs.ultimate-guitar.com/tab/unknown/nonexistent-chords-123',
      }),
      /Device is currently offline/
    )
  } finally {
    global.fetch = originalFetch
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true, writable: true })
    }
    console.warn = originalWarn
  }
})
