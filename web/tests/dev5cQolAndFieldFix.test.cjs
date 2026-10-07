const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const jsQR = require('jsqr')
const ts = require("typescript");

for (const ext of [".ts", ".tsx"]) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, "utf8").replaceAll("import.meta.env", "({DEV:false})"),
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
    );
}


const webDir = path.resolve(__dirname, '..')

// 1. VERSION CONTRACT (1.0.123-dev.5c)
test('DEV5C_VERSION_CONTRACT: Canonical version updated to 1.0.123-dev.5c across manifests and types', () => {
  const { GTAR_DEV_VERSION } = require(path.join(webDir, 'src/types/gtar.ts'))
  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  const pkgLockJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')

  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.5c', 'gtar.ts GTAR_DEV_VERSION must be 1.0.123-dev.5c')
  assert.equal(pkgJson.version, '1.0.123-dev.5c', 'package.json version must be 1.0.123-dev.5c')
  assert.equal(pkgLockJson.version, '1.0.123-dev.5c', 'package-lock.json root version must be 1.0.123-dev.5c')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.5c', 'package-lock.json packages[""] must be 1.0.123-dev.5c')
  assert.ok(authCore.includes('v1.0.123-dev.5c'), 'authCore.ts header must reference v1.0.123-dev.5c')
})

// 2. DELIVERABLE 1: CANONICAL METADATA STATUS PREDICATE
test('DELIVERABLE 1: getSongMetadataStatus determines METADATA_OK and NEEDS_METADATA deterministically', () => {
  const { getSongMetadataStatus } = require(path.join(webDir, 'src/utils/chordProMetadata.ts'))

  // Complete song with all required reference metadata (even with no key)
  const completeSong = {
    title: 'Hotel California',
    artist: 'Eagles',
    originalKey: 'Bm',
    bpm: '75',
    time: '4/4',
    year: '1976',
    rawContent: '{title: Hotel California}\n{artist: Eagles}\n{original_key: Bm}\n{tempo: 75}\n{time: 4/4}\n{year: 1976}\n[Bm]Welcome to the Hotel California',
  }
  const status1 = getSongMetadataStatus(completeSong)
  assert.equal(status1.status, 'METADATA_OK')
  assert.equal(status1.missingFields.length, 0)
  assert.equal(status1.resolved.title, 'Hotel California')
  assert.equal(status1.resolved.artist, 'Eagles')
  assert.equal(status1.resolved.originalKey, 'Bm')
  assert.equal(status1.resolved.tempo, 75)
  assert.equal(status1.resolved.timeSignature, '4/4')
  assert.equal(status1.resolved.year, 1976)

  // Case-insensitive Unknown Artist check
  const unknownArtistSong = {
    title: 'Some Song',
    artist: 'unknown artist',
    originalKey: 'G',
    bpm: '120',
    time: '4/4',
    year: '2020',
  }
  const statusUnknown = getSongMetadataStatus(unknownArtistSong)
  assert.equal(statusUnknown.status, 'NEEDS_METADATA')
  assert.ok(statusUnknown.missingFields.includes('artist'))

  // Missing title, artist, originalKey, tempo, time, year (key is NOT in missingFields)
  const emptySong = {
    title: '',
    artist: '',
  }
  const statusEmpty = getSongMetadataStatus(emptySong)
  assert.equal(statusEmpty.status, 'NEEDS_METADATA')
  assert.ok(statusEmpty.missingFields.includes('title'))
  assert.ok(statusEmpty.missingFields.includes('artist'))
  assert.ok(statusEmpty.missingFields.includes('originalKey'))
  assert.ok(!statusEmpty.missingFields.includes('key'))
  assert.ok(statusEmpty.missingFields.includes('tempo'))
  assert.ok(statusEmpty.missingFields.includes('time'))
  assert.ok(statusEmpty.missingFields.includes('year'))

  // Tempo bounds: < 30 or > 300
  const outOfRangeTempo = {
    ...completeSong,
    bpm: '25',
  }
  const statusLowTempo = getSongMetadataStatus(outOfRangeTempo)
  assert.equal(statusLowTempo.status, 'NEEDS_METADATA')
  assert.ok(statusLowTempo.missingFields.includes('tempo'))

  const highTempo = {
    ...completeSong,
    bpm: '350',
  }
  assert.equal(getSongMetadataStatus(highTempo).status, 'NEEDS_METADATA')

  // Valid 4-digit year grammar
  const invalidYear = {
    ...completeSong,
    year: '76',
  }
  assert.equal(getSongMetadataStatus(invalidYear).status, 'NEEDS_METADATA')

  // Valid time signature grammar
  const invalidTime = {
    ...completeSong,
    time: 'common',
  }
  assert.equal(getSongMetadataStatus(invalidTime).status, 'NEEDS_METADATA')

  // Missing originalKey => NEEDS_METADATA even when current key exists
  const missingOrigKey = {
    title: 'Song With Key But No Orig Key',
    artist: 'Artist',
    key: 'D',
    tempo: 120,
    time: '4/4',
    year: 2020,
  }
  const statusMissingOrig = getSongMetadataStatus(missingOrigKey)
  assert.equal(statusMissingOrig.status, 'NEEDS_METADATA')
  assert.ok(statusMissingOrig.missingFields.includes('originalKey'))

  // {key: D} + {original_key: G} => METADATA_OK when all reference metadata is complete
  const validDifferingKeys = { ...completeSong, key: 'D', originalKey: 'G' }
  const statusValidDiffering = getSongMetadataStatus(validDifferingKeys)
  assert.equal(statusValidDiffering.status, 'METADATA_OK')
  assert.equal(statusValidDiffering.resolved.key, 'D')
  assert.equal(statusValidDiffering.resolved.originalKey, 'G')

  // Malformed originalKey: NEEDS_METADATA
  const malformedOrigKey = { ...completeSong, originalKey: 'InvalidKeyString' }
  const statusMalformedOrig = getSongMetadataStatus(malformedOrigKey)
  assert.equal(statusMalformedOrig.status, 'NEEDS_METADATA')
  assert.ok(statusMalformedOrig.missingFields.includes('originalKey'))
})

