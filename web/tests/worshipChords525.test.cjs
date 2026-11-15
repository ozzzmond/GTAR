const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename)

const core = require('../src/utils/worshipChordsCore.ts')

// Invented titles, artists and chart text only; no upstream pages/catalog fixtures.
test('synthetic search results preserve title/artist, qualify identities and reject unsafe links', () => {
  const results = core.parseWorshipChordsSearch(`<h1>Search results for: example</h1>
    <a href="https://worshipchords.com/example-chords/" rel="bookmark"><strong>Example</strong> &amp; Hope</a>
    by <span class="categories">Synthetic Artist</span>
    <a rel='bookmark' href='https://worshipchords.com/second-chords/'>Second &#9837;</a>
    by <span class='categories'>Another Artist</span>
    <a rel="bookmark" href="https://evil.test/stolen-chords/">Unsafe</a>
    <a rel="bookmark" href="https://worshipchords.com/example-chords/">Duplicate</a>`)
  assert.deepEqual(results.map(({ id, songName, artistName, providerId, providerName }) =>
    ({ id, songName, artistName, providerId, providerName })), [
    { id: 'worshipchords:example-chords', songName: 'Example & Hope', artistName: 'Synthetic Artist', providerId: 'worshipchords', providerName: 'WorshipChords' },
    { id: 'worshipchords:second-chords', songName: 'Second ♭', artistName: 'Another Artist', providerId: 'worshipchords', providerName: 'WorshipChords' },
  ])
  assert.equal(results[0].tonality, undefined)
})

test('synthetic empty search is distinct from changed markup, oversized HTML and block pages', () => {
  assert.deepEqual(core.parseWorshipChordsSearch('<h1>Search results</h1><p>Sorry, no songs matched your search...</p>'), [])
  for (const html of ['<h1>New layout</h1>', '<h1>Just a moment...</h1>', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    assert.throws(() => core.parseWorshipChordsSearch(html), /parse|limit/i)
  }
})

test('synthetic chart extraction preserves spacing, line breaks and sections without rewriting chords', () => {
  const chart = '\nVerse 1\n  C       G/B\nA made-up line &amp; another\n\nChorus\n F    G\nInvented words\n'
  const { sheet, chartKey } = core.parseWorshipChordsSheet(`<h1>Example Chords</h1>
    <meta content="Example Chords - Synthetic Artist - view lyrics" property="og:description">
    <pre data-key="C">${chart}</pre><pre>Other widget</pre>
    <li><strong>Original Key:</strong> Db</li><li>Suggested Worship Key: C with capo 1</li>`,
  'https://worshipchords.com/example-chords/')
  assert.equal(sheet.rawContent, chart.replace('&amp;', '&'))
  assert.equal(sheet.key, 'Db') // ORIGINAL_KEY, never suggested CHART_KEY or capo shapes.
  assert.equal(chartKey, 'C')
  assert.equal(sheet.capo, '') // Suggested capo is not verified chart capo.
  assert.equal(sheet.bpm, '')
  assert.equal(sheet.format, 'TWO_LINE')
  assert.equal(sheet.title, 'Example')
  assert.equal(sheet.artist, 'Synthetic Artist')
})

test('missing ORIGINAL_KEY stays unknown; malformed/empty charts fail closed', () => {
  const url = 'https://worshipchords.com/example-chords/'
  const { sheet } = core.parseWorshipChordsSheet('<h1>Example Chords</h1><p>Suggested Worship Key: G with capo 2</p><pre data-key="G"> G\nInvented words</pre>', url)
  assert.equal(sheet.key, '')
  assert.equal(sheet.capo, '')
  for (const html of ['<h1>Example</h1>', '<h1>Example</h1><pre> </pre>', '<pre> C\nWords</pre>',
    '<h1>Example</h1><pre data-key="C"> C\nOne</pre><pre data-key="D"> D\nTwo</pre>']) {
    assert.throws(() => core.parseWorshipChordsSheet(html, url), /parse/i)
  }
  assert.throws(() => core.parseWorshipChordsSheet('<h1>Example</h1><pre> C\nWords</pre>', 'https://evil.test/example-chords/'), /URL/i)
})

test('WorshipChords song URLs reject SSRF destinations and non-song paths independently of UG', () => {
  assert.equal(core.validateWorshipChordsSongUrl('https://worshipchords.com/example-chords/'), 'https://worshipchords.com/example-chords/')
  for (const url of [
    'http://worshipchords.com/example-chords/', 'https://worshipchords.com.evil.test/example-chords/',
    'https://127.0.0.1/example-chords/', 'https://worshipchords.net/example-chords/',
    'https://user:pass@worshipchords.com/example-chords/', 'https://worshipchords.com:444/example-chords/',
    'https://worshipchords.com/?s=example', 'https://worshipchords.com/wp-admin/example-chords/',
    'https://worshipchords.com/example-chords/?redirect=evil', 'https://worshipchords.com/example-chords/#part',
    'https://worshipchords.com/%65xample-chords/', 'https://worshipchords.com/a/../example-chords/',
    'https://worshipchords.com/' + 'a'.repeat(2050) + '-chords/', 'not a URL',
  ]) assert.equal(core.validateWorshipChordsSongUrl(url), null, url)
})

test('unregistered provider scaffold fails closed without making network requests or changing settings', async () => {
  const { WorshipChordsProvider } = require('../src/utils/worshipChordsProvider.ts')
  const { getRegisteredSearchProviders } = require('../src/utils/onlineSearchProvider.ts')
  const { createDefaultSettings, SUPPORTED_SOURCES } = require('../src/utils/onlineSourceSettings.ts')
  const previousFetch = global.fetch
  let calls = 0
  global.fetch = async () => { calls++; throw new Error('Unexpected network access') }
  try {
    const provider = new WorshipChordsProvider()
    for (const query of ['', 'invented song']) await assert.rejects(provider.search(query), { code: 'RESTRICTED' })
    await assert.rejects(provider.fetchSheet({ tabUrl: 'https://worshipchords.com/example-chords/' }), { code: 'RESTRICTED' })
    assert.equal(calls, 0)
    assert.deepEqual(getRegisteredSearchProviders().map(provider => provider.id), ['ultimate-guitar'])
    assert.equal(SUPPORTED_SOURCES.find(source => source.id === 'worshipchords').kind, 'shortcut')
    assert.deepEqual(createDefaultSettings().sources.map(source => source.id), ['ultimate-guitar'])
  } finally { global.fetch = previousFetch }
})
