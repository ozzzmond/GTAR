const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
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
require.extensions['.png'] = (module) => {
  module.exports = '/logo.png'
}

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (fn) => fn(),
})
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

// Mock clipboard
let clipboardText = ''
Object.assign(navigator, {
  clipboard: {
    writeText: async (text) => {
      clipboardText = text
      return Promise.resolve()
    },
    readText: async () => clipboardText,
  },
})

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')

const SAMPLE_SONG = {
  id: 'song-416',
  title: 'Worship Song',
  artist: 'Praise Band',
  key: 'G',
  format: 'CHORD_PRO',
  transposeOffset: 0,
  rawContent: `{title: Worship Song}
{artist: Praise Band}
{key: G}

[Intro]
[G]  [C]  [G]  [D]

[Verse 1]
[G]Here in Your presence
[C]Lord I am healed

[Chorus]
[G]Hallelujah, [D]praise the Lord
[Em]Sing to the King [C]forever

[Verse 2]
[G]Faithful and true
[C]Your love endures

[Chorus]
[G]Hallelujah, [D]praise the Lord
[Em]Sing to the King [C]forever

[Outro]
[G]  [C]  [G]
`,
}

let root
let container

beforeEach(() => {
  container = document.getElementById('root')
  if (!container) {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)
  }
  root = createRoot(container)
  clipboardText = ''
})

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
  }
  container.innerHTML = ''
})

test('UX_SECTION_FOLDING: Recognizes standard ChordPro sections and displays folding controls', async () => {
  let updatedSong = null
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: (u) => {
          updatedSong = u
          return true
        },
      })
    )
  })

  const codeEditor = document.querySelector('[data-testid="chordpro-code-editor"]')
  assert.ok(codeEditor, 'ChordPro Code Editor must be rendered by default')

  // Intro, Verse 1, Chorus 1, Verse 2, Chorus 2, Outro should have section containers
  const introSection = document.querySelector('[data-testid="chordpro-section-sec-1"]')
  assert.ok(introSection, 'Intro section must exist')
  assert.match(introSection.textContent, /\[Intro\]/)

  const verse1Section = document.querySelector('[data-testid="chordpro-section-sec-2"]')
  assert.ok(verse1Section, 'Verse 1 section must exist')
  assert.match(verse1Section.textContent, /\[Verse 1\]/)

  const chorus1Section = document.querySelector('[data-testid="chordpro-section-sec-3"]')
  assert.ok(chorus1Section, 'Chorus 1 section must exist')
  assert.match(chorus1Section.textContent, /\[Chorus\]/)

  // Check fold buttons exist
  const foldBtnIntro = document.querySelector('[data-testid="fold-btn-sec-1"]')
  assert.ok(foldBtnIntro, 'Fold button for Intro must exist')
  assert.equal(foldBtnIntro.getAttribute('aria-expanded'), 'true')
})

test('UX_SECTION_FOLDING: Collapses and expands sections without mutating source', async () => {
  let updatedSong = null
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: (u) => {
          updatedSong = u
          return true
        },
      })
    )
  })

  const foldBtnVerse1 = document.querySelector('[data-testid="fold-btn-sec-2"]')
  assert.ok(foldBtnVerse1)

  // Before folding, section textarea exists and contains lyrics
  const verse1TextareaBefore = document.querySelector('[data-testid="section-textarea-sec-2"]')
  assert.ok(verse1TextareaBefore, 'Section textarea should exist when expanded')
  assert.ok(verse1TextareaBefore.value.includes('Here in Your presence'))

  // Click fold button to collapse Verse 1
  await act(async () => {
    foldBtnVerse1.click()
  })

  // Fold button state updated
  assert.equal(foldBtnVerse1.getAttribute('aria-expanded'), 'false')

  // Textarea should now be hidden/collapsed
  const verse1TextareaAfter = document.querySelector('[data-testid="section-textarea-sec-2"]')
  assert.equal(verse1TextareaAfter, null, 'Section textarea should be removed when collapsed')

  // Collapsed placeholder must be visible with folded indicator
  const placeholder = document.querySelector('[data-testid="collapsed-placeholder-sec-2"]')
  assert.ok(placeholder, 'Collapsed placeholder must be displayed')
  assert.match(placeholder.textContent, /Verse 1.*folded/)

  // Section heading must remain visible
  const verse1Section = document.querySelector('[data-testid="chordpro-section-sec-2"]')
  assert.match(verse1Section.textContent, /\[Verse 1\]/)

  // Source integrity: onUpdateSong was NOT called simply by folding
  assert.equal(updatedSong, null, 'Folding must not mutate source or trigger onUpdateSong')

  // Click collapsed placeholder to expand again
  await act(async () => {
    placeholder.click()
  })

  // Expanded again
  assert.equal(foldBtnVerse1.getAttribute('aria-expanded'), 'true')
  const verse1TextareaRestored = document.querySelector('[data-testid="section-textarea-sec-2"]')
  assert.ok(verse1TextareaRestored, 'Textarea restored after expanding')
  assert.ok(verse1TextareaRestored.value.includes('Here in Your presence'))
})

