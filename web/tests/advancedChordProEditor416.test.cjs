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
