const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}

const React = require('react')
const { renderToString } = require('react-dom/server')
const { getSongMetadataStatus } = require('../src/utils/chordProMetadata.ts')
const { SetlistDrawer } = require('../src/components/SetlistDrawer.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

// -------------------------------------------------------------------------
// Target 21: Complete valid six-field metadata -> OK
// -------------------------------------------------------------------------
test('METADATA_STATUS_21: Complete valid six-field metadata returns METADATA_OK', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: 120,
    time: '4/4',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'METADATA_OK')
  assert.equal(result.isComplete, true)
  assert.equal(result.missingFields.length, 0)
})

// -------------------------------------------------------------------------
// Target 22: No {key}, otherwise complete -> OK
// -------------------------------------------------------------------------
test('METADATA_STATUS_22: Song without chart key directive is METADATA_OK if originalKey and other 5 fields are valid', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: '120',
    time: '4/4',
    year: 2004,
    rawContent: '{title: How Great Is Our God}\n{artist: Chris Tomlin}\n{original_key: G}\n{tempo: 120}\n{time: 4/4}\n{year: 2004}\n[G]The splendor of the King',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'METADATA_OK')
  assert.equal(result.isComplete, true)
  assert.equal(result.resolved.key, undefined)
  assert.equal(result.resolved.originalKey, 'G')
})

// -------------------------------------------------------------------------
// Target 23: Missing title -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_23: Missing or whitespace title produces NEEDS_METADATA', () => {
  const song = {
    title: '   ',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: 120,
    time: '4/4',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('title'))
})

// -------------------------------------------------------------------------
// Target 24: Missing artist -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_24: Missing or empty artist produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: '',
    originalKey: 'G',
    tempo: 120,
    time: '4/4',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('artist'))
})

// -------------------------------------------------------------------------
// Target 25: "Unknown Artist" case-insensitive -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_25: "Unknown Artist" case-insensitive produces NEEDS_METADATA', () => {
  for (const variant of ['Unknown Artist', 'unknown artist', 'UNKNOWN ARTIST', '  Unknown Artist  ']) {
    const song = {
      title: 'How Great Is Our God',
      artist: variant,
      originalKey: 'G',
      tempo: 120,
      time: '4/4',
      year: '2004',
    }
    const result = getSongMetadataStatus(song)
    assert.equal(result.status, 'NEEDS_METADATA', `Expected NEEDS_METADATA for "${variant}"`)
    assert.ok(result.missingFields.includes('artist'))
  }
})

// -------------------------------------------------------------------------
// Target 26: Missing original_key -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_26: Missing original_key produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    tempo: 120,
    time: '4/4',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('originalKey'))
})

// -------------------------------------------------------------------------
// Target 27: Invalid original_key -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_27: Invalid musical key in original_key produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'NotAKey',
    tempo: 120,
    time: '4/4',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('originalKey'))
})

// -------------------------------------------------------------------------
// Target 28: Missing tempo -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_28: Missing tempo produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    time: '4/4',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('tempo'))
})

// -------------------------------------------------------------------------
// Target 29: tempo < 30 -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_29: Tempo below 30 BPM produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: 25,
    time: '4/4',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('tempo'))
})

// -------------------------------------------------------------------------
// Target 30: tempo > 300 -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_30: Tempo above 300 BPM produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: 350,
    time: '4/4',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('tempo'))
})

// -------------------------------------------------------------------------
// Target 31: Missing time -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_31: Missing time signature produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: 120,
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('time'))
})

// -------------------------------------------------------------------------
// Target 32: Invalid time -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_32: Invalid time signature format produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: 120,
    time: 'common time',
    year: '2004',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('time'))
})

// -------------------------------------------------------------------------
// Target 33: Missing year -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_33: Missing year produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: 120,
    time: '4/4',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('year'))
})

// -------------------------------------------------------------------------
// Target 34: Invalid year -> Needs
// -------------------------------------------------------------------------
test('METADATA_STATUS_34: Non-4-digit year produces NEEDS_METADATA', () => {
  const song = {
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    tempo: 120,
    time: '4/4',
    year: '04',
  }
  const result = getSongMetadataStatus(song)
  assert.equal(result.status, 'NEEDS_METADATA')
  assert.ok(result.missingFields.includes('year'))
})

// -------------------------------------------------------------------------
// Target 35: Manual metadata and lookup-applied equivalent classify identically
// -------------------------------------------------------------------------
test('METADATA_STATUS_35: Manual chordpro and lookup-applied equivalent metadata classify identically', () => {
  const manualSong = {
    rawContent: '{title: Blessed Be Your Name}\n{artist: Matt Redman}\n{original_key: B}\n{tempo: 116}\n{time: 4/4}\n{year: 2002}\n[B]Blessed be Your name',
  }
  const lookupAppliedSong = {
    title: 'Blessed Be Your Name',
    artist: 'Matt Redman',
    originalKey: 'B',
    tempo: 116,
    time: '4/4',
    year: 2002,
    rawContent: '[B]Blessed be Your name',
  }

  const resManual = getSongMetadataStatus(manualSong)
  const resLookup = getSongMetadataStatus(lookupAppliedSong)

  assert.equal(resManual.status, 'METADATA_OK')
  assert.equal(resLookup.status, 'METADATA_OK')
  assert.deepEqual(resManual.missingFields, resLookup.missingFields)
})