test('UX_SECTION_ACTIONS: Copies whole section including when collapsed', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const copyBtnVerse1 = document.querySelector('[data-testid="copy-section-sec-2"]')
  assert.ok(copyBtnVerse1)

  // Copy when expanded
  await act(async () => {
    copyBtnVerse1.click()
  })
  assert.ok(clipboardText.includes('[Verse 1]'))
  assert.ok(clipboardText.includes('Here in Your presence'))
  assert.ok(clipboardText.includes('Lord I am healed'))

  // Collapse section
  const foldBtnVerse1 = document.querySelector('[data-testid="fold-btn-sec-2"]')
  await act(async () => {
    foldBtnVerse1.click()
  })

  // Clear clipboard
  clipboardText = ''

  // Copy when collapsed
  await act(async () => {
    copyBtnVerse1.click()
  })
  assert.ok(clipboardText.includes('[Verse 1]'), 'Copy when collapsed must include heading')
  assert.ok(clipboardText.includes('Here in Your presence'), 'Copy when collapsed must include hidden lyrics')
  assert.ok(clipboardText.includes('Lord I am healed'), 'Copy when collapsed must include hidden chords')
})

test('UX_SECTION_ACTIONS: Select whole section selects exact character range', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const selectBtnIntro = document.querySelector('[data-testid="select-section-sec-1"]')
  assert.ok(selectBtnIntro)

  await act(async () => {
    selectBtnIntro.click()
  })

  // Check section gets visual highlight
  const introSection = document.querySelector('[data-testid="chordpro-section-sec-1"]')
  assert.ok(introSection.className.includes('ring-app-action'), 'Selected section should have ring highlight')

  // Native editing commands must target the visible selected section.
  const primaryTextarea = document.querySelector('[data-testid="section-textarea-sec-1"]')
  assert.ok(document.activeElement === primaryTextarea, 'Visible section must own focus')
  assert.equal(primaryTextarea.selectionStart, 0)
  assert.equal(primaryTextarea.selectionEnd, primaryTextarea.value.length)
  const selectedText = primaryTextarea.value.substring(
    primaryTextarea.selectionStart,
    primaryTextarea.selectionEnd
  )
  assert.ok(selectedText.includes('[Intro]'))
  assert.ok(selectedText.includes('[G]  [C]  [G]  [D]'))
})

test('REPEATED_SECTIONS: Repeated section headers operate independently', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  // sec-3 is Chorus 1, sec-5 is Chorus 2
  const foldChorus1 = document.querySelector('[data-testid="fold-btn-sec-3"]')
  const foldChorus2 = document.querySelector('[data-testid="fold-btn-sec-5"]')
  assert.ok(foldChorus1, 'Fold button for Chorus 1 must exist')
  assert.ok(foldChorus2, 'Fold button for Chorus 2 must exist')

  // Collapse Chorus 1
  await act(async () => {
    foldChorus1.click()
  })

  // Chorus 1 is collapsed, Chorus 2 remains expanded
  assert.equal(foldChorus1.getAttribute('aria-expanded'), 'false')
  assert.equal(foldChorus2.getAttribute('aria-expanded'), 'true')
  assert.ok(document.querySelector('[data-testid="collapsed-placeholder-sec-3"]'))
  assert.equal(document.querySelector('[data-testid="collapsed-placeholder-sec-5"]'), null)
})

