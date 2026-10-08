const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('108-dev.1c: ImportDialogModal setlist import routing vs backup restore', () => {
  const modalPath = path.join(__dirname, '..', 'src', 'components', 'ImportDialogModal.tsx')
  const content = fs.readFileSync(modalPath, 'utf8')

  // Verify parseBackupJson is used for type detection & routing
  assert.ok(
    content.includes('parseBackupJson(text, { mode: \'merge\', existingSongs })'),
    'ImportDialogModal must use parseBackupJson to detect backup vs setlist JSON'
  )

  // Verify single setlist routing to onImportSingleSetlist
  assert.ok(
    content.includes('onImportSingleSetlist(parsed.setlists[0], parsed.songs as ActiveSongState[])'),
    'Single setlist JSON must route to onImportSingleSetlist'
  )

  // Verify smart merge routing when backup contains multiple setlists
  assert.ok(
    content.includes('onSmartMerge(parsed.songs, parsed.setlists)'),
    'Backup with setlists must route to onSmartMerge'
  )

  // Verify fallback parseFileContent rejects raw backup or single setlist JSON from becoming a raw song
  assert.ok(
    content.includes("parsed.exportType === 'SINGLE_SETLIST'"),
    'parseFileContent must never turn SINGLE_SETLIST json into a raw text chord song'
  )

  // Verify UI clarifies difference with Profile/Backup
  assert.ok(
    content.includes('Import Songs &amp; Setlists'),
    'UI header must clarify it supports Songs & Setlists'
  )
  assert.ok(
    content.includes('Looking for Full Library Backup / Restore?'),
    'UI must clarify distinction between Import dialog and Full Profile/Library Backup Restore'
  )
})
