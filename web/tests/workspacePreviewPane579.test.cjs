// GH579 Phase 2: Desktop/Tablet Master-Detail Workspace Preview Pane tests
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => {
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText,
      filename
    )
  }
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const bootDom = new JSDOM('<!doctype html>')
Object.assign(global, { window: bootDom.window, document: bootDom.window.document })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const h = React.createElement

const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { SetlistWorkspace } = require('../src/components/SetlistWorkspace.tsx')
const { WorkspacePreviewPane } = require('../src/components/WorkspacePreviewPane.tsx')
const { WorkspaceSongPreview } = require('../src/components/WorkspaceSongPreview.tsx')
const {
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_WIDTH_STORAGE_KEY,
  clampWorkspaceWidth,
  readWorkspaceEnabled,
  readWorkspaceWidth,
} = require('../src/utils/workspacePreview.ts')

let dom, root

const sampleSongs = [
  { id: 's1', title: 'Amazing Grace', artist: 'John Newton', key: 'G', rawContent: '{key: G}\n[G]Amazing [D]grace', format: 'CHORD_PRO', transposeOffset: 0 },
  { id: 's2', title: 'Goodness of God', artist: 'Bethel Music', key: 'Ab', rawContent: '{key: Ab}\n[Ab]Goodness [Eb]of God', format: 'CHORD_PRO', transposeOffset: 0 },
  { id: 's3', title: 'Great Are You Lord', artist: 'All Sons & Daughters', key: 'A', rawContent: '{key: A}\n[A]Great are You [D]Lord', format: 'CHORD_PRO', transposeOffset: 0 },
]

const sampleSetlists = [
  {
    id: 'sl-1',
    name: 'Sunday Morning',
    createdAt: 1000,
    folderId: null,
    songs: [
      { id: 's1', title: 'Amazing Grace' },
      { id: 's2', title: 'Goodness of God' },
    ],
  },
  {
    id: 'sl-2',
    name: 'Youth Service',
    createdAt: 2000,
    folderId: null,
    songs: [{ id: 's3', title: 'Great Are You Lord' }],
  },
]

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
  dom.window.innerWidth = 1200
  dom.window.innerHeight = 800
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    PointerEvent: dom.window.PointerEvent || dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  global.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
    root = null
  }
  dom.window.close()
})

test('WORKSPACE_STORAGE: defaults to false when uninitialized; persists on change', () => {
  localStorage.removeItem(WORKSPACE_STORAGE_KEY)
  assert.equal(readWorkspaceEnabled(), false)

  localStorage.setItem(WORKSPACE_STORAGE_KEY, 'true')
  assert.equal(readWorkspaceEnabled(), true)

  localStorage.setItem(WORKSPACE_STORAGE_KEY, 'false')
  assert.equal(readWorkspaceEnabled(), false)
})

test('WORKSPACE_WIDTH: clamps to valid min and max boundaries', () => {
  assert.equal(clampWorkspaceWidth(100), 280)
  assert.equal(clampWorkspaceWidth(400), 400)
  assert.equal(clampWorkspaceWidth(1000), 680)

  localStorage.setItem(WORKSPACE_WIDTH_STORAGE_KEY, '500')
  assert.equal(readWorkspaceWidth(), 500)
})

test('WORKSPACE_TOGGLE: renders toggle button in songs toolbar and setlists toolbar on desktop/tablet', async () => {
  const container = document.getElementById('root')
  root = createRoot(container)

  let workspaceToggled = false
  await act(async () => {
    root.render(
      h(SongbookHomeView, {
        songs: sampleSongs,
        activeSongIndex: 0,
        onSelectSong: () => {},
        onNewSong: () => {},
        onOpenSetlists: () => {},
        onDeleteSong: () => {},
        onSongMembershipChange: () => true,
        onCreateSetlistForSong: () => true,
        setlists: sampleSetlists,
        isWorkspaceOpen: false,
        onToggleWorkspace: () => { workspaceToggled = true },
      })
    )
  })

  const toggle = document.querySelector('[data-testid="workspace-toggle"]')
  assert.ok(toggle, 'Workspace toggle button must exist in toolbar')
  assert.equal(toggle.getAttribute('aria-pressed'), 'false')
  assert.equal(toggle.getAttribute('aria-label'), 'Show Preview Pane')

  await act(async () => {
    toggle.click()
  })
  assert.equal(workspaceToggled, true)
})