test('FOLD_ALL_AND_UNFOLD_ALL: Toggles all sections simultaneously', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const foldAllBtn = document.querySelector('[data-testid="fold-all-sections-button"]')
  const unfoldAllBtn = document.querySelector('[data-testid="unfold-all-sections-button"]')
  assert.ok(foldAllBtn)
  assert.ok(unfoldAllBtn)

  // Click Fold All
  await act(async () => {
    foldAllBtn.click()
  })

  // All musical sections should have collapsed placeholders
  assert.ok(document.querySelector('[data-testid="collapsed-placeholder-sec-1"]'))
  assert.ok(document.querySelector('[data-testid="collapsed-placeholder-sec-2"]'))
  assert.ok(document.querySelector('[data-testid="collapsed-placeholder-sec-3"]'))
  assert.ok(document.querySelector('[data-testid="collapsed-placeholder-sec-4"]'))
  assert.ok(document.querySelector('[data-testid="collapsed-placeholder-sec-5"]'))
  assert.ok(document.querySelector('[data-testid="collapsed-placeholder-sec-6"]'))

  // Click Unfold All
  await act(async () => {
    unfoldAllBtn.click()
  })

  // Placeholders gone
  assert.equal(document.querySelector('[data-testid="collapsed-placeholder-sec-1"]'), null)
  assert.equal(document.querySelector('[data-testid="collapsed-placeholder-sec-2"]'), null)
})

test('MODE_TOGGLE: Switches between Sections view and Raw text view', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const modeToggle = document.querySelector('[data-testid="editor-mode-toggle"]')
  assert.ok(modeToggle, 'Mode toggle button must exist in toolbar')
  assert.match(modeToggle.textContent, /Sections/)

  // Switch to Raw view
  await act(async () => {
    modeToggle.click()
  })

  // Now in Raw view
  assert.match(modeToggle.textContent, /Raw/)
  assert.equal(document.querySelector('[data-testid="chordpro-code-editor"]'), null)

  const rawTextarea = document.querySelector('textarea')
  assert.ok(rawTextarea.className.includes('overflow-y-auto'))
  assert.ok(!rawTextarea.className.includes('sr-only'))

  // Switch back to Sections view
  await act(async () => {
    modeToggle.click()
  })
  assert.ok(document.querySelector('[data-testid="chordpro-code-editor"]'))
})

// Helper to trigger React-tracked value change on inputs and textareas
const change = async (el, value, caret = value.length) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    ).set.call(el, value)
    el.setSelectionRange(caret, caret)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

test('F1: Stage preview distinguishes CHART_KEY from PERFORMANCE_KEY', async () => {
  const SONG_WITH_ORIGINAL = {
    ...SAMPLE_SONG,
    key: 'G',
    originalKey: 'G',
    rawContent: `{title: Worship Song}\n{artist: Praise Band}\n{key: G}\n{original_key: G}\n\n[G]Praise [C]the Lord`,
  }

  // Test untransposed (offset 0)
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SONG_WITH_ORIGINAL,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  // Visible preview text contains Original Key: G and Chart Key: G
  const previewText = document.body.textContent
  assert.match(previewText, /Original Key:\s*G/)
  assert.match(previewText, /Chart Key:\s*G/)
  // Performance Key should only be in sr-only element
  const srOnly = document.querySelector('span.sr-only')
  assert.ok(srOnly, 'Screen-reader element for key semantics must exist')
  assert.match(srOnly.textContent, /Performance Key:\s*G/)

  // Test transposed (+2 semitones to A)
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SONG_WITH_ORIGINAL,
        transposeOffset: 2,
        onUpdateSong: () => true,
      })
    )
  })

  const transposedText = document.body.textContent
  assert.match(transposedText, /Original Key:\s*G/)
  assert.match(transposedText, /Chart Key:\s*G/)
  assert.doesNotMatch(transposedText, /Chart Key:\s*A/)
  assert.match(transposedText, /Performance Key:\s*A\s*\(\+2\)/)
  assert.match(document.querySelector('span.sr-only').textContent, /Performance Key:\s*A/)
  assert.equal(document.querySelector('[data-testid="editor-raw-textarea"]').value, SONG_WITH_ORIGINAL.rawContent)
})

