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

  // Check primary textarea has selection set
  const primaryTextarea = document.querySelector('textarea')
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
const change = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    ).set.call(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

test('FIX_1:KEY_DISPLAY_AND_SEMANTICS: Stage preview displays Original Key and Chart Key only without visible Performance Key', async () => {
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
  assert.match(transposedText, /Chart Key:\s*A\s*\(\+2\)/)
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
