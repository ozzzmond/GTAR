/**
 * #149 S4: OnSong song files (`.onsong`, plain text) → GTAR ChordPro.
 *
 * OnSong text: an optional header (title on the first line, artist on the second, then
 * `Key: G`, `Tempo: 120`, `Time: 4/4`, `Capo: 2`, `Copyright: …`, `CCLI: …`), a blank line,
 * then the body, where `Verse 1:` style lines are section labels and chords are inline in
 * [brackets] or written above the lyrics. Nothing is invented: only values present in the file
 * become directives, `Key:` is the chart key (never `original_key`), and every body line is kept.
 * OnSong backups/archives (zip or database) are not song files and are refused.
 */
export const ONSONG_EXTENSIONS = ['.onsong'] as const
export const SONG_FILE_EXTENSIONS = ['.txt', '.cho', '.chordpro', '.chopro', '.pro', '.chordtxt', '.crd', '.tab', '.onsong', '.json'] as const

export const isOnSongFile = (filename: string) => filename.toLowerCase().endsWith('.onsong')

/** Zip (OnSong .backup/.archive), SQLite, or other binary content. */
export function looksLikeArchive(text: string): boolean {
  return text.startsWith('PK\u0003\u0004') || text.startsWith('SQLite format 3') || text.includes('\u0000')
}

const META: Record<string, string> = {
  title: 'title', artist: 'artist', author: 'artist', key: 'key', tempo: 'tempo', bpm: 'tempo',
  time: 'time', 'time signature': 'time', capo: 'capo', copyright: 'copyright', ccli: 'ccli', year: 'year',
}
const SECTION = /^\s*((?:verse|chorus|pre-?chorus|bridge|intro|outro|tag|interlude|ending|instrumental|refrain|coda|vamp|turnaround)\b[^:]{0,40}):\s*$/i

export interface OnSongConversion { content: string; title?: string; artist?: string; key?: string; warnings: string[] }

export function onsongToChordPro(text: string): OnSongConversion {
  const warnings: string[] = []
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const meta: Record<string, string> = {}
  let i = 0
  const plain: string[] = []
  // Header: up to the first blank line, but only while lines look like header lines.
  for (; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) { i++; break }
    if (SECTION.test(line) || line.includes('[')) break
    const m = line.match(/^([A-Za-z][A-Za-z ]{0,20}):\s*(.*)$/)
    const name = m ? META[m[1].trim().toLowerCase()] : undefined
    if (name && m![2].trim()) { meta[name] ??= m![2].trim(); continue }
    if (m) break // unknown "Label: value": part of the body, kept as is
    if (plain.length < 2) { plain.push(line); continue }
    break
  }
  if (!meta.title && plain[0]) meta.title = plain[0]
  if (!meta.artist && plain[1]) meta.artist = plain[1]
  const header: string[] = []
  for (const name of ['title', 'artist', 'key', 'tempo', 'time', 'year', 'capo', 'copyright', 'ccli']) {
    if (meta[name]) header.push(`{${name}: ${meta[name]}}`)
  }
  // The header lines consumed above are exactly lines [0, bodyStart); everything after is the body.
  const bodyStart = i
  const body = lines.slice(bodyStart).map(line => {
    const section = line.match(SECTION)
    return section ? `{comment: ${section[1].trim()}}` : line
  })
  while (body.length && !body[0].trim()) body.shift()
  while (body.length && !body[body.length - 1].trim()) body.pop()
  if (!meta.title) warnings.push('No title found; the file name will be used.')
  if (!body.length) warnings.push('No song body found.')
  return { content: [...header, '', ...body].join('\n').trim() + '\n', title: meta.title, artist: meta.artist, key: meta.key, warnings }
}