// 3. DELIVERABLE 3: QR CODE DECODE ROUNDTRIP WITH JSQR
test('DELIVERABLE 3: generateQrMatrix decodes identically via independent jsQR decoder', () => {
  const { generateQrMatrix, generateQrSvgDataUri } = require(path.join(webDir, 'src/utils/qrCode.ts'))

  const testUrls = [
    // Representative GTAR share URL
    'https://gtar.pages.dev/?share=0123456789abcdef',
    // Short URL
    'https://gtar.dev/?share=a1b2c3d4e5f60718',
    // Longer URL / query params
    'https://gtar-preview.pages.dev/stage?setlist=SundayService&share=fedcba9876543210&source=pwa',
    // Unicode content
    'https://gtar.dev/?title=Awit%20ng%20Puso&share=1122334455667788',
  ]

  for (const url of testUrls) {
    const matrix = generateQrMatrix(url)
    assert.ok(Array.isArray(matrix))
    assert.ok(matrix.length > 0)
    assert.equal(matrix.length, matrix[0].length)

    // Render matrix into raw RGBA ImageData for jsQR
    // Add 4-module quiet zone (as required by standard QR decoder)
    const quietZone = 4
    const qrSize = matrix.length
    const totalSize = qrSize + quietZone * 2
    const scale = 4
    const imgWidth = totalSize * scale
    const imgHeight = totalSize * scale
    const rgba = new Uint8ClampedArray(imgWidth * imgHeight * 4)

    // Fill white background
    rgba.fill(255)

    // Paint dark modules
    for (let r = 0; r < qrSize; r++) {
      for (let c = 0; c < qrSize; c++) {
        if (matrix[r][c]) {
          const startX = (c + quietZone) * scale
          const startY = (r + quietZone) * scale
          for (let py = 0; py < scale; py++) {
            for (let px = 0; px < scale; px++) {
              const idx = ((startY + py) * imgWidth + (startX + px)) * 4
              rgba[idx] = 0     // R
              rgba[idx + 1] = 0 // G
              rgba[idx + 2] = 0 // B
              rgba[idx + 3] = 255 // A
            }
          }
        }
      }
    }

    const decoded = jsQR(rgba, imgWidth, imgHeight)
    assert.ok(decoded, `jsQR failed to decode matrix for payload: ${url}`)
    assert.equal(decoded.data, url, `Decoded payload mismatch: expected ${url}, got ${decoded.data}`)

    // Also verify SVG Data URI string format
    const svgUri = generateQrSvgDataUri(url)
    assert.ok(svgUri.startsWith('data:image/svg+xml;utf8,'), 'SVG Data URI must start with data:image/svg+xml;utf8,')
    assert.ok(decodeURIComponent(svgUri).includes('<svg'), 'SVG Data URI must contain svg element')
  }
})