test('FIX_2:RESIZABLE_EDITOR_PREVIEW: Resizable divider supports keyboard and reset', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const divider = document.querySelector('[data-testid="editor-preview-divider"]')
  assert.ok(divider, 'Desktop resizable divider must exist')
  assert.equal(divider.getAttribute('role'), 'separator')
  assert.equal(divider.getAttribute('aria-valuenow'), '50')

  // Keyboard navigation on divider: ArrowLeft shrinks editor ratio
  await act(async () => {
    divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  })
  assert.equal(divider.getAttribute('aria-valuenow'), '45')

  // ArrowRight expands editor ratio
  await act(async () => {
    divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  assert.equal(divider.getAttribute('aria-valuenow'), '50')

  // Reset via Space or Enter
  await act(async () => {
    divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  })
  assert.equal(divider.getAttribute('aria-valuenow'), '45')

  await act(async () => {
    divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  assert.equal(divider.getAttribute('aria-valuenow'), '50')

  // Mobile divider reset button
  const mobileDivider = document.querySelector('[data-testid="editor-preview-divider-mobile"]')
  assert.ok(mobileDivider, 'Mobile divider must exist')
  const resetBtn = mobileDivider.querySelector('button')
  assert.ok(resetBtn, '50/50 reset button on mobile divider must exist')
})

test('F4: Breakpoint switch leaves no stale inline width/height on editor and preview panes', async () => {
  window.innerWidth = 1024
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const leftPane = document.querySelector('[data-testid="editor-pane-left"]')
  const rightPane = document.querySelector('[data-testid="editor-pane-right"]')
  assert.ok(leftPane, 'Editor left pane must exist')
  assert.ok(rightPane, 'Preview right pane must exist')

  // Verify responsive CSS variables are used without inline width/height
  assert.equal(leftPane.style.width, '', 'left pane has no inline width')
  assert.equal(leftPane.style.height, '', 'left pane has no inline height')
  assert.equal(rightPane.style.width, '', 'right pane has no inline width')
  assert.equal(rightPane.style.height, '', 'right pane has no inline height')

  const container = leftPane.parentElement
  assert.ok(container.style.getPropertyValue('--editor-split-ratio'), 'Container must have --editor-split-ratio CSS variable')
  assert.ok(container.style.getPropertyValue('--preview-split-ratio'), 'Container must have --preview-split-ratio CSS variable')

  // Classes must be responsive
  assert.ok(leftPane.className.includes('h-[var(--editor-split-ratio)]'))
  assert.ok(leftPane.className.includes('md:w-[var(--editor-split-ratio)]'))
  assert.ok(rightPane.className.includes('h-[var(--preview-split-ratio)]'))
  assert.ok(rightPane.className.includes('md:w-[var(--preview-split-ratio)]'))

  // Simulate crossing breakpoint to mobile
  window.innerWidth = 500
  // Dimensions remain governed by CSS and free of stale inline values
  assert.equal(leftPane.style.width, '', 'left pane still has no stale inline width on mobile')
  assert.equal(leftPane.style.height, '', 'left pane still has no stale inline height on mobile')
  assert.equal(rightPane.style.width, '', 'right pane still has no stale inline width on mobile')
  assert.equal(rightPane.style.height, '', 'right pane still has no stale inline height on mobile')
})

test('F5: Mobile divider has touch-action none, 44px hit area, and pointer drag with capture/cancel', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const mobileDivider = document.querySelector('[data-testid="editor-preview-divider-mobile"]')
  const desktopDivider = document.querySelector('[data-testid="editor-preview-divider"]')
  assert.ok(mobileDivider, 'Mobile divider must exist')
  assert.ok(desktopDivider, 'Desktop divider must exist')

  // touch-action none
  assert.equal(mobileDivider.style.touchAction, 'none', 'Mobile divider has touch-action: none inline')
  assert.ok(mobileDivider.className.includes('touch-none'), 'Mobile divider has touch-none class')
  assert.equal(desktopDivider.style.touchAction, 'none', 'Desktop divider has touch-action: none inline')
  assert.ok(desktopDivider.className.includes('touch-none'), 'Desktop divider has touch-none class')

  // Hit area >= 44px
  assert.ok(mobileDivider.className.includes('min-h-[44px]'), 'Mobile divider has min-h-[44px]')
  assert.ok(mobileDivider.className.includes('h-11'), 'Mobile divider has h-11')

  // Visible grip handle
  const grip = mobileDivider.querySelector('.rounded-full')
  assert.ok(grip, 'Mobile divider has visible grip pill')

  // Pointer drag on mobile divider
  const container = mobileDivider.parentElement
  container.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width: 400,
    height: 1000,
    right: 400,
    bottom: 1000,
  })

  let capturedId = null
  let releasedId = null
  mobileDivider.setPointerCapture = (id) => { capturedId = id }
  mobileDivider.hasPointerCapture = (id) => capturedId === id
  mobileDivider.releasePointerCapture = (id) => { releasedId = id; capturedId = null }

  // Start pointerdown
  await act(async () => {
    mobileDivider.dispatchEvent(
      new window.PointerEvent('pointerdown', {
        button: 0,
        pointerId: 77,
        bubbles: true,
      })
    )
  })
  assert.equal(capturedId, 77, 'pointer capture was set on pointerdown')

  // Drag to 600px (60% of 1000px height)
  await act(async () => {
    mobileDivider.dispatchEvent(
      new window.PointerEvent('pointermove', {
        pointerId: 77,
        clientY: 600,
        bubbles: true,
      })
    )
  })
  assert.equal(mobileDivider.getAttribute('aria-valuenow'), '60', 'splitRatio updated to 60% on vertical drag')

  // Cancel pointer
  await act(async () => {
    mobileDivider.dispatchEvent(
      new window.PointerEvent('pointercancel', {
        pointerId: 77,
        bubbles: true,
      })
    )
  })
  assert.equal(releasedId, 77, 'pointer capture was released on pointercancel')

  // Drag and release via pointerup
  await act(async () => {
    mobileDivider.dispatchEvent(
      new window.PointerEvent('pointerdown', {
        button: 0,
        pointerId: 88,
        bubbles: true,
      })
    )
  })
  assert.equal(capturedId, 88)

  await act(async () => {
    mobileDivider.dispatchEvent(
      new window.PointerEvent('pointermove', {
        pointerId: 88,
        clientY: 700,
        bubbles: true,
      })
    )
  })
  assert.equal(mobileDivider.getAttribute('aria-valuenow'), '70')

  await act(async () => {
    mobileDivider.dispatchEvent(
      new window.PointerEvent('pointerup', {
        pointerId: 88,
        clientY: 700,
        bubbles: true,
      })
    )
  })
  assert.equal(releasedId, 88, 'pointer capture was released on pointerup')
  assert.equal(mobileDivider.getAttribute('aria-valuenow'), '70')
})