test('ALL_SONGS_WORKSPACE: selecting a song updates preview pane with title, artist, key and chords without opening stage', async () => {
  const container = document.getElementById('root')
  root = createRoot(container)

  let stageOpenedIndex = null
  let previewedIndex = null

  const Harness = () => {
    const [activeIdx, setActiveIdx] = React.useState(0)
    return h(SongbookHomeView, {
      songs: sampleSongs,
      activeSongIndex: activeIdx,
      onSelectSong: (idx) => { stageOpenedIndex = idx },
      onPreviewSong: (idx) => {
        previewedIndex = idx
        setActiveIdx(idx)
      },
      onNewSong: () => {},
      onOpenSetlists: () => {},
      onDeleteSong: () => {},
      onSongMembershipChange: () => true,
      onCreateSetlistForSong: () => true,
      setlists: sampleSetlists,
      isWorkspaceOpen: true,
      onToggleWorkspace: () => {},
    })
  }

  await act(async () => {
    root.render(h(Harness))
  })

  // Preview pane is open
  const pane = document.querySelector('[data-testid="workspace-preview-pane"]')
  assert.ok(pane, 'Workspace preview pane must be rendered')
  assert.equal(pane.getAttribute('data-open'), 'true')

  // Initial song is previewed (s1: Amazing Grace)
  const title = document.querySelector('[data-testid="workspace-preview-title"]')
  assert.ok(title.textContent.includes('Amazing Grace'))

  // Click song card 1 (Goodness of God)
  const songCard1 = document.querySelector('[data-testid="song-card-1"]')
  assert.ok(songCard1)

  await act(async () => {
    songCard1.click()
  })

  // Stage should NOT have opened directly
  assert.equal(stageOpenedIndex, null, 'Clicking song in workspace mode should not open Stage immediately')
  assert.equal(previewedIndex, 1, 'onPreviewSong should be called with selected index')

  // Preview pane should now display Goodness of God
  const updatedTitle = document.querySelector('[data-testid="workspace-preview-title"]')
  assert.ok(updatedTitle.textContent.includes('Goodness of God'))

  // Selected card must be highlighted
  assert.ok(songCard1.className.includes('ui-selection-card'), 'Selected card must have selection styling')
})

test('ALL_SONGS_WORKSPACE: Maximize button opens full Stage with correct song and key', async () => {
  const container = document.getElementById('root')
  root = createRoot(container)

  let maximizedSongIndex = null

  await act(async () => {
    root.render(
      h(SongbookHomeView, {
        songs: sampleSongs,
        activeSongIndex: 1,
        onSelectSong: (idx) => { maximizedSongIndex = idx },
        onNewSong: () => {},
        onOpenSetlists: () => {},
        onDeleteSong: () => {},
        onSongMembershipChange: () => true,
        onCreateSetlistForSong: () => true,
        setlists: sampleSetlists,
        isWorkspaceOpen: true,
        onToggleWorkspace: () => {},
      })
    )
  })

  const maxBtn = document.querySelector('[data-testid="workspace-maximize-btn"]')
  assert.ok(maxBtn, 'Maximize button must exist on song preview pane')

  await act(async () => {
    maxBtn.click()
  })

  assert.equal(maximizedSongIndex, 1, 'Maximize button must open stage with active song index')
})

test('ALL_SONGS_WORKSPACE: Transpose controls in preview update transpose offset', async () => {
  const container = document.getElementById('root')
  root = createRoot(container)

  let updatedSong = null

  await act(async () => {
    root.render(
      h(WorkspaceSongPreview, {
        song: sampleSongs[0],
        onMaximize: () => {},
        onTransposeChange: (newOffset) => {
          updatedSong = { ...sampleSongs[0], transposeOffset: newOffset }
        },
      })
    )
  })

  const upBtn = document.querySelector('[data-testid="workspace-transpose-up"]')
  const downBtn = document.querySelector('[data-testid="workspace-transpose-down"]')
  assert.ok(upBtn && downBtn)

  await act(async () => {
    upBtn.click()
  })
  assert.equal(updatedSong.transposeOffset, 1, 'Transposing up should increment offset by 1')

  await act(async () => {
    downBtn.click()
  })
  assert.equal(updatedSong.transposeOffset, -1, 'Transposing down should decrement offset by 1')
})

