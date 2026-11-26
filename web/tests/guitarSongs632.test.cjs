const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const React = require('react')
const { renderToString } = require('react-dom/server')

const gsCore = require('../src/utils/guitarSongsCore.ts')
const gsFetch = require('../functions/gsFetch.ts')
const gsSearch = require('../functions/api/gs-search.ts')
const gsTab = require('../functions/api/gs-tab.ts')
const { _resetUgGateForTesting } = require('../functions/ugGate.ts')
const { GuitarSongsProvider, OnlineSearchError } = require('../src/utils/onlineSearchProvider.ts')
const { ChordPreviewModal } = require('../src/components/ChordPreviewModal.tsx')

const FIXTURE_HTML = fs.readFileSync(path.join(__dirname, 'fixtures/guitarsongs_hello_goodbye.html'), 'utf8')

test('#632 GuitarSongs offline fixture extraction preserves chord alignment and omits unavailable metadata', () => {
  assert.equal(gsCore.isGuitarSongsHtml(FIXTURE_HTML), true)
  const parsed = gsCore.parseGuitarSongsTabSheet(FIXTURE_HTML, 'https://en.guitarsongs.club/song/127565')
  assert.equal(parsed.success, true)
  assert.equal(parsed.sheet.title, 'Hello, Goodbye')
  assert.equal(parsed.sheet.artist, 'The Beatles')
  assert.equal(parsed.sheet.key, '')
  assert.equal(parsed.sheet.capo, '')
  assert.equal(parsed.sheet.bpm, '')
  assert.equal(parsed.sheet.format, 'CHORD_PRO')
  assert.equal(parsed.sheet.sourceUrl, 'https://en.guitarsongs.club/song/127565')

  assert.equal(
    parsed.sheet.rawContent,
    '{title: Hello, Goodbye}\n' +
      '{artist: The Beatles}\n\n' +
      'Y[Dm]ou say yes, I[C] say no\n' +
      'Y[G7]ou say stop and I[Am] say go, go, g[G]o\n' +
      'Y[G]ou say goodby[G7]e and I[F] say hell[C]o  [G/B]'
  )
  // No fabricated directives
  assert.doesNotMatch(parsed.sheet.rawContent, /\{(original_key|key|tempo|time|year|capo):/i)
})

test('#632 GuitarSongs normalizes bracketed sections and escapes user-submitted brackets', () => {
  const html =
    '<html><head><title>Guitar Songs Club - Artist — Chords — Test Song</title></head>' +
    '<body><tt>' +
    '[INTRO:]&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;B&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;F#/A#<br>' +
    '[VERSE 1:]<br>' +
    '&nbsp;B&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;F#<br>' +
    'Line&nbsp;one&nbsp;[note]<br>' +
    '</tt></body></html>'

  const parsed = gsCore.parseGuitarSongsTabSheet(html, 'https://en.guitarsongs.club/song/42')
  assert.equal(parsed.success, true)
  assert.equal(parsed.sheet.title, 'Test Song')
  assert.match(parsed.sheet.rawContent, /\{comment: Repeat Intro\}/)
  assert.match(parsed.sheet.rawContent, /\{comment: Repeat Verse 1\}/)
  assert.match(parsed.sheet.rawContent, /\[B\]\s+\[F#\/A#\]/)
  assert.match(parsed.sheet.rawContent, /L\[B\]ine one \[F#\]\(note\)/)
})

test('#632 GuitarSongs search HTML parser deduplicates, ranks and avoids fabricated metadata', () => {
  const searchHtml = `
    <div class="results">
      <a href="/song/127565">The Beatles — Hello, Goodbye</a>
      <a href="/song/127565">The Beatles — Hello, Goodbye</a>
      <a href="/song/127568">Bon Jovi - Never Say Die</a>
      <a href="/author/597">The Beatles</a>
    </div>
  `
  const results = gsCore.parseGuitarSongsSearchHtml(searchHtml, { query: 'beatles' })
  assert.equal(results.length, 1)
  assert.deepEqual(results[0], {
    id: 'guitarsongs:127565',
    songName: 'Hello, Goodbye',
    artistName: 'The Beatles',
    type: 'Chords',
    tabUrl: 'https://en.guitarsongs.club/song/127565',
    providerId: 'guitarsongs',
    providerName: 'GuitarSongs.club',
  })
  assert.equal('version' in results[0], false)
  assert.equal('votes' in results[0], false)
  assert.equal('rating' in results[0], false)
})

test('#632 GuitarSongs URL validation and SSRF protections', () => {
  assert.equal(gsCore.validateGuitarSongsSongUrl('https://guitarsongs.club/song/127565').valid, true)
  assert.equal(gsCore.validateGuitarSongsSongUrl('https://en.guitarsongs.club/song/127565/').valid, true)
  assert.equal(gsCore.validateGuitarSongsSongUrl('https://ru2.guitarsongs.club/song/127565').valid, true)
  assert.equal(gsCore.validateGuitarSongsSongUrl('https://eo.guitarsongs.club/song/127565').valid, true)

  for (const bad of [
    '',
    'http://en.guitarsongs.club/song/127565',
    'https://user:pass@en.guitarsongs.club/song/127565',
    'https://en.guitarsongs.club:8443/song/127565',
    'https://guitarsongs.club/author/597',
    'https://evil.example.com/song/127565',
    'https://127.0.0.1/song/127565',
    'https://169.254.169.254/latest/meta-data/',
    'https://worshipchords.com/relentless-chords/',
  ]) {
    assert.equal(gsCore.validateGuitarSongsSongUrl(bad).valid, false, `should reject ${bad}`)
  }
})

test('#632 fetchGuitarSongs enforces allowlist, manual redirect validation and challenge/content-type checks', async () => {
  const originalFetch = global.fetch
  try {
    await assert.rejects(
      () => gsFetch.fetchGuitarSongs('https://127.0.0.1/song/1', {}),
      /Untrusted GuitarSongs\.club destination/
    )

    // Untrusted redirect target is rejected
    global.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } })
    await assert.rejects(
      () => gsFetch.fetchGuitarSongs('https://en.guitarsongs.club/song/1', {}),
      /Untrusted redirect destination/
    )

    // Cloudflare challenge returns 403
    global.fetch = async () => new Response('challenge', { status: 200, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } })
    const challenged = await gsFetch.fetchGuitarSongs('https://en.guitarsongs.club/song/1', {})
    assert.equal(challenged.status, 403)

    // Non-HTML content-type is rejected
    global.fetch = async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    await assert.rejects(
      () => gsFetch.fetchGuitarSongs('https://en.guitarsongs.club/song/1', {}),
      /did not return HTML/
    )
  } finally {
    global.fetch = originalFetch
  }
})

test('#632 GuitarSongs endpoints respect UG_PROXY_MODE=disabled and input validation when permitted', async () => {
  assert.equal(gsCore.GUITARSONGS_LIVE_ACCESS_PERMITTED, true)
  _resetUgGateForTesting()
  for (const endpoint of [gsSearch, gsTab]) {
    const off = await endpoint.onRequestGet({
      request: new Request('https://gtar.local/api/gs-search?q=beatles'),
      env: { UG_PROXY_MODE: 'disabled' },
    })
    assert.equal(off.status, 503)
    assert.equal((await off.json()).error, 'ONLINE_SOURCES_DISABLED')
  }
  const emptySearch = await gsSearch.onRequestGet({
    request: new Request('https://gtar.local/api/gs-search?q='),
    env: {},
  })
  assert.equal(emptySearch.status, 200)
  assert.deepEqual((await emptySearch.json()).results, [])

  const badTab = await gsTab.onRequestGet({
    request: new Request('https://gtar.local/api/gs-tab?url=' + encodeURIComponent('https://evil.example.com/song/1')),
    env: {},
  })
  assert.equal(badTab.status, 403)
  _resetUgGateForTesting()
})

test('#632 GuitarSongsProvider blocks live calls when unpermitted and works against mocked responses when permitted', async () => {
  const originalFetch = global.fetch
  let fetchCalled = false
  try {
    global.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }) }

    const gatedProvider = new GuitarSongsProvider({ permitted: false })
    await assert.rejects(() => gatedProvider.search('beatles'), err => err instanceof OnlineSearchError && err.code === 'DISABLED')
    await assert.rejects(() => gatedProvider.fetchSheet({
      id: 'guitarsongs:127565', songName: 'Hello, Goodbye', artistName: 'The Beatles', type: 'Chords',
      tabUrl: 'https://en.guitarsongs.club/song/127565',
    }), /not permitted/)
    assert.equal(fetchCalled, false)

    const permittedProvider = new GuitarSongsProvider()
    global.fetch = async (url) => {
      const u = String(url)
      if (u.startsWith('/api/gs-search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            results: gsCore.parseGuitarSongsSearchHtml('<a href="/song/127565">The Beatles — Hello, Goodbye</a>', { query: 'beatles' }),
          }),
        }
      }
      if (u.startsWith('/api/gs-tab')) {
        const parsed = gsCore.parseGuitarSongsTabSheet(FIXTURE_HTML, 'https://en.guitarsongs.club/song/127565')
        return { ok: true, status: 200, json: async () => ({ success: true, sheet: parsed.sheet }) }
      }
      throw new Error(`Unexpected URL: ${u}`)
    }

    const hits = await permittedProvider.search('beatles')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].providerId, 'guitarsongs')
    const sheet = await permittedProvider.fetchSheet(hits[0])
    assert.equal(sheet.title, 'Hello, Goodbye')
    assert.equal(sheet.artist, 'The Beatles')
  } finally {
    global.fetch = originalFetch
  }
})

test('#632 ChordPreviewModal hides unavailable version, rating and votes without throwing or fabricating', () => {
  const gsResult = {
    id: 'guitarsongs:127565',
    songName: 'Hello, Goodbye',
    artistName: 'The Beatles',
    type: 'Chords',
    tabUrl: 'https://en.guitarsongs.club/song/127565',
    providerId: 'guitarsongs',
    providerName: 'GuitarSongs.club',
  }

  const html = renderToString(
    React.createElement(ChordPreviewModal, {
      isOpen: true,
      onClose: () => {},
      result: gsResult,
      onImportSong: () => {},
    })
  )

  assert.match(html, /Hello, Goodbye/)
  assert.match(html, /The Beatles/)
  assert.doesNotMatch(html, /★/)
  assert.doesNotMatch(html, /votes/)
  assert.doesNotMatch(html, /Chords v/)
  assert.match(html, />Chords</)
})
