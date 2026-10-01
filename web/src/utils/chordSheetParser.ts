import ChordSheetJS from 'chordsheetjs'
import { isChordLine, normalizeAngleBrackets, normalizeSectionMarkers, parseGtarSong } from './songParser'
import { CHORD_TOKEN_REGEX, transposeChordProText } from './chordTransposer'
import type { SongFormat } from '../types/gtar'

export interface ParsedSongResult {
  title?: string
  artist?: string
  key?: string
  capo?: string
  bpm?: string
  format: SongFormat
  html: string
}

export const SAMPLE_SONGS = {
  standByMe: {
    title: 'Stand By Me',
    artist: 'Ben E. King',
    key: 'A',
    capo: 'No Capo',
    bpm: '118',
    format: 'CHORD_PRO' as SongFormat,
    rawContent: `{title: Stand By Me}
{artist: Ben E. King}
{key: A}
{capo: No Capo}
{tempo: 118}

[Intro]
[A]    [F#m]    [D]   [E]   [A]

[Verse 1]
When the [A]night has come
And the [F#m]land is dark
And the [D]moon is the [E]only light we'll [A]see
No, I [A]won't be afraid, oh, I [F#m]won't be afraid
Just as [D]long as you [E]stand, stand by [A]me

[Chorus]
So, darling, darling, [A]stand by me, oh, [F#m]stand by me
Oh, [D]stand, [E]stand by me, [A]stand by me

[Verse 2]
If the [A]sky that we look upon
Should [F#m]tumble and fall
Or the [D]mountains should [E]crumble to the [A]sea
I won't [A]cry, I won't cry, no, I [F#m]won't shed a tear
Just as [D]long as you [E]stand, stand by [A]me

[Chorus]
And darling, darling, [A]stand by me, oh, [F#m]stand by me
Oh, [D]stand now, [E]stand by me, [A]stand by me`,
  },
  elBimbo: {
    title: 'Ang Huling El Bimbo',
    artist: 'Eraserheads',
    key: 'G',
    capo: 'No Capo',
    bpm: '124',
    format: 'TWO_LINE' as SongFormat,
    rawContent: `{title: Ang Huling El Bimbo}
{artist: Eraserheads}
{key: G}
{capo: No Capo}

[Intro]
G  A7  C  G
G  A7  C  G

[Verse 1]
G              A7
Kamukha mo si Paraluman
C                  G
Nung tayo ay bata pa
G              A7
At ang galing-galing mong sumayaw
C               G
Mapa-Boogie man o Cha-Cha

[Chorus]
     Em           G
Magkahawak ang ating kamay
    C             D
At walang kamalay-malay
       Em           G
Na ang huling El Bimbo
       C          D          G
Magtatapos pala sa ating pag-ibig

[Tab]
e|---3---3---0-------3---|
B|---0---2---1-------0---|
G|---0---0---0-------0---|
D|---0---2---2-------0---|
A|---2---0---3-------2---|
E|---3---------------3---|`,
  },
}

/**
 * Extracts metadata directives from raw ChordPro text
 */
export function extractDirectives(rawText: string) {
  const meta: { title?: string; artist?: string; key?: string; originalKey?: string; capo?: string; bpm?: string; year?: string; tags?: string } = {}
  const lines = rawText.split('\n')

  for (const line of lines) {
    const match = line.trim().match(/^\{(\w+)\s*:\s*(.+)\}$/)
    if (match) {
      const tag = match[1].toLowerCase()
      const val = match[2].trim()
      if (tag === 't' || tag === 'title') meta.title = val
      else if (tag === 'a' || tag === 'artist' || tag === 'st' || tag === 'subtitle') meta.artist = val
      else if (tag === 'key') meta.key = val
      else if (tag === 'original_key' || tag === 'originalkey') meta.originalKey = val
      else if (tag === 'capo') meta.capo = val
      else if (tag === 'tempo' || tag === 'bpm') meta.bpm = val
      else if (tag === 'year') meta.year = val
      else if (tag === 'tags' || tag === 'tag' || tag === 'genre') meta.tags = val
    }
  }

  return meta
}

/**
 * Detects whether raw song text is primarily ChordPro (with inline brackets) or 2-line tabs.
 *
 * Only counts tokens that look like real chord names (A–G with optional modifier and/or bass
 * note), NOT section headers like [Intro], [Chorus], [Verse 1], [Tab], etc.
 *
 * Slash chords (D/F#, G/B, Bb/D) are correctly recognised as valid chord tokens.
 */
export function detectFormat(rawText: string): SongFormat {
  return parseGtarSong(rawText).format === 'CHORD_PRO' ? 'CHORD_PRO' : 'TWO_LINE'
}

/**
 * Pre-processes song text for ChordSheetJS:
 * Converts standalone [Verse], [Chorus] bracket headers to ChordPro comments {c: ...}
 * so ChordSheetJS formats them as section titles rather than chord tokens.
 */
function prepareTextForChordSheet(rawText: string): string {
  const lines = normalizeSectionMarkers(normalizeAngleBrackets(rawText)).split('\n')
  const processed: string[] = []

  // Matches standalone section headers on their own line only — never slash chords or inline brackets.
  // Uses anchored word-boundary check so [D/F#] style inline chords in lyric lines are untouched.
  const sectionRegex = /^\[(Intro|Verse|Chorus|Bridge|Pre-?Chorus|Post-?Chorus|Outro|Solo|Ending|Tab|Interlude|Hook|Riff|Instrumental|Refrain|Adlib|Breakdown|Coda)(?:\s+\d+)?\]$/i

  for (const line of lines) {
    const trimmed = line.trim()
    if (sectionRegex.test(trimmed)) {
      const title = trimmed.slice(1, -1)
      processed.push(`{c: ${title}}`)
    } else if (isChordLine(line) && !line.includes('[')) {
      // Validate whole whitespace-delimited tokens; never split extensions or slash basses.
      processed.push(line.replace(/\S+/g, token => CHORD_TOKEN_REGEX.test(token) ? `[${token}]` : token))
    } else {
      processed.push(line)
    }
  }

  return processed.join('\n')
}

/**
 * Parses and formats ChordPro or 2-line lyrics using ChordSheetJS with live transposition
 */
export function parseAndFormatSong(rawText: string, transposeOffset = 0): ParsedSongResult {
  const meta = extractDirectives(rawText)
  const format = detectFormat(rawText)
  const preparedText = prepareTextForChordSheet(rawText)

  let html: string

  try {
    const chordProParser = new ChordSheetJS.ChordProParser()
    // Both input formats now use the shared token grammar and transposer.
    // Avoid the independent ChordsOverWords tokenizer and library slash handling.
    const song = chordProParser.parse(transposeChordProText(preparedText, transposeOffset))

    const formatter = new ChordSheetJS.HtmlTableFormatter({ normalizeChords: false })
    html = formatter.format(song)
  } catch {
    // If parsing fails, provide safe escaped preformatted fallback
    const escaped = rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    html = `<pre class="stage-mono text-solar-text">${escaped}</pre>`
  }

  return {
    title: meta.title,
    artist: meta.artist,
    key: meta.key,
    capo: meta.capo,
    bpm: meta.bpm,
    format,
    html,
  }
}