test('ALL_SETLISTS_WORKSPACE: Workspace ON shows left setlist cards and right integrated options pane', async () => {
  const container = document.getElementById('root')
  root = createRoot(container)

  let selectedSetlistId = 'sl-1'
  let playedInStage = null

  const Harness = () => {
    const [openId, setOpenId] = React.useState(selectedSetlistId)
    return h(SetlistWorkspace, {
      scope: 'ALL_SETLISTS',
      setlists: sampleSetlists,
      songs: sampleSongs,
      openSetlistId: openId,
      onOpenSetlistChange: (id) => {
        selectedSetlistId = id
        setOpenId(id)
      },
      onPlaySetlistPosition: (slId, pos) => {
        playedInStage = { slId, pos }
      },
      isWorkspaceOpen: true,
      onToggleWorkspace: () => {},
    })
  }

  await act(async () => {
    root.render(h(Harness))
  })

  // Both the left setlist cards and right setlist detail pane exist simultaneously!
  const leftCard0 = document.querySelector('[data-testid="workspace-setlist-card-sl-1"]')
  const leftCard1 = document.querySelector('[data-testid="workspace-setlist-card-sl-2"]')
  assert.ok(leftCard0, 'Left list must contain setlist cards')
  assert.ok(leftCard1, 'Left list must contain setlist cards')

  // Selected card sl-1 must be highlighted
  assert.ok(leftCard0.className.includes('ui-selection-card'), 'Selected setlist card must have selection styling')

  // Right pane has the integrated options header and actions
  const rightPane = document.querySelector('[data-testid="setlist-workspace-preview-pane"]')
  assert.ok(rightPane, 'Right setlist preview pane must exist')
  assert.equal(rightPane.getAttribute('data-open'), 'true')

  const setlistName = rightPane.querySelector('[data-testid="workspace-setlist-name"]')
  assert.ok(setlistName.textContent.includes('Sunday Morning'))

  // No maximize button in setlist preview pane!
  const maxBtn = rightPane.querySelector('[data-testid="workspace-maximize-btn"]')
  assert.equal(maxBtn, null, 'Do not add a Setlist Preview maximize button')

  // Play in Stage is present and functional
  const playBtn = rightPane.querySelector('[data-testid="workspace-play-setlist"]')
  assert.ok(playBtn, 'Play in Stage must be available')

  await act(async () => {
    playBtn.click()
  })
  assert.deepEqual(playedInStage, { slId: 'sl-1', pos: 0 })

  // Clicking another setlist card updates the right pane
  await act(async () => {
    leftCard1.click()
  })
  assert.equal(selectedSetlistId, 'sl-2')
  const updatedSetlistName = rightPane.querySelector('[data-testid="workspace-setlist-name"]')
  assert.ok(updatedSetlistName.textContent.includes('Youth Service'))
})

