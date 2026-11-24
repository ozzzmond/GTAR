import { parseChordProSections, type ChordProSection } from './chordProSections'
import { parseGtarSong } from './songParser'

export function findPreviewSection(rawContent: string, previewIndex: number): ChordProSection | undefined {
  const sections = parseChordProSections(rawContent).sections.filter((part) => part.type === 'section')
  const headerCount = (end: number) => parseGtarSong(rawContent.slice(0, end)).lines
    .filter((line) => line.type === 'SECTION_HEADER').length

  // Some source sections are hidden in Stage Preview, and adjacent headings can be merged.
  // Locate the first source section whose heading brings the preview to this ordinal.
  let start = 0
  let end = sections.length
  while (start < end) {
    const middle = Math.floor((start + end) / 2)
    const section = sections[middle]
    if (headerCount(section.startChar + section.heading.length) > previewIndex) end = middle
    else start = middle + 1
  }
  const section = sections[start]
  if (section && headerCount(section.startChar) === previewIndex &&
    headerCount(section.startChar + section.heading.length) === previewIndex + 1) return section
}

export function scrollEditorPane(pane: HTMLElement, top: number) {
  pane.scrollTo({
    top,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  })
}

export function scrollRawEditor(textarea: HTMLTextAreaElement, rawContent: string, section: ChordProSection) {
  const style = window.getComputedStyle(textarea)
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  if (section.startLine === 0) {
    scrollEditorPane(textarea, paddingTop)
    return
  }

  // Measure wrapped lines at the textarea's actual text width, without editing its value or selection.
  const mirror = textarea.ownerDocument.createElement('div')
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    boxSizing: 'content-box',
    font: style.font,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    tabSize: style.tabSize,
    whiteSpace: style.whiteSpace,
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    width: `${textarea.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0)}px`,
  })
  // Textarea values normalize source line endings before layout.
  mirror.textContent = rawContent.slice(0, section.startChar).replace(/\r\n?/g, '\n') + '\u200b'
  textarea.ownerDocument.body.append(mirror)
  const top = mirror.getBoundingClientRect().height - Number.parseFloat(style.lineHeight) + paddingTop
  mirror.remove()
  scrollEditorPane(textarea, top)
}