test('FIX_3:METADATA_MODAL_CLEANUP: Metadata dialog opens with clean styling and key alignment', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const metadataBtn = document.querySelector('[aria-label="Song Details & Metadata"]')
  assert.ok(metadataBtn, 'Metadata button must exist in toolbar')

  await act(async () => {
    metadataBtn.click()
  })

  const modal = document.querySelector('[role="dialog"]')
  assert.ok(modal, 'Metadata dialog must open')
  assert.match(modal.textContent, /Song Details & Metadata/)
  assert.match(modal.textContent, /Original Key/)
})

test('FIX_4:UNDO_REDO_TOOLBAR: Undo and Redo toolbar buttons track edit history across modes', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const undoBtn = document.querySelector('[data-testid="editor-undo-button"]')
  const redoBtn = document.querySelector('[data-testid="editor-redo-button"]')
  assert.ok(undoBtn, 'Undo button must exist in toolbar')
  assert.ok(redoBtn, 'Redo button must exist in toolbar')

  // Initially disabled when history is empty
  assert.equal(undoBtn.disabled, true)
  assert.equal(redoBtn.disabled, true)

  // Switch to Raw mode and edit text
  const modeToggle = document.querySelector('[data-testid="editor-mode-toggle"]')
  await act(async () => {
    modeToggle.click()
  })

  const rawTextarea = document.querySelector('textarea')
  const originalText = rawTextarea.value
  const newText = originalText + '\n[G]Added line'

  // Edit raw text
  await change(rawTextarea, newText)

  // Undo button should now be enabled
  assert.equal(undoBtn.disabled, false)
  assert.equal(redoBtn.disabled, true)

  // Click Undo
  await act(async () => {
    undoBtn.click()
  })

  // Redo button should now be enabled
  assert.equal(redoBtn.disabled, false)

  // Click Redo
  await act(async () => {
    redoBtn.click()
  })

  assert.equal(undoBtn.disabled, false)
})