test('NAVIGATION_RESTORATION: Returning from Stage preserves Workspace mode and selection', async () => {
  const container = document.getElementById('root')
  root = createRoot(container)

  let currentView = 'songbook'
  let activeSong = 2
  const isWorkspace = true

  const AppSimulation = ({ view }) => {
    if (view === 'stage') {
      return h('div', { 'data-testid': 'stage-view' },
        h('button', {
          'data-testid': 'stage-back-btn',
          onClick: () => { currentView = 'songbook' },
        }, 'Back')
      )
    }
    return h(SongbookHomeView, {
      songs: sampleSongs,
      activeSongIndex: activeSong,
      onSelectSong: (idx) => { activeSong = idx; currentView = 'stage' },
      onPreviewSong: (idx) => { activeSong = idx },
      onNewSong: () => {},
      onOpenSetlists: () => {},
      onDeleteSong: () => {},
      onSongMembershipChange: () => true,
      onCreateSetlistForSong: () => true,
      setlists: sampleSetlists,
      isWorkspaceOpen: isWorkspace,
      onToggleWorkspace: () => {},
    })
  }

  // Initial render: Songbook Workspace ON with song 2 (Great Are You Lord)
  await act(async () => {
    root.render(h(AppSimulation, { view: currentView }))
  })

  let title = document.querySelector('[data-testid="workspace-preview-title"]')
  assert.ok(title.textContent.includes('Great Are You Lord'))

  // Maximize to Stage
  const maxBtn = document.querySelector('[data-testid="workspace-maximize-btn"]')
  await act(async () => {
    maxBtn.click()
  })
  assert.equal(currentView, 'stage')

  // Render Stage View
  await act(async () => {
    root.render(h(AppSimulation, { view: currentView }))
  })
  assert.ok(document.querySelector('[data-testid="stage-view"]'))

  // Press Back in Stage
  const backBtn = document.querySelector('[data-testid="stage-back-btn"]')
  await act(async () => {
    backBtn.click()
  })
  assert.equal(currentView, 'songbook')

  // Render Songbook again
  await act(async () => {
    root.render(h(AppSimulation, { view: currentView }))
  })

  // Check that the same song is still previewed and pane is still open!
  title = document.querySelector('[data-testid="workspace-preview-title"]')
  assert.ok(title, 'Preview pane must still be open')
  assert.ok(title.textContent.includes('Great Are You Lord'), 'Same song must remain selected')
})

test('WORKSPACE_OFF: Restores original full-width browsing layout immediately', async () => {
  const container = document.getElementById('root')
  root = createRoot(container)

  let stageOpenedIdx = null

  await act(async () => {
    root.render(
      h(SongbookHomeView, {
        songs: sampleSongs,
        activeSongIndex: 0,
        onSelectSong: (idx) => { stageOpenedIdx = idx },
        onNewSong: () => {},
        onOpenSetlists: () => {},
        onDeleteSong: () => {},
        onSongMembershipChange: () => true,
        onCreateSetlistForSong: () => true,
        setlists: sampleSetlists,
        isWorkspaceOpen: false,
        onToggleWorkspace: () => {},
      })
    )
  })

  // Preview pane is collapsed / closed
  const pane = document.querySelector('[data-testid="workspace-preview-pane"]')
  assert.equal(pane.getAttribute('data-open'), 'false')
  assert.ok(pane.className.includes('w-0'), 'Pane must be collapsed when Workspace OFF')

  // Clicking a card directly opens Stage
  const songCard0 = document.querySelector('[data-testid="song-card-0"]')
  await act(async () => {
    songCard0.click()
  })
  assert.equal(stageOpenedIdx, 0, 'Clicking card in Workspace OFF opens Stage immediately')
})

test('PREVIEW_PANE_RESIZING: Resize handle supports pointer dragging and keyboard arrows', async () => {
  const container = document.getElementById('root')
  root = createRoot(container)

  let currentWidth = 440

  const Harness = () => {
    const [w, setW] = React.useState(currentWidth)
    return h(WorkspacePreviewPane, {
      isOpen: true,
      width: w,
      onWidthChange: (newW) => {
        currentWidth = newW
        setW(newW)
      },
      ariaLabel: 'Preview Pane',
      testId: 'workspace-preview-pane',
    }, h('div', null, 'Content'))
  }

  await act(async () => {
    root.render(h(Harness))
  })

  const resizeHandle = document.querySelector('[data-testid="workspace-resize-handle"]')
  assert.ok(resizeHandle, 'Resize handle must exist when pane is open')

  // Keyboard ArrowLeft expands width
  await act(async () => {
    resizeHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  })
  assert.equal(currentWidth, 456, 'ArrowLeft should widen the pane by 16px')

  // Keyboard ArrowRight shrinks width
  await act(async () => {
    resizeHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  assert.equal(currentWidth, 440, 'ArrowRight should shrink the pane by 16px')
})
