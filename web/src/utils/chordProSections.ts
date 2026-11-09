import { isSectionHeader } from './songParser'

export interface ChordProSection {
  id: string
  index: number
  type: 'prelude' | 'section'
  heading: string
  cleanLabel: string
  startLine: number
  endLine: number
  startChar: number
  endChar: number
  headingLineCount: number
  bodyLines: string[]
  fullLines: string[]
  bodyText: string
  fullText: string
}

export interface ParsedSectionsResult {
  sections: ChordProSection[]
  hasSections: boolean
  totalLineCount: number
}

// Directives that start a section block
const DIRECTIVE_BLOCK_STARTS: Record<string, string> = {
  soc: 'Chorus',
  start_of_chorus: 'Chorus',
  sob: 'Bridge',
  start_of_bridge: 'Bridge',
  sov: 'Verse',
  start_of_verse: 'Verse',
  sot: 'Tab',
  start_of_tab: 'Tab',
}

// Directives that end a section block
const DIRECTIVE_BLOCK_ENDS = new Set([
  'eoc',
  'end_of_chorus',
  'eob',
  'end_of_bridge',
  'eov',
  'end_of_verse',
  'eot',
  'end_of_tab',
])

export interface SectionHeaderDetection {
  isHeader: boolean
  label: string
  rawHeading: string
  isDirectiveStart?: boolean
  isDirectiveEnd?: boolean
}

/**
 * Detects whether a line represents a ChordPro section header or block boundary.
 */
export function detectSectionHeader(line: string): SectionHeaderDetection {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 80) {
    return { isHeader: false, label: '', rawHeading: '' }
  }

  // 1. Directives: {soc}, {start_of_chorus}, {c: Verse 1}, etc.
  const directiveMatch = /^\{([a-zA-Z_-]+)(?::\s*([^}]+))?\}$/.exec(trimmed)
  if (directiveMatch) {
    const tag = directiveMatch[1].toLowerCase()
    const value = (directiveMatch[2] || '').trim()

    if (DIRECTIVE_BLOCK_STARTS[tag]) {
      return {
        isHeader: true,
        label: value || DIRECTIVE_BLOCK_STARTS[tag],
        rawHeading: trimmed,
        isDirectiveStart: true,
      }
    }

    if (DIRECTIVE_BLOCK_ENDS.has(tag)) {
      return {
        isHeader: false,
        label: '',
        rawHeading: trimmed,
        isDirectiveEnd: true,
      }
    }

    if (tag === 'c' || tag === 'comment') {
      if (value) {
        return {
          isHeader: true,
          label: value,
          rawHeading: trimmed,
        }
      }
    }

    return { isHeader: false, label: '', rawHeading: '' }
  }

  // 2. Combined section header + chords e.g. "[Intro] G - D/F# - Em7" or "Intro: [A] [F#m]"
  const combinedMatch =
    /^(?:(\[[^\]]+\]:?)|((?:Intro|Verse|Chorus|Bridge|Pre-Chorus|Post-Chorus|Outro|Solo|Interlude|Hook|Ending|Riff|Instrumental|Refrain|Transposed|Repeat|Adlib|Breakdown|Coda|Tag)(?:\s+[0-9A-Za-z\-_/]+)?:?))\s+(.+)$/i.exec(
      trimmed
    )
  if (combinedMatch) {
    const headerRaw = (combinedMatch[1] || combinedMatch[2]).trim()
    const clean = headerRaw.replace(/[[\]<>():]/g, '').trim()
    if (clean && isSectionHeader(`[${clean}]`)) {
      return {
        isHeader: true,
        label: clean,
        rawHeading: trimmed,
      }
    }
  }

  // 3. Bracketed or unbracketed standalone section header e.g. "[Verse 1]", "[Chorus]", "Chorus:"
  if (isSectionHeader(trimmed)) {
    const clean = trimmed.replace(/[[\]<>():]/g, '').trim()
    return {
      isHeader: true,
      label: clean || 'Section',
      rawHeading: trimmed,
    }
  }

  return { isHeader: false, label: '', rawHeading: '' }
}

/**
 * Parses raw ChordPro text into discrete musical sections, preserving exact original source text.
 */
export function parseChordProSections(rawText: string): ParsedSectionsResult {
  if (!rawText) {
    const emptySection: ChordProSection = {
      id: 'sec-0',
      index: 0,
      type: 'prelude',
      heading: '',
      cleanLabel: 'Song Content',
      startLine: 0,
      endLine: 0,
      startChar: 0,
      endChar: 0,
      headingLineCount: 0,
      bodyLines: [],
      fullLines: [],
      bodyText: '',
      fullText: '',
    }
    return { sections: [emptySection], hasSections: false, totalLineCount: 0 }
  }

  const lines = rawText.split('\n')
  const totalLineCount = lines.length

  // Calculate start character indices for each line
  const lineStartChars: number[] = []
  let cumulativeChar = 0
  for (let i = 0; i < lines.length; i++) {
    lineStartChars.push(cumulativeChar)
    cumulativeChar += lines[i].length + 1 // +1 for '\n'
  }

  interface SectionBoundary {
    startLine: number
    heading: string
    cleanLabel: string
    type: 'prelude' | 'section'
    headingLineCount: number
  }

  const boundaries: SectionBoundary[] = []

  let foundFirstSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const detection = detectSectionHeader(line)

    if (detection.isHeader) {
      if (!foundFirstSection && i > 0) {
        // Everything before the first section header is prelude
        boundaries.push({
          startLine: 0,
          heading: '',
          cleanLabel: 'Header / Directives',
          type: 'prelude',
          headingLineCount: 0,
        })
      }
      foundFirstSection = true
      boundaries.push({
        startLine: i,
        heading: line,
        cleanLabel: detection.label,
        type: 'section',
        headingLineCount: 1,
      })
    }
  }

  // If no sections were found, the entire document is treated as a single section
  if (boundaries.length === 0) {
    const fullText = rawText
    const singleSection: ChordProSection = {
      id: 'sec-0',
      index: 0,
      type: 'prelude',
      heading: '',
      cleanLabel: 'Song Content',
      startLine: 0,
      endLine: lines.length - 1,
      startChar: 0,
      endChar: rawText.length,
      headingLineCount: 0,
      bodyLines: [...lines],
      fullLines: [...lines],
      bodyText: rawText,
      fullText,
    }
    return { sections: [singleSection], hasSections: false, totalLineCount }
  }

  const sections: ChordProSection[] = []

  for (let b = 0; b < boundaries.length; b++) {
    const current = boundaries[b]
    const nextStartLine = b + 1 < boundaries.length ? boundaries[b + 1].startLine : lines.length
    const endLine = nextStartLine - 1

    const sectionLines = lines.slice(current.startLine, nextStartLine)
    const startChar = lineStartChars[current.startLine]
    const endChar = nextStartLine < lines.length ? lineStartChars[nextStartLine] : rawText.length
    const fullText = rawText.slice(startChar, endChar)

    const bodyLines = current.headingLineCount > 0 ? sectionLines.slice(current.headingLineCount) : sectionLines
    const bodyText = bodyLines.join('\n')

    sections.push({
      id: `sec-${b}`,
      index: b,
      type: current.type,
      heading: current.heading,
      cleanLabel: current.cleanLabel,
      startLine: current.startLine,
      endLine,
      startChar,
      endChar,
      headingLineCount: current.headingLineCount,
      bodyLines,
      fullLines: sectionLines,
      bodyText,
      fullText,
    })
  }

  return {
    sections,
    hasSections: sections.some((s) => s.type === 'section'),
    totalLineCount,
  }
}