test('FIX_5:INTERACTIVE_BUTTON_HELP: Toolbar buttons provide accessible popover help without title attributes', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const clearBtn = document.querySelector('[aria-label="Clear"]')
  assert.ok(clearBtn, 'Clear toolbar button must exist')
  assert.equal(clearBtn.getAttribute('title'), null, 'Rule #224: Buttons must not use native title tooltips')

  // Focus clear button to trigger accessible popover
  await act(async () => {
    clearBtn.focus()
  })

  const tooltip = document.querySelector('[data-testid="editor-toolbar-tooltip"]')
  assert.ok(tooltip, 'Popover tooltip must appear on focus')
  assert.match(tooltip.textContent, /Clear all chords and lyrics after confirmation/)
})

test('FOCUS_AND_CURSOR_INTEGRITY: Continuous typing in Verse 1 preserves focus and never migrates to Header/Directives', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  // Ensure Sections mode is active
  const verse1Textarea = document.querySelector('[data-testid="section-textarea-sec-2"]')
  assert.ok(verse1Textarea, 'Verse 1 textarea must exist')

  // Focus Verse 1 textarea
  verse1Textarea.focus()
  assert.equal(document.activeElement, verse1Textarea, 'Focus must start on Verse 1 textarea')

  // Simulate continuous typing with words and spaces
  const initialVerse1 = verse1Textarea.value
  const typedPhrases = [
    ' and I am renewed',
    ' in Your awesome love',
    ' every single day',
  ]

  let currentText = initialVerse1
  for (const phrase of typedPhrases) {
    currentText = currentText + phrase
    await change(verse1Textarea, currentText)

    // Focus must NOT jump to the primary sr-only textarea or Header/Directives
    assert.equal(document.activeElement, verse1Textarea, 'Focus must remain on Verse 1 textarea during continuous typing')

    // Header directives must remain completely uncorrupted
    const headerTextarea = document.querySelector('[data-testid="section-textarea-sec-0"]')
    assert.ok(headerTextarea, 'Header section textarea must exist')
    assert.match(headerTextarea.value, /^{title:\s*Worship Song}/, 'Header must start with title directive, not typed characters')
    assert.doesNotMatch(headerTextarea.value, /renewed|awesome|single/, 'Typed text must not migrate to Header')

    // Primary raw textarea must also reflect the exact same content without leading corruption
    const rawTextarea = document.querySelector('textarea[data-testid="editor-raw-textarea"]')
    assert.ok(rawTextarea.value.startsWith('{title: Worship Song}'), 'Primary raw content must start with title directive')
  }

  // Final check: Verse 1 contains all typed words in place without duplication
  assert.ok(verse1Textarea.value.includes('and I am renewed in Your awesome love every single day'))
})

test('INDEPENDENT_MULTI_SECTION_EDITING: Editing multiple sections maintains isolation and boundaries', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const introTextarea = document.querySelector('[data-testid="section-textarea-sec-1"]')
  const verse1Textarea = document.querySelector('[data-testid="section-textarea-sec-2"]')
  const chorus1Textarea = document.querySelector('[data-testid="section-textarea-sec-3"]')
  assert.ok(introTextarea)
  assert.ok(verse1Textarea)
  assert.ok(chorus1Textarea)

  // Edit Intro
  await change(introTextarea, introTextarea.value + '\n[Intro riff]')
  assert.ok(introTextarea.value.includes('[Intro riff]'))
  assert.ok(!verse1Textarea.value.includes('[Intro riff]'))

  // Edit Chorus
  await change(chorus1Textarea, chorus1Textarea.value + '\n[G]Amen')
  assert.ok(chorus1Textarea.value.includes('[G]Amen'))
  assert.ok(!introTextarea.value.includes('[G]Amen'))
  assert.ok(!verse1Textarea.value.includes('[G]Amen'))

  // Verify Header directives still untouched
  const headerTextarea = document.querySelector('[data-testid="section-textarea-sec-0"]')
  assert.ok(headerTextarea.value.startsWith('{title: Worship Song}'))
})

