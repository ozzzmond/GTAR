import type {
  ChordSegment,
  SongFormat,
  SongLine,
  ParsedGtarSong
} from '../types/gtar'
import { CHORD_TOKEN_REGEX, transposeChordToken, transposeChordLine } from './chordTransposer'

// Common section header keywords matching Android SongParser.kt
const SECTION_KEYWORDS = [
  'intro',
  'verse',
  'chorus',
  'bridge',
  'pre-chorus',
  'post-chorus',
  'outro',
  'solo',
  'interlude',
  'hook',
  'ending',
  'riff',
  'instrumental',
  'refrain',
  'transposed',
  'repeat',
  'adlib',
  'breakdown',
  'coda',
  'tag'
]

export { CHORD_TOKEN_REGEX } from './chordTransposer'

// Tab lines regex (e.g. e|---0-2-3---|)
export const TAB_LINE_REGEX = /^[eEaAdDgGbB]\|[0-9-xpbrh~/\\|\s]+$/

// Fixed-pitch diagrams must bypass chord detection and transposition.
export function isTabChartLine(line: string): boolean {
  const trimmed = line.trim()
  if (TAB_LINE_REGEX.test(trimmed)) return true
  if (/-(?:[0-9]+|x)-/i.test(line)) return true
  if (/^\s*(?:chords?|chord\s+(?:chart|diagrams?|definitions?))\s*:/i.test(line)) return true
  // Space-separated fret grid values like "3 2 0 0 0 3" or "x 0 2 2 1 0"
  if (/^[0-9xX](?:\s+[0-9xX]){3,}$/.test(trimmed)) return true
  return false
}

// Check if token is a musical separator/delimiter
function isDelimiterToken(token: string): boolean {
  const t = token.trim().toLowerCase()
  if (t === '-' || t === '–' || t === '—' || t === '|' || t === '/' || t === '\\' || t === '...' || t === ':') {
    return true
  }
  if (/^\(?x[0-9]+\)?$/.test(t) || t === '(hold)' || t === 'hold' || t === 'intro:') {
    return true
  }
  return false
}

// Clean musical wrapper punctuation from a token
function cleanChordWrapper(token: string): string {
  if (token.startsWith('(') && token.endsWith(')')) {
    return token.substring(1, token.length - 1).trim()
  }
  return token.replace(/[[\]<>{},;:]/g, '').trim()
}

// Check if a line is a section header like [Verse 1], Chorus:, Intro:
export function isSectionHeader(line: string): boolean {
  const trimmed = line.trim().replace(/^\((.*)\)$/, '$1')
  if (!trimmed || trimmed.length > 50) return false
  if (TAB_LINE_REGEX.test(trimmed)) return false

  // Bracketed check e.g. [Verse 1], <Chorus>
  const bracketMatch = /^[[<]([^\]>]+)[\]>]$/.exec(trimmed)
  if (bracketMatch) {
    const inside = bracketMatch[1].trim().toLowerCase()
    // A single chord like [G] or [D/F#] is a chord line, NOT a section header
    if (CHORD_TOKEN_REGEX.test(bracketMatch[1].trim())) {
      return false
    }
    // Reject if inside is a chord progression (e.g. [G - D/F# - Em7])
    if (isChordLine(inside)) {
      return false
    }
    return true
  }

  // Check unbracketed keywords e.g. "Verse 1:", "Chorus:", "Intro"
  const bareMatch = /^([A-Za-z-]+)(?:\s+[0-9A-Za-z]+)?:?$/.exec(trimmed)
  if (bareMatch) {
    const word = bareMatch[1].toLowerCase()
    return SECTION_KEYWORDS.includes(word)
  }

  return false
}

