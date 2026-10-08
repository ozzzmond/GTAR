const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
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

const webDir = path.resolve(__dirname, '..')
const { getSongMetadataStatus, syncCanonicalDirectives } = require(path.join(webDir, 'src/utils/chordProMetadata.ts'))
const { transposeCanonicalSong } = require(path.join(webDir, 'src/utils/chartKeyAlignment.ts'))

test('DEV5C_CORRECTION_1: complete title+artist+original_key+tempo+time+year => Metadata OK even with no {key}', () => {
  const songWithoutKey = {
    title: 'Do It Again',
    artist: 'Elevation Worship',
    originalKey: 'G',
    bpm: '120',
    time: '4/4',
    year: '2016',
    rawContent: '{title: Do It Again}\n{artist: Elevation Worship}\n{original_key: G}\n{tempo: 120 BPM}\n{time: 4/4}\n{year: 2016}\n[G]Walking around these walls',
  }
  const status = getSongMetadataStatus(songWithoutKey)
  assert.equal(status.status, 'METADATA_OK')
  assert.equal(status.isComplete, true)
  assert.equal(status.missingFields.length, 0)
  assert.equal(status.resolved.title, 'Do It Again')
  assert.equal(status.resolved.artist, 'Elevation Worship')
  assert.equal(status.resolved.originalKey, 'G')
  assert.equal(status.resolved.key, undefined)
})

test('DEV5C_CORRECTION_2: missing original_key => Needs Metadata even when {key} exists', () => {
  const songWithChartKeyOnly = {
    title: 'Do It Again',
    artist: 'Elevation Worship',
    key: 'G',
    bpm: '120',
    time: '4/4',
    year: '2016',
    rawContent: '{title: Do It Again}\n{artist: Elevation Worship}\n{key: G}\n{tempo: 120 BPM}\n{time: 4/4}\n{year: 2016}\n[G]Walking around these walls',
  }
  const status = getSongMetadataStatus(songWithChartKeyOnly)
  assert.equal(status.status, 'NEEDS_METADATA')
  assert.equal(status.isComplete, false)
  assert.ok(status.missingFields.includes('originalKey'))
  assert.ok(!status.missingFields.includes('key'))
})

test('DEV5C_CORRECTION_3: {key: D} + {original_key: G} => Metadata OK when all reference metadata is complete', () => {
  const songWithDifferingKeys = {
    title: 'Do It Again',
    artist: 'Elevation Worship',
    key: 'D',
    originalKey: 'G',
    bpm: '120',
    time: '4/4',
    year: '2016',
    rawContent: '{title: Do It Again}\n{artist: Elevation Worship}\n{key: D}\n{original_key: G}\n{tempo: 120 BPM}\n{time: 4/4}\n{year: 2016}\n[D]Walking around these walls',
  }
  const status = getSongMetadataStatus(songWithDifferingKeys)
  assert.equal(status.status, 'METADATA_OK')
  assert.equal(status.isComplete, true)
  assert.equal(status.resolved.key, 'D')
  assert.equal(status.resolved.originalKey, 'G')
})

test('DEV5C_CORRECTION_4 & 5: Apply Metadata writes accepted title and original_key', () => {
  const initialContent = `{artist: Elevation Worship}
[G]Walking around these walls`

  const appliedContent = syncCanonicalDirectives(initialContent, {
    title: 'Do It Again',
    artist: 'Elevation Worship',
    originalKey: 'G',
    tempo: '120 BPM',
    time: '4/4',
    year: '2016',
  })

  assert.ok(appliedContent.includes('{title: Do It Again}'), 'Apply Metadata must write accepted title')
  assert.ok(appliedContent.includes('{original_key: G}'), 'Apply Metadata must write original_key')
  assert.ok(appliedContent.includes('{artist: Elevation Worship}'))
  assert.ok(appliedContent.includes('{tempo: 120 BPM}'))
  assert.ok(appliedContent.includes('{time: 4/4}'))
  assert.ok(appliedContent.includes('{year: 2016}'))
})