test('UNDO_REDO_AND_MODE_SWITCH: Preserves section edits across history and mode switches', async () => {
  await act(async () => {
    root.render(
      React.createElement(DesktopEditor, {
        song: SAMPLE_SONG,
        transposeOffset: 0,
        onUpdateSong: () => true,
      })
    )
  })

  const verse1Textarea = document.querySelector('[data-testid="section-textarea-sec-2"]')
  const originalVerse1 = verse1Textarea.value

  // Type an edit in Verse 1
  await change(verse1Textarea, originalVerse1 + '\n[C]New line added')

  const undoBtn = document.querySelector('[data-testid="editor-undo-button"]')
  const redoBtn = document.querySelector('[data-testid="editor-redo-button"]')
  assert.equal(undoBtn.disabled, false)

  // Undo in Sections mode
  await act(async () => {
    undoBtn.click()
  })

  const restoredVerse1 = document.querySelector('[data-testid="section-textarea-sec-2"]')
  assert.equal(restoredVerse1.value, originalVerse1)

  // Redo in Sections mode
  await act(async () => {
    redoBtn.click()
  })

  const redoneVerse1 = document.querySelector('[data-testid="section-textarea-sec-2"]')
  assert.ok(redoneVerse1.value.includes('New line added'))

  // Switch to Raw mode
  const modeToggle = document.querySelector('[data-testid="editor-mode-toggle"]')
  await act(async () => {
    modeToggle.click()
  })

  const rawTextarea = document.querySelector('textarea[data-testid="editor-raw-textarea"]')
  assert.ok(rawTextarea.value.includes('New line added'))

  // Switch back to Sections mode
  await act(async () => {
    modeToggle.click()
  })

  const sectionTextareaAgain = document.querySelector('[data-testid="section-textarea-sec-2"]')
  assert.ok(sectionTextareaAgain.value.includes('New line added'))
})


test('F2: recognized heading remaps caret into the reconstructed section', async () => {
  await act(async () => root.render(React.createElement(DesktopEditor, {
    song: SAMPLE_SONG, transposeOffset: 0, onUpdateSong: () => true,
  })))
  const textarea = document.querySelector('[data-testid="section-textarea-sec-2"]')
  textarea.focus()
  const original = textarea.value
  const edited = original + 'Chorus\n'
  await change(textarea, edited, edited.length - 1)
  const active = document.activeElement
  assert.equal(active.getAttribute('data-testid'), 'section-textarea-sec-3')
  assert.equal(active.value, 'Chorus\n')
  assert.equal(active.selectionStart, 'Chorus'.length)
  assert.equal(active.selectionEnd, 'Chorus'.length)
  await change(active, active.value + '[G]New chorus lyric\n')
  assert.equal(document.querySelector('[data-testid="editor-raw-textarea"]').value,
    SAMPLE_SONG.rawContent.replace(original, edited + '[G]New chorus lyric\n'))
})

test('F3: Select expands a folded section and focuses its full editable range', async () => {
  await act(async () => root.render(React.createElement(DesktopEditor, {
    song: SAMPLE_SONG, transposeOffset: 0, onUpdateSong: () => true,
  })))
  const original = document.querySelector('[data-testid="section-textarea-sec-2"]').value
  await act(async () => document.querySelector('[data-testid="fold-btn-sec-2"]').click())
  await act(async () => document.querySelector('[data-testid="select-section-sec-2"]').click())
  const active = document.activeElement
  assert.equal(active.getAttribute('data-testid'), 'section-textarea-sec-2')
  assert.equal(active.selectionStart, 0)
  assert.equal(active.selectionEnd, original.length)
  assert.equal(document.querySelector('[data-testid="editor-raw-textarea"]').value, SAMPLE_SONG.rawContent)
  // Model typing over the native selection; surrounding sections/directives stay exact.
  await change(active, '[Verse 1]\nReplacement\n\n')
  assert.equal(document.querySelector('[data-testid="editor-raw-textarea"]').value,
    SAMPLE_SONG.rawContent.replace(original, '[Verse 1]\nReplacement\n\n'))
})