/** Split leading section markers from adjacent chords without adding empty rows. */
export function normalizeSectionMarkers(text: string): string {
  return text.split('\n').flatMap(line => {
    const match = /^\s*\[([^\]]+)\][ \t]*:?[ \t]*(.*)$/.exec(line)
    if (!match || !isSectionHeader(`[${match[1]}]`)) return [line]
    let title = match[1].trim()
    const keyword = SECTION_KEYWORDS.find(word => title.toLowerCase() === word || title.toLowerCase().startsWith(word + ' '))
    if (keyword) title = keyword.replace(/(^|-)[a-z]/g, value => value.toUpperCase()) + title.slice(keyword.length)
    return match[2] ? [`[${title}]`, match[2]] : [`[${title}]`]
  }).join('\n')
}

// Common English lyric words that should NEVER trigger chord line detection
const COMMON_PROSE_WORDS = new Set([
  'the', 'thousand', 'thousands', 'hallelujah', 'hallelujahs', 'and', 'with', 'from',
  'that', 'this', 'what', 'when', 'where', 'why', 'how', 'who', 'whom', 'whose',
  'there', 'here', 'your', 'yours', 'their', 'theirs', 'our', 'ours', 'mine',
  'you', 'she', 'they', 'them', 'him', 'his', 'her', 'hers', 'its',
  'will', 'would', 'shall', 'should', 'could', 'can', 'may', 'might', 'must',
  'have', 'has', 'had', 'having', 'been', 'were', 'was', 'are', 'is',
  'into', 'onto', 'upon', 'about', 'above', 'across', 'after', 'against',
  'along', 'among', 'around', 'before', 'behind', 'below', 'beneath', 'beside',
  'between', 'beyond', 'during', 'except', 'inside', 'outside', 'through',
  'toward', 'under', 'until', 'without', 'because', 'cause', 'waiting', 'crying',
  'singing', 'shouting', 'dancing', 'walking', 'running', 'looking', 'falling',
  'standing', 'dreaming', 'sleeping', 'feeling', 'giving', 'taking', 'making',
  'living', 'loving', 'broken', 'saving', 'holding', 'staying', 'praying',
  'never', 'always', 'sometimes', 'forever', 'together', 'tonight', 'today',
  'tomorrow', 'yesterday', 'morning', 'night', 'dark', 'light', 'shine',
  'glory', 'holy', 'praise', 'worship', 'jesus', 'father', 'spirit', 'lord',
  'heart', 'soul', 'mind', 'eyes', 'hands', 'voice', 'words', 'world', 'earth',
  'heaven', 'grace', 'mercy', 'peace', 'truth', 'faith', 'hope', 'love'
])

/**
 * Normalizes angle bracket chords into standard ChordPro brackets:
 * e.g. "<C>", "<F>", "<G>", "<C#m>-<B>" -> "[C]", "[F]", "[G]", "[C#m]-[B]"
 */