test('DEV5C_CORRECTION_6: Apply Metadata preserves existing {key: D} when original_key is G', () => {
  const initialContent = `{title: Do It Again}
{artist: Elevation Worship}
{key: D}
{tempo: 120 BPM}
{time: 4/4}
{year: 2016}

[D]Walking around these walls`

  // Applying suggestion where original_key is G without touching chart key
  const appliedContent = syncCanonicalDirectives(initialContent, {
    title: 'Do It Again',
    artist: 'Elevation Worship',
    originalKey: 'G',
    tempo: '120 BPM',
    time: '4/4',
    year: '2016',
  })

  assert.ok(appliedContent.includes('{key: D}'), 'Apply Metadata must preserve existing {key: D}')
  assert.ok(appliedContent.includes('{original_key: G}'), 'Apply Metadata must add {original_key: G}')
  assert.ok(!appliedContent.includes('{key: G}'), 'Apply Metadata must never overwrite {key} from original_key')
})

test('DEV5C_CORRECTION_7: Apply Metadata with no existing {key} does NOT create {key: G}', () => {
  const initialContent = `{title: Do It Again}
{artist: Elevation Worship}

[G]Walking around these walls`

  const appliedContent = syncCanonicalDirectives(initialContent, {
    title: 'Do It Again',
    artist: 'Elevation Worship',
    originalKey: 'G',
    tempo: '120 BPM',
    time: '4/4',
    year: '2016',
  })

  assert.ok(appliedContent.includes('{original_key: G}'), 'Must write original_key directive')
  assert.ok(!appliedContent.includes('{key: G}'), 'Must NOT create {key: G} when {key} was absent')
  assert.doesNotMatch(appliedContent, /\{key:/i, 'Must have no {key} directive created')
})

test('DEV5C_CORRECTION_8 & 9: Apply Metadata never changes chord body and never invokes transpose', () => {
  const initialContent = `{title: Do It Again}
{artist: Elevation Worship}
{key: D}

[D]Walking around these [A]walls [Bm]I thought were too high`

  const appliedContent = syncCanonicalDirectives(initialContent, {
    title: 'Do It Again',
    artist: 'Elevation Worship',
    originalKey: 'G',
  })

  // Chord body must remain identical
  assert.ok(
    appliedContent.includes('[D]Walking around these [A]walls [Bm]I thought were too high'),
    'Chord lines must remain completely untouched during metadata application'
  )
  assert.ok(!appliedContent.includes('[G]Walking around'), 'Chords must not be transposed')

  // Explicit transpose is separate deterministic operation
  const transposed = transposeCanonicalSong(appliedContent, 'D', 'G')
  assert.equal(transposed.key, 'G')
  assert.ok(transposed.rawContent.includes('[G]Walking around these [D]walls [Em]I thought were too high'))
})

test('DEV5C_CORRECTION_10: main Songbook and side-panel Metadata status use identical corrected semantics', () => {
  const songbookSource = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')
  const drawerSource = fs.readFileSync(path.join(webDir, 'src/components/SetlistDrawer.tsx'), 'utf8')
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')

  // Both SongbookHomeView and SetlistDrawer import and use getSongMetadataStatus
  assert.ok(songbookSource.includes("import { getSongMetadataStatus } from '../utils/chordProMetadata'"))
  assert.ok(drawerSource.includes("import { getSongMetadataStatus } from '../utils/chordProMetadata'"))
  assert.ok(songbookSource.includes('getSongMetadataStatus(song).status'))
  assert.ok(drawerSource.includes('getSongMetadataStatus(item)'))

  // DesktopEditor handles meta.title in handleApplyMetadataOnly
  assert.ok(editorSource.includes('setLocalTitle(meta.title.trim())'))
  assert.ok(editorSource.includes('updates.title = meta.title.trim()'))

  // DesktopEditor suggestion UI labels reference key as Orig Key or Original Key, not current chart Key
  assert.ok(editorSource.includes('Orig Key:'))
  assert.ok(editorSource.includes('Current Key:'))
})
