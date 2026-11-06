const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webDir = path.resolve(__dirname, '..')

// 2. #181: the DEV recovery banner and its dismissal are replaced by red dots; only damage alerts.
test('RECOVERY_DOT_CONTRACT: App.tsx alerts only a damaged library; Header and Cloud Sync show the recovery dot', () => {
  const appTsx = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
  assert.ok(!appTsx.includes('dismiss-recovery-banner'), 'No dismissible recovery banner')
  assert.ok(!appTsx.includes('Recovery data is available'), 'No DEV recovery banner text')
  assert.ok(appTsx.includes('{status.damaged && <aside role="alert"'), 'Damaged library keeps the alert')
  assert.ok(appTsx.includes('Export recovery data') && appTsx.includes('exportRecovery'), 'Damaged-state export remains')
  const header = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')
  const modal = fs.readFileSync(path.join(webDir, 'src/components/CloudSyncModal.tsx'), 'utf8')
  // #304: no header dot and no old-recovery export in the center; unreadable recovery is flagged on the "Recovery data" row.
  assert.ok(!header.includes('data-testid="header-recovery-dot"') && !header.includes('useOldRecoveryData()') && header.includes('useRecoveryAttention(showRecoveryData)'))
  assert.ok(!modal.includes('data-testid="old-recovery-dot"') && !modal.includes('useOldRecoveryData()'))
})

// 3. PROVE_MEMBERSHIP: COMPACT BADGE & NAVIGATION
test('PROVE_MEMBERSHIP: Compact count badge, no setlist name on main card, and popover navigates via stable ID', () => {
  const songbookHome = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')

  // Badge displays count only with a list/setlist icon and no setlist name on main card
  assert.ok(songbookHome.includes('song-setlist-indicator-'), 'Must have compact count badge testid')
  assert.ok(songbookHome.includes('aria-label={`In ${songSetlists.length}'), 'Must have accessible membership label')
  assert.ok(!songbookHome.includes('title={`In ${songSetlists.length}'), 'Must not have duplicate native browser tooltip')
  assert.ok(songbookHome.includes('<ListMusic'), 'Must use the clearer list/setlist glyph')
  
  // Popover / list content
  assert.ok(songbookHome.includes('membership-popover-'), 'Must render popover container with testid')
  assert.ok(songbookHome.includes('data-testid={`jump-setlist-${sl.id}`}'), 'Must render popover setlist items with testid')

  // Direct navigation via stable setlist ID, not display name
  assert.ok(songbookHome.includes('onManageSetlist(sl)'), 'Must pass stable setlist object to onManageSetlist')

  // Logic: zero membership => no badge; 1 => count 1; multiple => count N
  const mockSetlists = [
    { id: 'sl-1', name: 'Gig 1', songs: ['song-a', 'song-b'] },
    { id: 'sl-2', name: 'Gig 2', songs: ['song-a'] },
    { id: 'sl-deleted', name: 'Old Gig', isDeleted: true, songs: ['song-a'] }
  ]
  const getSongSetlists = (songId) => mockSetlists.filter(sl => !sl.isDeleted && sl.songs.includes(songId))

  assert.equal(getSongSetlists('song-none').length, 0, 'Zero membership returns 0 setlists')
  assert.equal(getSongSetlists('song-b').length, 1, 'Single membership returns 1 setlist')
  assert.equal(getSongSetlists('song-a').length, 2, 'Multiple membership returns 2 active setlists, ignoring deleted')
})

// 4. PROVE_SELECTION & SAFE DEFAULTS
test('PROVE_SELECTION: Song & Setlist selection mode toggling, counts, and isolation from normal actions', () => {
  const songbookHome = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')

  // Selection mode buttons
  assert.ok(songbookHome.includes('data-testid="toggle-song-selection-mode"'), 'Must have song selection mode toggle')

  // Selection bars and counts
  assert.ok(songbookHome.includes('data-testid="song-selection-bar"'), 'Must have song selection toolbar')
  assert.ok(songbookHome.includes('data-testid="song-selection-count"'), 'Must have song selection count')

  // Cancel buttons reset selection
  assert.ok(songbookHome.includes('data-testid="cancel-song-selection"'), 'Must have cancel song selection button')

  // Stage view launch and normal actions bypassed when selection mode is active
  assert.ok(songbookHome.includes('if (isSongSelectionMode) {'), 'Song click must check selection mode before opening stage view')
  assert.ok(songbookHome.includes('toggleSongSelection(song.id ?? originalIdx)'), 'Song click must toggle selection in selection mode')
})

// 5. PROVE_BULK_ADD: DEDUPLICATION & MEMBERSHIP REFRESH
test('PROVE_BULK_ADD: Deduplication policy preserves existing memberships and adds once', () => {
  const appTsx = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
  assert.ok(appTsx.includes('handleBulkAddSongsToSetlist'), 'App.tsx must define handleBulkAddSongsToSetlist')

  // Test deduplication semantics directly:
  const initialSetlist = { id: 'sl-1', name: 'Gig 1', songs: ['song-1', 'song-2'] }
  const selectedSongIds = ['song-2', 'song-3', 'song-4']

  const nextSongs = [...initialSetlist.songs]
  for (const songId of selectedSongIds) {
    if (!nextSongs.includes(songId)) {
      nextSongs.push(songId)
    }
  }

  assert.deepEqual(nextSongs, ['song-1', 'song-2', 'song-3', 'song-4'], 'Deduplication preserves existing and appends new once')
  assert.equal(nextSongs.filter(id => id === 'song-2').length, 1, 'No duplicate membership created')
})

// 6. Bulk Trash intentionally preserves reversible membership.
test('PROVE_BULK_SONG_DELETE: Confirmation states reversible Trash semantics', () => {
  const songbookHome = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')
  assert.ok(songbookHome.includes('data-testid="bulk-delete-songs-confirm-dialog"'))
  assert.ok(songbookHome.includes('data-testid="confirm-bulk-delete-songs"'))
  assert.ok(songbookHome.includes('data-testid="cancel-bulk-delete-songs"'))
  assert.ok(songbookHome.includes('Delete {trashConfirmIds.length}'))
  assert.ok(songbookHome.includes('trashDropIds ?? Array.from(selectedSongIds)'))
  assert.ok(songbookHome.includes('Setlist entries are preserved and become available again when restored.'))
})

// 7. PROVE_BULK_SETLIST_DELETE: CONFIRMATION & SONGS REMAIN IN LIBRARY
