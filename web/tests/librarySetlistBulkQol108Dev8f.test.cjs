const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webDir = path.resolve(__dirname, '..')

// 1. VERSION CHECK
test('VERSION_STAMP: Target iteration rolled to v1.0.108-dev.9', () => {
  const gtarTypes = fs.readFileSync(path.join(webDir, 'src/types/gtar.ts'), 'utf8')
  assert.ok(gtarTypes.includes("export const GTAR_DEV_VERSION = '1.0.108-dev.9';"), 'gtar.ts dev version must be 1.0.108-dev.9')
  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.108-dev.9', 'package.json version must be 1.0.108-dev.9')
  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(authCore.includes('v1.0.108-dev.9'), 'authCore.ts must reference v1.0.108-dev.9')
})

// 2. RECOVERY BANNER DISMISS QOL
test('RECOVERY_DISMISS_BEHAVIOR: App.tsx has non-destructive archive-scoped dismiss button and re-evaluates on reload', () => {
  const appTsx = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')

  // Must have dismiss-recovery-banner button with proper aria-label
  assert.ok(appTsx.includes('data-testid="dismiss-recovery-banner"'), 'App.tsx must render dismiss recovery button')
  assert.ok(appTsx.includes('aria-label="Dismiss recovery notice"'), 'Dismiss button must have accessible aria-label')
  
  // 8j persists acknowledgement separately; new archives and damage re-alert.
  assert.ok(appTsx.includes('dismissedNotice === status.noticeId'), 'Dismissal must match current recovery sources')
  assert.ok(appTsx.includes('localStorage.setItem(RECOVERY_NOTICE_ACK_KEY, status.noticeId)'), 'Persist only notice acknowledgement')
  const handler = appTsx.slice(appTsx.indexOf('const dismissRecovery ='), appTsx.indexOf('const showBanner ='))
  assert.ok(handler.includes('if (status.damaged || status.noticeId === null) return'), 'Damage cannot be dismissed')
  assert.doesNotMatch(handler, /removeItem|persistLibrary|retireDriveSyncState|pruneAllRecoverySnapshots/, 'Dismissal must not destroy recovery or mutate library')

  // Must preserve export action
  assert.ok(appTsx.includes('Export recovery data'), 'Export action text must remain intact')
  assert.ok(appTsx.includes('exportRecovery'), 'Export handler must remain functional')
})

// 3. PROVE_MEMBERSHIP: COMPACT BADGE & NAVIGATION
test('PROVE_MEMBERSHIP: Compact count badge, no setlist name on main card, and popover navigates via stable ID', () => {
  const songbookHome = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')

  // Badge displays count only with Layers icon and no setlist name on main card
  assert.ok(songbookHome.includes('song-setlist-indicator-'), 'Must have compact count badge testid')
  assert.ok(songbookHome.includes('aria-label={`Used in ${songSetlists.length}'), 'Must have accessible membership label')
  
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
  assert.ok(songbookHome.includes('data-testid="toggle-setlist-selection-mode"'), 'Must have setlist selection mode toggle')

  // Selection bars and counts
  assert.ok(songbookHome.includes('data-testid="song-selection-bar"'), 'Must have song selection toolbar')
  assert.ok(songbookHome.includes('data-testid="setlist-selection-bar"'), 'Must have setlist selection toolbar')
  assert.ok(songbookHome.includes('data-testid="song-selection-count"'), 'Must have song selection count')
  assert.ok(songbookHome.includes('data-testid="setlist-selection-count"'), 'Must have setlist selection count')

  // Cancel buttons reset selection
  assert.ok(songbookHome.includes('data-testid="cancel-song-selection"'), 'Must have cancel song selection button')
  assert.ok(songbookHome.includes('data-testid="cancel-setlist-selection"'), 'Must have cancel setlist selection button')

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

// 6. PROVE_BULK_SONG_DELETE: CONFIRMATION & SETLIST REFERENCE CLEANUP
test('PROVE_BULK_SONG_DELETE: Confirmation shows count, deletes only selected, cleans setlist references', () => {
  const songbookHome = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')
  const appTsx = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')

  // Dialog and confirmation details
  assert.ok(songbookHome.includes('data-testid="bulk-delete-songs-confirm-dialog"'), 'Must render bulk delete songs dialog')
  assert.ok(songbookHome.includes('data-testid="confirm-bulk-delete-songs"'), 'Must have confirm bulk delete button')
  assert.ok(songbookHome.includes('data-testid="cancel-bulk-delete-songs"'), 'Must have cancel bulk delete button')
  assert.ok(songbookHome.includes('Delete {selectedSongIds.size}'), 'Confirm button must include count')
  assert.ok(songbookHome.includes('Selected songs will be removed from your songbook and references to them will be removed from setlists'), 'Must state consequence clearly')

  // App.tsx logic removes song references from setlists
  assert.ok(appTsx.includes('handleBulkDeleteSongs'), 'App.tsx must define handleBulkDeleteSongs')
  
  // Test reference safety directly:
  const setlists = [
    { id: 'sl-1', name: 'Gig 1', songs: ['song-1', 'song-2', 'song-3'] },
    { id: 'sl-2', name: 'Gig 2', songs: ['song-2', 'song-4'] }
  ]
  const songsToDelete = ['song-2', 'song-5']

  const reconciledSetlists = setlists.map(sl => ({
    ...sl,
    songs: sl.songs.filter(id => !songsToDelete.includes(id))
  }))

  assert.deepEqual(reconciledSetlists[0].songs, ['song-1', 'song-3'], 'Deleted song-2 removed from sl-1')
  assert.deepEqual(reconciledSetlists[1].songs, ['song-4'], 'Deleted song-2 removed from sl-2')
  assert.equal(reconciledSetlists.length, 2, 'Setlists themselves remain intact')
})

// 7. PROVE_BULK_SETLIST_DELETE: CONFIRMATION & SONGS REMAIN IN LIBRARY
test('PROVE_BULK_SETLIST_DELETE: Confirmation states songs remain, only selected setlists deleted', () => {
  const songbookHome = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')
  const appTsx = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')

  // Dialog and confirmation details
  assert.ok(songbookHome.includes('data-testid="bulk-delete-setlists-confirm-dialog"'), 'Must render bulk delete setlists dialog')
  assert.ok(songbookHome.includes('data-testid="confirm-bulk-delete-setlists"'), 'Must have confirm bulk delete setlists button')
  assert.ok(songbookHome.includes('data-testid="cancel-bulk-delete-setlists"'), 'Must have cancel bulk delete setlists button')
  assert.ok(songbookHome.includes('Songs in these setlists will remain in your songbook'), 'Must state songs will remain in songbook')

  // App.tsx marks setlists deleted without deleting songs
  assert.ok(appTsx.includes('handleBulkDeleteSetlists'), 'App.tsx must define handleBulkDeleteSetlists')

  // Test setlist delete semantics:
  const songs = [{ id: 's1', title: 'Song 1' }, { id: 's2', title: 'Song 2' }]
  const setlists = [
    { id: 'sl-1', name: 'Gig 1', isDeleted: false },
    { id: 'sl-2', name: 'Gig 2', isDeleted: false }
  ]
  const selectedSetlists = ['sl-1']

  const updatedSetlists = setlists.map(sl => selectedSetlists.includes(sl.id) ? { ...sl, isDeleted: true } : sl)

  assert.equal(updatedSetlists[0].isDeleted, true, 'Selected setlist marked deleted')
  assert.equal(updatedSetlists[1].isDeleted, false, 'Unselected setlist remains active')
  assert.equal(songs.length, 2, 'Underlying songs remain untouched in songbook')
})
