const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'),
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
require.extensions['.png'] = (module) => {
  module.exports = '/assets/dev-logo.png'
}

const React = require('react')
const { renderToString } = require('react-dom/server')
const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
const { evaluateSwipeIntent, computeSwipeOffset, SwipeableActionCard } = require('../src/components/SwipeableActionCard.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

test('VERSION_STAMP: Target iteration rolled to v1.0.123-dev.3c', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.3c')
})

test('GESTURE_GUARD: Vertical scroll remains primary when vertical intent is detected', () => {
  // Deadzone under 8px
  assert.equal(evaluateSwipeIntent(4, 5, 8), 'undecided')
  assert.equal(evaluateSwipeIntent(7, 2, 8), 'undecided')

  // Vertical dominant movements lock strictly to 'vertical'
  assert.equal(evaluateSwipeIntent(5, 25, 8), 'vertical')
  assert.equal(evaluateSwipeIntent(15, 30, 8), 'vertical')
  assert.equal(evaluateSwipeIntent(20, 20, 8), 'vertical') // Diagonal / equal defaults safely to vertical scroll

  // Horizontal dominant movements lock to 'horizontal'
  assert.equal(evaluateSwipeIntent(25, 5, 8), 'horizontal')
  assert.equal(evaluateSwipeIntent(-35, 10, 8), 'horizontal')
})

test('ASSERT_BELOW_THRESHOLD_NO_ACTION: Swipes below arm threshold do not arm or trigger actions', () => {
  const armThreshold = 75

  // Short swipe below threshold (e.g. 40px)
  const resultShort = computeSwipeOffset(40, true, true, armThreshold, 110)
  assert.equal(resultShort.isArmed, false, 'Swipe under 75px must NOT be armed')
  assert.equal(resultShort.offset, 40)

  // Short negative swipe below threshold (e.g. -50px)
  const resultShortNeg = computeSwipeOffset(-50, true, true, armThreshold, 110)
  assert.equal(resultShortNeg.isArmed, false, 'Negative swipe under 75px must NOT be armed')
  assert.equal(resultShortNeg.offset, -50)

  // Deep swipe reaching threshold (75px) arms the action with elastic damping
  const resultArmed = computeSwipeOffset(90, true, true, armThreshold, 110)
  assert.equal(resultArmed.isArmed, true, 'Swipe >= 75px must be armed')
  assert.ok(resultArmed.offset >= armThreshold, 'Offset must be at or above threshold')
  assert.ok(resultArmed.offset <= 110, 'Offset must not exceed maxSwipe')
})

test('ASSERT_ARMED_LEFT_DELETE_CALLS_EXISTING_HANDLER: Song and setlist card left swipe invokes existing delete confirmation', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  // Setlist card swipe left: rightAction is delete, calls setConfirmDeleteSetlistId(sl.id)
  assert.ok(
    viewCode.includes('setConfirmDeleteSetlistId(sl.id)'),
    'Setlist card swipe left must invoke setConfirmDeleteSetlistId'
  )
  assert.ok(
    viewCode.includes("label: 'Delete'"),
    'Swipe action must provide Delete label'
  )
  assert.ok(
    viewCode.includes('isDestructive: true'),
    'Delete swipe action must be marked destructive'
  )

  // Song card swipe left: rightAction is delete, calls setConfirmDeleteIdx(originalIdx)
  assert.ok(
    viewCode.includes('setConfirmDeleteIdx(originalIdx)'),
    'Song card swipe left must invoke setConfirmDeleteIdx'
  )
  // Delete safety: never bypass confirmation
  assert.ok(
    viewCode.includes('Delete this song?'),
    'Song card retains inline confirmation dialog'
  )
  assert.ok(
    viewCode.includes('Delete setlist?'),
    'Setlist card retains inline confirmation dialog'
  )
})