export function normalizeAngleBrackets(text: string): string {
  // 1. Compound hyphenated angle bracket chords like <C#m>-<B> or <C#m-B>
  text = text.replace(/\{([^{}]+)\}/g, (match, chord: string) => CHORD_TOKEN_REGEX.test(chord.trim()) ? `[${chord.trim()}]` : match)
  let res = text.replace(/<([A-G][b#]?[^>]*)-([A-G][b#]?[^>]*)>/gi, (match, c1, c2) => {
    if (CHORD_TOKEN_REGEX.test(c1.trim()) && CHORD_TOKEN_REGEX.test(c2.trim())) {
      return `[${c1.trim()}]-[${c2.trim()}]`
    }
    return match
  })

  // 2. Single angle bracket chords <C>, <F>, <G>, etc.
  res = res.replace(/<([A-G][b#]?[^>]*)>/gi, (match, chord) => {
    const trimmed = chord.trim()
    if (CHORD_TOKEN_REGEX.test(trimmed)) {
      return `[${trimmed}]`
    }
    return match
  })

  return res
}

// Check if a line consists predominantly of chords
export function isChordLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (TAB_LINE_REGEX.test(trimmed) || (trimmed.startsWith('|') && trimmed.includes('-|') && !trimmed.includes(' '))) {
    return false
  }

  const rawTokens = trimmed.split(/\s+/).filter(Boolean)
  if (rawTokens.length === 0) return false

  const processedTokens: string[] = []

  for (const token of rawTokens) {
    if (CHORD_TOKEN_REGEX.test(token)) {
      processedTokens.push(token)
      continue
    }

    const stripped = cleanChordWrapper(token)
    if (CHORD_TOKEN_REGEX.test(stripped)) {
      processedTokens.push(stripped)
      continue
    }

    // Split on dashes, en-dashes, em-dashes, or pipes while preserving slash chords
    if (stripped.includes('-') || stripped.includes('|') || stripped.includes('–') || stripped.includes('—')) {
      const parts = stripped.split(/[-|–—]/).map((p) => p.trim()).filter(Boolean)
      if (parts.length > 0) {
        processedTokens.push(...parts)
      } else {
        processedTokens.push(token)
      }
    } else {
      processedTokens.push(token)
    }
  }

  let chordCount = 0
  let lyricCount = 0
  let hasProseWord = false

  for (const t of processedTokens) {
    if (isDelimiterToken(t)) {
      continue
    }
    const clean = cleanChordWrapper(t)
    if (!clean) continue

    const lower = clean.toLowerCase()
    if (COMMON_PROSE_WORDS.has(lower)) {
      hasProseWord = true
      lyricCount++
      continue
    }

    // Special case: "A" or "a" alone is the most common English article.
    // Only treat it as a chord if ALL other tokens on this line are also chords.
    if (clean === 'A' || clean === 'a') {
      const otherTokens = processedTokens
        .map((tok) => cleanChordWrapper(tok))
        .filter((tok) => tok && tok !== 'A' && tok !== 'a' && !isDelimiterToken(tok))

      if (otherTokens.length > 0 && otherTokens.some((tok) => !CHORD_TOKEN_REGEX.test(tok))) {
        // Line has lyrics! "A" is an article, NOT a chord!
        lyricCount++
        continue
      }
    }

    if (CHORD_TOKEN_REGEX.test(clean)) {
      chordCount++
    } else {
      // If it looks like normal prose (letters with length >= 4), flag as lyric
      if (/^[a-zA-Z]{4,}$/.test(clean)) {
        hasProseWord = true
      }
      lyricCount++
    }
  }

  // If the line contains known English prose words, it is a lyric line!
  if (hasProseWord) return false
  if (chordCount === 0) return false
  if (lyricCount === 0) return true

  // Pure chord lines have practically 0 prose lyrics
  return lyricCount <= 1 && chordCount / (chordCount + lyricCount) >= 0.85
}

// Extract distinct chord tokens from a chord line (handling brackets, delimiters, spacing)
export function extractChordTokensFromLine(line: string): string[] {
  const tokens: string[] = []

  // Case A: Bracketed chords like [A] [F#m] [D] [E] [A]
  const bracketRegex = /\[([A-G][b#]?[^\]]*)\]/g
  let match: RegExpExecArray | null
  const bracketMatches: string[] = []

  while ((match = bracketRegex.exec(line)) !== null) {
    const c = match[1].trim()
    if (CHORD_TOKEN_REGEX.test(c)) {
      bracketMatches.push(c)
    }
  }

  if (bracketMatches.length > 0) {
    return bracketMatches
  }

  // Case B: Unbracketed tokens like G - D/F# - Em7 or A F#m D E
  const rawParts = line.split(/\s+/).filter(Boolean)
  for (const part of rawParts) {
    const subParts = part.split(/[-|–—]/).map((p) => cleanChordWrapper(p)).filter(Boolean)
    for (const sub of subParts) {
      if (CHORD_TOKEN_REGEX.test(sub)) {
        tokens.push(sub)
      }
    }
  }

  return tokens
}

// Find bracketed chords
interface BracketedMatch {
  chord: string
  startIndex: number
  endIndex: number
}

function findBracketedChords(line: string): BracketedMatch[] {
  // Support both square brackets [C] and angle brackets <C>
  const regex = /\[([A-G][b#]?[^\]]*)\]|<([A-G][b#]?[^>]*)>/g
  const matches: BracketedMatch[] = []
  let m: RegExpExecArray | null

  while ((m = regex.exec(line)) !== null) {
    const candidate = (m[1] || m[2] || '').trim()
    if (CHORD_TOKEN_REGEX.test(candidate)) {
      matches.push({
        chord: candidate,
        startIndex: m.index,
        endIndex: regex.lastIndex,
      })
    }
  }

  return matches
}

export function parseChordProLine(line: string, transposeOffset = 0): ChordSegment[] {
  const matches = findBracketedChords(normalizeAngleBrackets(line))
  line = normalizeAngleBrackets(line)
  if (!matches.length) return [{ chord: null, text: line }]
  const segments: ChordSegment[] = []
  if (matches[0].startIndex > 0) segments.push({ chord: null, text: line.slice(0, matches[0].startIndex) })
  matches.forEach((match, index) => segments.push({
    chord: transposeChordToken(match.chord, transposeOffset),
    text: line.slice(match.endIndex, matches[index + 1]?.startIndex ?? line.length),
  }))
  return segments
}

// Checks if line has meaningful lyric content outside bracketed chords
function hasInlineLyricContent(line: string, bracketed: BracketedMatch[]): boolean {
  let lyricOnly = ''
  let lastIdx = 0

  for (const b of bracketed) {
    lyricOnly += line.substring(lastIdx, b.startIndex)
    lastIdx = b.endIndex
  }
  lyricOnly += line.substring(lastIdx)

  const cleaned = lyricOnly.replace(/[\s\-|:,/\\~]+/g, '')
  return cleaned.length > 0
}

/**
 * Normalizes a 2-line chord row with brackets (e.g. "<G>              <A7>" or "[A]    [F#m]")
 * by replacing bracketed chords with clean chord names anchored at their exact start column.
 * Preserves horizontal alignment with the lyric line underneath (matching Android SongParser.kt).
 */
export function normalizeChordLineBrackets(line: string, matches: BracketedMatch[]): string {
  if (matches.length === 0) return line

  let result = ''
  let lastIdx = 0

  for (const match of matches) {
    const chord = match.chord
    const start = match.startIndex
    const end = match.endIndex

    const prefix = start > lastIdx ? line.substring(lastIdx, start) : ''
    if (prefix.trim().length > 0) {
      while (result.length < lastIdx) {
        result += ' '
      }
      result += prefix
    }

    while (result.length < start) {
      result += ' '
    }

    result += chord
    lastIdx = end
  }

  if (lastIdx < line.length) {
    const suffix = line.substring(lastIdx)
    if (suffix.trim().length > 0) {
      while (result.length < lastIdx) {
        result += ' '
      }
      result += suffix
    }
  }

  return result
}

/**
 * Converts an inline ChordPro line (e.g. "When the [A]night has come")
 * into a 2-line pair of chords over lyrics with exact character-column alignment.
 * Brackets [] are removed; chords are placed on line 1 directly above lyric syllables.
 */
export function convertChordProToTwoLine(line: string): [string, string] {
  let chordStr = ''
  let lyricStr = ''
  let lastIdx = 0
  const matches = findBracketedChords(line)

  if (matches.length === 0) {
    return ['', line]
  }

  for (const match of matches) {
    const chord = match.chord
    const chordStart = match.startIndex
    const chordEnd = match.endIndex

    if (chordStart > lastIdx) {
      lyricStr += line.substring(lastIdx, chordStart)
    }

    let targetCol = lyricStr.length
    if (chordStr.length > 0 && targetCol < chordStr.length + 1) {
      const paddingNeeded = chordStr.length + 1 - targetCol
      lyricStr += ' '.repeat(paddingNeeded)
      targetCol = lyricStr.length
    }

    while (chordStr.length < targetCol) {
      chordStr += ' '
    }

    chordStr += chord
    lastIdx = chordEnd
  }

  if (lastIdx < line.length) {
    lyricStr += line.substring(lastIdx)
  }

  return [chordStr, lyricStr]
}

/**
 * Parses raw song text into a structured ParsedGtarSong model matching Android v1.0.42.
 */
export function parseGtarSong(rawText: string, transposeOffset: number = 0): ParsedGtarSong {
  // Normalize angle bracket chords e.g. <C>, <F>, <G>, <C#m>-<B> before line-by-line parsing
  const normalizedText = normalizeSectionMarkers(normalizeAngleBrackets(rawText))
  const lines = normalizedText.split('\n')

  let title = 'Untitled Song'
  let artist = ''
  let key = ''
  let originalKey = ''
  let capo = ''
  let bpm = ''
  let time = ''
  let year = ''
  let tags = ''

  const parsedLines: SongLine[] = []
  let chordProCount = 0
  let twoLineCount = 0

  let explicitTab = false
  let chartBlock = false
  for (const sourceLine of lines) {
    if (/^\s*\{(?:sot|start_of_tab)\}\s*$/i.test(sourceLine)) {
      explicitTab = true
      continue
    }
    if (/^\s*\{(?:eot|end_of_tab)\}\s*$/i.test(sourceLine)) {
      explicitTab = false
      chartBlock = false
      continue
    }
    if (!sourceLine.trim() || isSectionHeader(sourceLine)) chartBlock = false
    if (explicitTab || chartBlock || isTabChartLine(sourceLine)) {
      parsedLines.push({ type: 'TAB', content: sourceLine })
      chartBlock = chartBlock || /^\s*(?:chords?|chord\s+(?:chart|diagrams?|definitions?))\s*:/i.test(sourceLine)
      continue
    }
    const rawLine = sourceLine.replace(/\{([^{}]*)\}/g, (match) => sourceLine.trim() === match ? match : '')
    const trimmed = rawLine.trim()

    // 1. Empty lines
    if (!trimmed) {
      parsedLines.push({ type: 'EMPTY' })
      continue
    }

    // 2. ChordPro Directives: {key: value}
    const directiveMatch = /^\{([a-zA-Z_-]+)(?::\s*([^}]+))?\}$/.exec(trimmed)
    if (directiveMatch) {
      const tag = directiveMatch[1].toLowerCase()
      const value = (directiveMatch[2] || '').trim()

      switch (tag) {
        case 'soc':
        case 'start_of_chorus':
          parsedLines.push({ type: 'SECTION_HEADER', title: value || 'Chorus' })
          break
        case 't':
        case 'title':
          title = value
          break
        case 'a':
        case 'artist':
        case 'subtitle':
        case 'st':
          artist = value
          break
        case 'key':
          key = value
          break
        case 'original_key':
        case 'originalkey':
          originalKey = value
          break
        case 'capo':
          capo = value
          break
        case 'tempo':
        case 'bpm':
          bpm = value
          break
        case 'time':
          time = value
          break
        case 'year':
          year = value
          break
        case 'tags':
        case 'tag':
        case 'genre':
          tags = value
          break
        case 'c':
        case 'comment':
          parsedLines.push({ type: 'SECTION_HEADER', title: value })
          break
      }
      chordProCount++
      continue
    }

    // 3. Tab lines
    if (TAB_LINE_REGEX.test(trimmed) && trimmed.length > 4) {
      parsedLines.push({ type: 'TAB', content: rawLine })
      continue
    }

    // 4a. Combined Section Header + Chords e.g. "Intro: [A] [F#m] [D] [E] [A]" or "[Intro] G - D/F# - Em7"
    const combinedMatch =
      /^(?:(\[[^\]]+\]:?)|((?:Intro|Verse|Chorus|Bridge|Pre-Chorus|Post-Chorus|Outro|Solo|Interlude|Hook|Ending|Riff|Instrumental|Refrain|Transposed|Repeat|Adlib|Breakdown|Coda)(?:\s+[0-9A-Za-z\-_/]+)?:?))\s+(.+)$/i.exec(
        trimmed
      )
    if (combinedMatch) {
      const headerRaw = combinedMatch[1] || combinedMatch[2]
      const restPart = combinedMatch[3].trim()
      const headerPart = headerRaw.replace(/[[\]<>:]/g, '').trim()

      if (isSectionHeader(`[${headerPart}]`)) {
        parsedLines.push({ type: 'SECTION_HEADER', title: headerPart })

        const restBrackets = findBracketedChords(restPart)
        if (restBrackets.length > 0) {
          if (!hasInlineLyricContent(restPart, restBrackets)) {
            // Standalone chord row
            const chordTokens = restBrackets.map((b) =>
              transposeOffset !== 0 ? transposeChordToken(b.chord, transposeOffset) : b.chord
            )
            const normalized = normalizeChordLineBrackets(restPart, restBrackets)
            const transposedRaw =
              transposeOffset !== 0 ? transposeChordLine(normalized, transposeOffset) : normalized
            parsedLines.push({
              type: 'CHORD_ROW',
              chords: chordTokens,
              raw: transposedRaw,
              isOverLyric: false,
            })
          } else {
            parsedLines.push({ type: 'CHORD_PRO', raw: restPart, segments: parseChordProLine(restPart, transposeOffset) })
          }
          chordProCount++
          continue
        } else if (isChordLine(restPart)) {
          const rawTokens = extractChordTokensFromLine(restPart)
          const chordTokens = rawTokens.map((t) =>
            transposeOffset !== 0 ? transposeChordToken(t, transposeOffset) : t
          )
          const transposedRaw =
            transposeOffset !== 0 ? transposeChordLine(restPart, transposeOffset) : restPart
          parsedLines.push({
            type: 'CHORD_ROW',
            chords: chordTokens,
            raw: transposedRaw,
            isOverLyric: false,
          })
          twoLineCount++
          continue
        }
      }
    }

    // 4b. Standalone Section Header e.g. "[Intro]", "[Verse 1]", "[Chorus]"
    if (isSectionHeader(trimmed)) {
      const cleanTitle = trimmed.replace(/[[\]<>():]/g, '').trim()
      parsedLines.push({ type: 'SECTION_HEADER', title: cleanTitle })
      continue
    }

    // 5. Bracketed chord lines
    const bracketed = findBracketedChords(rawLine)
    if (bracketed.length > 0) {
      if (!hasInlineLyricContent(rawLine, bracketed)) {
        // 5a. STANDALONE CHORD ROW (e.g. "[A] [F#m] [D] [E] [A]" or "[G] [C] [D]")
        const chordTokens = bracketed.map((b) =>
          transposeOffset !== 0 ? transposeChordToken(b.chord, transposeOffset) : b.chord
        )
        const normalized = normalizeChordLineBrackets(rawLine, bracketed)
        const transposedRaw =
          transposeOffset !== 0 ? transposeChordLine(normalized, transposeOffset) : normalized

        parsedLines.push({
          type: 'CHORD_ROW',
          chords: chordTokens,
          raw: transposedRaw,
        })
        chordProCount++
      } else {
        parsedLines.push({ type: 'CHORD_PRO', raw: rawLine, segments: parseChordProLine(rawLine, transposeOffset) })
        chordProCount++
      }
      continue
    }

    // 6. 2-line raw unbracketed chord line e.g. "G D/F# Em7 C D" or "G - D/F# - Em7"
    if (isChordLine(rawLine)) {
      const tokens = extractChordTokensFromLine(rawLine)
      const transposedTokens = tokens.map((t) =>
        transposeOffset !== 0 ? transposeChordToken(t, transposeOffset) : t
      )
      const transposedRaw =
        transposeOffset !== 0 ? transposeChordLine(rawLine, transposeOffset) : rawLine
      parsedLines.push({
        type: 'CHORD_ROW',
        chords: transposedTokens,
        raw: transposedRaw,
      })
      twoLineCount++
      continue
    }

    // 7. Regular lyric line fallback
    parsedLines.push({ type: 'LYRIC', lyrics: rawLine })
  }

  // Post-process lines: detect if a CHORD_ROW is directly over a lyric line (for 2-line layout alignment)
  for (let i = 0; i < parsedLines.length; i++) {
    const line = parsedLines[i]
    if (line.type === 'CHORD_ROW') {
      if (line.isOverLyric === undefined) {
        const nextLine = parsedLines[i + 1]
        line.isOverLyric = Boolean(nextLine && nextLine.type === 'LYRIC')
      }
    }
  }

  // Deduplicate consecutive section headers (e.g. [Pre-Chorus] followed immediately by [Pre-Chorus 1])
  const deduplicatedLines: SongLine[] = []
  for (let i = 0; i < parsedLines.length; i++) {
    const current = parsedLines[i]
    if (current.type === 'SECTION_HEADER') {
      let prevHeaderIdx = -1
      for (let j = deduplicatedLines.length - 1; j >= 0; j--) {
        if (deduplicatedLines[j].type === 'EMPTY') continue
        if (deduplicatedLines[j].type === 'SECTION_HEADER') {
          prevHeaderIdx = j
        }
        break
      }

      if (prevHeaderIdx !== -1) {
        const prevHeader = deduplicatedLines[prevHeaderIdx] as { type: 'SECTION_HEADER'; title: string }
        const normPrev = prevHeader.title.toLowerCase().replace(/[^a-z0-9]/g, '')
        const normCurr = current.title.toLowerCase().replace(/[^a-z0-9]/g, '')

        if (normPrev === normCurr || normPrev.startsWith(normCurr) || normCurr.startsWith(normPrev)) {
          // Keep the more detailed / specific title
          if (current.title.length > prevHeader.title.length) {
            prevHeader.title = current.title
          }
          // Remove empty lines between redundant headers
          while (deduplicatedLines.length > prevHeaderIdx + 1) {
            deduplicatedLines.pop()
          }
          continue
        }
      }
    }
    deduplicatedLines.push(current)
  }

  const format: SongFormat =
    chordProCount > twoLineCount ? 'CHORD_PRO' : twoLineCount > 0 ? 'TWO_LINE' : 'PLAIN'

  // If no explicit {key: ...} directive was provided, detect key from chords rather than defaulting to empty or G
  const effectiveKey = key || detectSongKey(rawText)

  return {
    title,
    artist,
    key: effectiveKey,
    originalKey,
    capo,
    bpm,
    time: time || undefined,
    year,
    tags,
    format,
    lines: deduplicatedLines,
  }
}

/**
 * Standardizes chord notation to standard ChordPro bracket format:
 * - Converts angle bracket chords <C>, <F#m>, <G11> to [C], [F#m], [G11]
 * - Converts hyphenated angle brackets <C#m>-<B> or <C#m-B> to [C#m]-[B]
 */
export function standardizeChordProBrackets(text: string): string {
  if (!text) return ''
  let result = text
  // Hyphenated bracketed chords
  result = result.replace(/<([A-G][b#]?[^>]*)-([A-G][b#]?[^>]*)>/g, '[$1]-[$2]')
  result = result.replace(/<([A-G][b#]?[^>]*)>-<([A-G][b#]?[^>]*)>/g, '[$1]-[$2]')
  // Single angle bracket chords
  result = result.replace(/<([A-G][b#]?[^>]*)>/g, '[$1]')
  return result
}

/**
 * Splits song lines into two columns for widescreen desktop displays,
 * preferring a section header boundary near the middle (exact v1.0.42 algorithm).
 */
export function splitSongLinesForColumns(lines: SongLine[]): [SongLine[], SongLine[]] {
  if (lines.length <= 4) {
    return [lines, []]
  }

  const mid = Math.floor(lines.length / 2)
  let splitIndex = mid
  const minSearch = Math.max(1, mid - 6)
  const maxSearch = Math.min(lines.length - 2, mid + 6)

  for (let i = minSearch; i <= maxSearch; i++) {
    if (lines[i].type === 'SECTION_HEADER') {
      splitIndex = i
      break
    }
  }

  if (lines[splitIndex]?.type === 'LYRIC' && lines[splitIndex - 1]?.type === 'CHORD_ROW') splitIndex--
  return [lines.slice(0, splitIndex), lines.slice(splitIndex)]
}

/**
 * Robustly detects song key from raw song content:
 * 1. Explicit ChordPro directive {key: ...} or {k: ...}
 * 2. Leading metadata lines e.g. "Key: C" or "Key of C"
 * 3. Most prominent or tonic starting chord from chord charts
 * 4. Fallback to 'C' (natural diatonic root) rather than arbitrary 'G'
 */
export function detectSongKey(rawContent: string): string {
  if (!rawContent || !rawContent.trim()) return 'C'

  // 1. Explicit ChordPro directive {key: X} or {k: X}
  const directiveMatch = /\{(?:key|k):\s*([A-Ga-g][#b]?(?:m|maj|min)?(?:\b|[^\s}]))\s*\}/i.exec(rawContent)
  if (directiveMatch && directiveMatch[1]) {
    const rawKey = directiveMatch[1].trim()
    const parsedKey = parseChordRootAndQuality(rawKey)
    if (parsedKey) return parsedKey
  }

  // 2. Metadata line at start of chart: "Key: C" or "Key of C" or "Original Key: C"
  const metaMatch = /^\s*(?:original\s+)?key(?:\s+of)?\s*:\s*([A-Ga-g][#b]?(?:m|maj|min)?(?:\b|[^\s\n\r]))/im.exec(rawContent)
  if (metaMatch && metaMatch[1]) {
    const parsedKey = parseChordRootAndQuality(metaMatch[1].trim())
    if (parsedKey) return parsedKey
  }

  // 3. Scan lines for chords and extract the first prominent tonic chord
  const lines = rawContent.split(/\r?\n/)
  const allChords: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('{') || isTabChartLine(line)) continue

    // A. Bracketed chords
    const bracketed = findBracketedChords(line)
    if (bracketed.length > 0) {
      for (const b of bracketed) {
        const root = parseChordRootAndQuality(b.chord)
        if (root) allChords.push(root)
      }
      if (allChords.length >= 8) break
      continue
    }

    // B. Chord row line
    if (isChordLine(line)) {
      const tokens = extractChordTokensFromLine(line)
      for (const t of tokens) {
        const root = parseChordRootAndQuality(t)
        if (root) allChords.push(root)
      }
      if (allChords.length >= 8) break
    }
  }

  if (allChords.length > 0) {
    // Return first prominent root chord as original tonic
    return allChords[0]
  }

  return 'C'
}

/**
 * Normalizes a chord token into standard Key format (e.g. "C", "G", "Am", "F#m", "Bb")
 */
function parseChordRootAndQuality(chord: string): string | null {
  if (!chord) return null
  const clean = chord.trim().replace(/^\[|\]$/g, '')
  const match = /^([A-Ga-g][#b]?)(m|min|maj)?/i.exec(clean)
  if (!match) return null

  const root = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
  const quality = (match[2] || '').toLowerCase()
  const isMinor = quality === 'm' || quality === 'min'

  return isMinor ? `${root}m` : root
}

