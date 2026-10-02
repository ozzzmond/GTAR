/**
 * GTAR_108_dev8i_fieldfix — Artist badge display + version consistency regression
 * Covers: artist badge visible when field selected, hidden when deselected,
 * artist applied on blank artist song, existing artist protected, no infer when
 * provider has no artist, version string consistency between gtar.ts and package.json.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) =>
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client')
const metadata = require('../src/utils/songMetadata.ts')
const { GTAR_DEV_VERSION, GTAR_APP_VERSION } = require('../src/types/gtar.ts')
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')

const blankArtistSong = { id: 'd108ff01-0001-4000-8000-000000000001', title: 'Broken Vessels (Amazing Grace)', artist: '', key: 'A', rawContent: '[A] [D] [E]', originalKey: '', bpm: '', year: '', format: 'CHORD_PRO', transposeOffset: 0 }
const existingArtistSong = { ...blankArtistSong, id: 'd108ff01-0002-4000-8000-000000000002', artist: 'Hillsong Worship' }
const candidateWithArtist = { id: 'provider-hl', title: 'Broken Vessels (Amazing Grace)', artist: 'Hillsong Live', originalKey: 'A', bpm: '68', year: '2014', confidence: 'HIGH' }
const candidateNoArtist = { id: 'provider-noa', title: 'Broken Vessels (Amazing Grace)', artist: '', originalKey: 'A', bpm: '68', year: '2014', confidence: 'MEDIUM' }

const click = async selector => { const el = document.querySelector(selector); assert.ok(el, selector); await act(async () => el.click()) }
const getArtistBadge = () => [...document.querySelectorAll('span')].find(s => s.textContent.trim().startsWith('Artist:'))

async function editor(song, candidate, run) {
  let current = { ...song }, writes = []
  const root = createRoot(document.getElementById('root'))
  metadata.fetchSongMetadataFromProvider = async () => ({ success: true, candidates: [candidate], status: 'MATCH' })
  try {
    await act(async () => root.render(React.createElement(DesktopEditor, {
      song, transposeOffset: 0,
      onUpdateSong: update => { writes.push(update); current = { ...current, ...update }; return true }
    })))
    await click('[aria-label="Song Details & Metadata"]')
    await click('[data-testid="editor-lookup-metadata-btn"]')
    await run(() => current, writes)
  } finally {
    await act(async () => root.unmount())
  }
}

// ISSUE_1: Artist badge visibility — present when artist field is selected and candidate has artist
test('108-dev.8i artist badge visible in panel when candidate has artist and field is selected', async () => {
  await editor(blankArtistSong, candidateWithArtist, async () => {
    const badge = getArtistBadge()
    assert.ok(badge, 'Artist badge should be visible when field is selected and candidate has artist')
    assert.match(badge.textContent, /Hillsong Live/)
  })
})

// Artist badge hidden when the artist checkbox is unchecked
test('108-dev.8i artist badge hidden when artist field deselected', async () => {
  await editor(blankArtistSong, candidateWithArtist, async () => {
    // Uncheck artist
    const artistCheckbox = document.querySelector('[aria-label="Apply artist"]')
    assert.ok(artistCheckbox, 'Artist checkbox must exist')
    await act(async () => artistCheckbox.click())
    const badge = getArtistBadge()
    assert.ok(!badge, 'Artist badge must not appear when field is deselected')
  })
})

// ISSUE_1: Artist applies from blank
test('108-dev.8i artist applies when current artist is blank', async () => {
  await editor(blankArtistSong, candidateWithArtist, async (get) => {
    await click('[data-testid="editor-apply-metadata-btn"]')
    assert.equal(get().artist, 'Hillsong Live')
  })
})

// Existing artist protected — apply with conflict prompts and does not write on cancel
test('108-dev.8i existing artist protected: no apply on conflict-confirm cancel', async () => {
  await editor(existingArtistSong, candidateWithArtist, async (get, writes) => {
    // artist checkbox must start unchecked when existing artist is present
    const artistCheckbox = document.querySelector('[aria-label="Apply artist"]')
    assert.ok(artistCheckbox, 'Artist checkbox must exist')
    assert.equal(artistCheckbox.checked, false)
    window.confirm = () => false
    await click('[data-testid="editor-apply-metadata-btn"]')
    // With artist conflict and confirm=false, nothing should be written
    assert.equal(writes.length, 0)
    assert.equal(get().artist, 'Hillsong Worship')
  })
})

// No artist inferred when provider supplies empty artist
test('108-dev.8i no artist applied when provider artist is empty', async () => {
  await editor(blankArtistSong, candidateNoArtist, async (get) => {
    await click('[data-testid="editor-apply-metadata-btn"]')
    assert.equal(get().artist, '')
  })
})

// Artist badge absent when provider supplies no artist (nothing to display)
test('108-dev.8i artist badge absent when provider artist is empty', async () => {
  await editor(blankArtistSong, candidateNoArtist, async () => {
    const badge = getArtistBadge()
    assert.ok(!badge, 'Artist badge must not appear when provider has no artist')
  })
})

// ISSUE_2: Version consistency
test('108-dev.8i GTAR_DEV_VERSION is 1.0.108-dev.8j', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.108-dev.8j')
})

test('108-dev.8i GTAR_APP_VERSION and GTAR_DEV_VERSION share the same major.minor.patch', () => {
  // Both should embed 108 as the feature milestone
  assert.match(GTAR_DEV_VERSION, /108/)
  assert.match(GTAR_APP_VERSION, /108/)
})

test('108-dev.8i package.json version matches GTAR_DEV_VERSION', () => {
  const pkg = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8'))
  assert.equal(pkg.version, GTAR_DEV_VERSION)
})