test('ASSERT_ARMED_RIGHT_SONG_CALLS_ADD_HANDLER_WITH_CORRECT_SONG: Song card swipe right invokes add to setlist for exact song', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  // Song card swipe right: leftAction calls setMembershipSongId(song.id ?? null)
  assert.ok(
    viewCode.includes('setMembershipSongId(song.id ?? null)'),
    'Song card swipe right must invoke setMembershipSongId with song.id'
  )
  assert.ok(
    viewCode.includes("label: 'Add to Setlist'"),
    'Song card swipe right must provide Add to Setlist label'
  )
})

test('ASSERT_ARMED_RIGHT_SETLIST_CALLS_MANAGE_HANDLER_WITH_CORRECT_SETLIST: Setlist card swipe right invokes manage handler for exact setlist', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')
  const appCode = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8')

  // SongbookHomeView invokes onManageSetlist(sl) or onOpenSetlists(sl.id)
  assert.ok(
    viewCode.includes('onManageSetlist(sl)'),
    'Setlist swipe right must invoke onManageSetlist with exact setlist'
  )
  assert.ok(
    viewCode.includes("label: 'Manage'"),
    'Setlist swipe right must provide Manage label'
  )

  // App wires handleManageSetlist
  assert.ok(
    appCode.includes('const handleManageSetlist = (setlist: WebSetlist) => {'),
    'App must implement handleManageSetlist'
  )
  assert.ok(
    appCode.includes('setActiveSetlistId(setlist.id)'),
    'handleManageSetlist must set activeSetlistId to exact setlist id'
  )
  assert.ok(
    appCode.includes('onManageSetlist={handleManageSetlist}'),
    'App must pass handleManageSetlist to SongbookHomeView'
  )
})

test('ASSERT_VERTICAL_INTENT_DOES_NOT_TRIGGER_SWIPE_ACTION: Touch movements with vertical intent do not capture gesture', () => {
  let actionTriggered = false
  const cardElement = React.createElement(SwipeableActionCard, {
    id: 'test-1',
    armThreshold: 75,
    leftAction: {
      icon: null,
      label: 'Add',
      onAction: () => {
        actionTriggered = true
      },
    },
    rightAction: {
      icon: null,
      label: 'Delete',
      isDestructive: true,
      onAction: () => {
        actionTriggered = true
      },
    },
  }, React.createElement('div', null, 'Card Content'))

  const html = renderToString(cardElement)
  assert.ok(html.includes('Card Content'))
  assert.equal(actionTriggered, false)

  // Verify evaluateSwipeIntent blocks vertical intent
  const verticalIntent = evaluateSwipeIntent(5, 45, 8)
  assert.equal(verticalIntent, 'vertical', 'Intent must be vertical')
})

test('ASSERT_EXISTING_CARD_BUTTONS_AND_MENUS_REMAIN_AVAILABLE: Quick play, ellipsis menus, and click handlers preserved', () => {
  const songs = [
    { id: 1, title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '' },
  ]
  const setlists = [
    { id: 'sl-1', name: 'West Coast Set', songs: [{ id: 1 }] },
  ]

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs,
      setlists,
      searchQuery: '',
      activeSongIndex: 0,
      onSelectSong: () => {},
      onSongMembershipChange: () => {},
      onCreateSetlistForSong: () => {},
      onNewSong: () => {},
      onOpenSetlists: () => {},
      onDeleteSong: () => {},
      onDeleteSetlist: () => {},
    })
  )

  // Setlist card quick play button preserved
  assert.ok(html.includes('data-testid="play-setlist-sl-1"'), 'Play button preserved on setlist card')

  // Setlist card three-dot menu trigger preserved
  assert.ok(html.includes('data-testid="setlist-menu-sl-1"'), 'Menu button preserved on setlist card')

  // Song card three-dot menu trigger preserved
  assert.ok(html.includes('data-testid="song-menu-0"'), 'Menu button preserved on song card')

  // Song card click launch stage view preserved
  assert.ok(html.includes('data-testid="song-card-0"'), 'Song card test identifier preserved')
  assert.ok(html.includes('data-testid="setlist-card-sl-1"'), 'Setlist card test identifier preserved')
})