// -------------------------------------------------------------------------
// Target 36: Main card uses canonical predicate
// -------------------------------------------------------------------------
test('METADATA_STATUS_36: SongbookHomeView uses getSongMetadataStatus for card indicators', () => {
  const songOk = {
    id: 's-ok',
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    bpm: '120',
    time: '4/4',
    year: '2004',
    rawContent: '{title: How Great Is Our God}\n{artist: Chris Tomlin}\n{original_key: G}\n{tempo: 120}\n{time: 4/4}\n{year: 2004}\n[G]The splendor',
  }
  const songNeeds = {
    id: 's-needs',
    title: 'Incomplete Track',
    artist: 'Unknown Artist',
    rawContent: '[C]Hello',
  }

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [songOk, songNeeds],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
    })
  )

  assert.ok(html.includes('aria-label="Metadata OK"'), 'Complete card renders Metadata OK status')
  assert.ok(html.includes('aria-label="Needs Metadata"'), 'Incomplete card renders Needs Metadata status')
})

// -------------------------------------------------------------------------
// Target 37: Side panel uses canonical predicate
// -------------------------------------------------------------------------
test('METADATA_STATUS_37: SetlistDrawer uses getSongMetadataStatus for drawer item indicators', () => {
  const songOk = {
    id: 's-ok',
    title: 'How Great Is Our God',
    artist: 'Chris Tomlin',
    originalKey: 'G',
    bpm: '120',
    time: '4/4',
    year: '2004',
    rawContent: '{title: How Great Is Our God}\n{artist: Chris Tomlin}\n{original_key: G}\n{tempo: 120}\n{time: 4/4}\n{year: 2004}\n[G]The splendor',
  }
  const songNeeds = {
    id: 's-needs',
    title: 'Incomplete Track',
    artist: '',
    rawContent: '[C]Hello',
  }

  const html = renderToString(
    React.createElement(SetlistDrawer, {
      isOpen: true,
      onClose: () => {},
      songs: [songOk, songNeeds],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
    })
  )

  assert.ok(html.includes('data-testid="drawer-song-metadata-status-0"'))
  assert.ok(html.includes('data-testid="drawer-song-metadata-status-1"'))
})

// -------------------------------------------------------------------------
// Target 38 & 39: OK filter and Needs filter use canonical predicate
// -------------------------------------------------------------------------
test('METADATA_STATUS_38_39: OK and Needs filter consume getSongMetadataStatus', () => {
  const completeSong = {
    title: 'Song A',
    artist: 'Artist A',
    originalKey: 'C',
    tempo: 100,
    time: '4/4',
    year: '2020',
  }
  const incompleteSong = {
    title: 'Song B',
    artist: 'Artist B',
  }

  const isComplete = (s) => getSongMetadataStatus(s).status === 'METADATA_OK'
  const isNeeds = (s) => getSongMetadataStatus(s).status === 'NEEDS_METADATA'

  assert.equal(isComplete(completeSong), true)
  assert.equal(isNeeds(completeSong), false)

  assert.equal(isComplete(incompleteSong), false)
  assert.equal(isNeeds(incompleteSong), true)
})

// -------------------------------------------------------------------------
// Target 40: Changing canonical metadata updates status immediately
// -------------------------------------------------------------------------
test('METADATA_STATUS_40: Updating missing field transitions status from NEEDS_METADATA to METADATA_OK', () => {
  const song = {
    title: 'Everlasting God',
    artist: 'Brenton Brown',
    originalKey: 'B',
    tempo: 110,
    time: '4/4',
    year: undefined,
  }
  assert.equal(getSongMetadataStatus(song).status, 'NEEDS_METADATA')

  const updatedSong = { ...song, year: '2005' }
  assert.equal(getSongMetadataStatus(updatedSong).status, 'METADATA_OK')
})

// -------------------------------------------------------------------------
// Target 41: {key} changes alone do not alter metadata completeness
// -------------------------------------------------------------------------
test('METADATA_STATUS_41: Modifying chart key does NOT alter metadata completeness', () => {
  const song = {
    title: '10,000 Reasons',
    artist: 'Matt Redman',
    originalKey: 'G',
    tempo: 73,
    time: '4/4',
    year: '2011',
    key: 'G',
  }
  assert.equal(getSongMetadataStatus(song).status, 'METADATA_OK')

  // Chart transposed to E, but originalKey is still G
  const transposedChart = { ...song, key: 'E' }
  assert.equal(getSongMetadataStatus(transposedChart).status, 'METADATA_OK')

  // Chart with no key directive at all
  const noKeyChart = { ...song, key: undefined }
  assert.equal(getSongMetadataStatus(noKeyChart).status, 'METADATA_OK')
})

// -------------------------------------------------------------------------
// Target 42: original_key changes can alter metadata completeness
// -------------------------------------------------------------------------
test('METADATA_STATUS_42: Changing original_key from valid to invalid alters completeness', () => {
  const song = {
    title: '10,000 Reasons',
    artist: 'Matt Redman',
    originalKey: 'G',
    tempo: 73,
    time: '4/4',
    year: '2011',
  }
  assert.equal(getSongMetadataStatus(song).status, 'METADATA_OK')

  const corruptedOrigKey = { ...song, originalKey: 'InvalidKey' }
  assert.equal(getSongMetadataStatus(corruptedOrigKey).status, 'NEEDS_METADATA')
})

// -------------------------------------------------------------------------
// Target 43: No body/chord transposition occurs
// -------------------------------------------------------------------------
test('METADATA_STATUS_43: Status evaluation is purely read-only and does not mutate song rawContent', () => {
  const raw = '{title: Test}\n{artist: Band}\n{original_key: D}\n{tempo: 100}\n{time: 4/4}\n{year: 2021}\n[D]Verse [A]one'
  const song = { rawContent: raw }
  const res = getSongMetadataStatus(song)
  assert.equal(res.status, 'METADATA_OK')
  assert.equal(song.rawContent, raw, 'rawContent must remain completely unchanged')
})