// 4. DELIVERABLE 5: SHARE TOKEN EXTRACTION AND VALIDATION
test('DELIVERABLE 5: extractShareToken validates GTAR URLs and tokens strictly fail-closed', () => {
  const { extractShareToken } = require(path.join(webDir, 'src/utils/sharedSetlist.ts'))

  // Valid 16-hex token
  const res1 = extractShareToken('455b990190184e73')
  assert.equal(res1.isValid, true)
  assert.equal(res1.token, '455b990190184e73')

  // Valid relative / query URL
  const res2 = extractShareToken('/?share=455b990190184e73')
  assert.equal(res2.isValid, true)
  assert.equal(res2.token, '455b990190184e73')

  // Valid same-origin style absolute URL
  const res3 = extractShareToken('https://localhost:8788/?share=abcdef0123456789')
  assert.equal(res3.isValid, true)
  assert.equal(res3.token, 'abcdef0123456789')

  // Invalid: missing token
  const resMissing = extractShareToken('https://localhost:8788/')
  assert.equal(resMissing.isValid, false)

  // Invalid: non-hex or wrong length
  const resWrongLen = extractShareToken('/?share=12345')
  assert.equal(resWrongLen.isValid, false)

  const resNonHex = extractShareToken('/?share=zzzzzzzzzzzzzzzz')
  assert.equal(resNonHex.isValid, false)

  // Invalid: empty string
  const resEmpty = extractShareToken('   ')
  assert.equal(resEmpty.isValid, false)
})

// 5. DELIVERABLE 10: SAFE DEV REMOTE D1 MIGRATION TOOLING
test('DELIVERABLE 10: migrate-dev-remote.cjs strictly enforces preview env, DB name, and UUID', () => {
  const { runValidation, EXPECTED_DB_NAME, EXPECTED_DB_UUID, EXPECTED_ENV } = require(path.join(webDir, 'scripts/migrate-dev-remote.cjs'))

  assert.equal(EXPECTED_DB_NAME, 'gtar-db-dev')
  assert.equal(EXPECTED_DB_UUID, '455b9901-9018-4e73-9ac1-a684f7335def')
  assert.equal(EXPECTED_ENV, 'preview')

  const target = runValidation(webDir)
  assert.equal(target.databaseName, 'gtar-db-dev')
  assert.equal(target.databaseId, '455b9901-9018-4e73-9ac1-a684f7335def')
  assert.equal(target.env, 'preview')
  assert.equal(target.configFile, 'wrangler.jsonc')
})

// 6. DELIVERABLE 6, 7, 8, 9: UI AND SOURCE CODE CONTRACT VERIFICATION
test('DELIVERABLES 6, 7, 8, 9: Source code checks for Manage parity, Metadata filtering, Active Setlist only, and Side Panel badges', () => {
  const songbookSource = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')
  const drawerSource = fs.readFileSync(path.join(webDir, 'src/components/SetlistDrawer.tsx'), 'utf8')

  // Manage parity (Deliverable 6)
  assert.ok(songbookSource.includes('Manage'), 'SongbookHomeView must display Manage action')
  assert.ok(songbookSource.includes('data-testid="toggle-song-selection-mode"'), 'Must keep selection mode testid')

  // Metadata filter & Library Order (Deliverable 7)
  assert.ok(songbookSource.includes('data-testid="filter-metadata-select"'), 'SongbookHomeView must have metadata filter select')
  assert.ok(songbookSource.includes('Metadata OK'), 'Must have Metadata OK filter option')
  assert.ok(songbookSource.includes('Needs Metadata'), 'Must have Needs Metadata filter option')
  assert.ok(songbookSource.includes('Library Order'), 'Must use Library Order instead of Date Added')

  // Main page Share Setlist (Deliverable 4)
  assert.ok(songbookSource.includes('data-testid="main-share-setlist-btn"'), 'Main Gig Setlists header must have Share Setlist button')
  assert.ok(songbookSource.includes('Export JSON'), 'Legacy setlist export must be labeled Export JSON')

  // Link-first setlist import (Deliverable 5)
  assert.ok(songbookSource.includes('data-testid="main-import-setlist-btn"'), 'Main Gig Setlists header must have Import button')
  assert.ok(songbookSource.includes('data-testid="setlist-import-dialog"'), 'Must have Link-first setlist import dialog')
  assert.ok(songbookSource.includes('data-testid="paste-share-link-input"'), 'Must have paste share link input')

  // Tombstone exclusion (Deliverable 8)
  assert.ok(songbookSource.includes('activeSetlists'), 'SongbookHomeView must filter activeSetlists')
  assert.ok(!songbookSource.includes('setlists.map((sl) =>'), 'Must not map unfiltered setlists for selection choices')

  // Side-panel cards (Deliverable 9)
  assert.ok(drawerSource.includes('getSongMetadataStatus'), 'SetlistDrawer must use getSongMetadataStatus')
  assert.ok(drawerSource.includes('drawer-song-metadata-status'), 'SetlistDrawer cards must render metadata status badge')
  assert.ok(drawerSource.includes('drawer-song-add-to-setlist'), 'SetlistDrawer cards must render Add to Setlist button')
})
