/**
 * #149 S5: export songs from the Songs Library as plain text (ChordPro) or as a printable page
 * the browser saves as PDF. Local only: nothing is uploaded and the saved songs are not changed.
 *
 * - TXT is the saved chart exactly as stored (ChordPro text, the format GTAR imports back).
 *   Several songs go into one file, separated by the ChordPro `{new_song}` directive.
 * - PDF renders chords above lyrics, one song per page, through the browser's print dialog
 *   ("Save as PDF"). It can use the saved key or each song's current transposed key.
 */
import type { ActiveSongState, SongLine } from '../types/gtar'
import { parseGtarSong } from './songParser'
import { transposeContext } from './songKeySemantics'

export type ExportKeyMode = 'saved' | 'transposed'

export function safeFileName(name: string, fallback = 'song'): string {
  // eslint-disable-next-line no-control-regex -- control characters are invalid in file names
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned || fallback
}

export function songsToTxt(songs: ActiveSongState[]): { filename: string; text: string } {
  const bodies = songs.map(song => song.rawContent.replace(/\r\n?/g, '\n').replace(/\s+$/, ''))
  const text = bodies.join('\n\n{new_song}\n\n') + '\n'
  const filename = songs.length === 1 ? `${safeFileName(songs[0].title)}.txt` : `GTAR songs (${songs.length}).txt`
  return { filename, text }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))

function renderLine(line: SongLine): string {
  switch (line.type) {
    case 'EMPTY': return '<div class="gap"></div>'
    case 'SECTION_HEADER': return `<h3>${escapeHtml(line.title)}</h3>`
    case 'TAB': return `<pre class="tab">${escapeHtml(line.content)}</pre>`
    case 'CHORD_ROW': return `<pre class="chords">${escapeHtml(line.raw)}</pre>`
    case 'LYRIC': return `<pre class="lyric">${escapeHtml(line.lyrics)}</pre>`
    case 'CHORD_PRO':
      return `<div class="cp">${line.segments.map(seg =>
        `<span class="seg"><span class="c">${seg.chord ? escapeHtml(seg.chord) : '&nbsp;'}</span><span class="l">${escapeHtml(seg.text) || '&nbsp;'}</span></span>`).join('')}</div>`
  }
}

export function exportKeyOf(song: ActiveSongState, mode: ExportKeyMode): { key: string; offset: number } {
  const offset = mode === 'transposed' ? song.transposeOffset || 0 : 0
  const context = transposeContext(song, offset)
  return { key: (mode === 'transposed' ? context.performanceKey : context.chartKey) || song.key || '', offset }
}

/** A self-contained printable document (no scripts; inline styles only). */
export function buildPrintHtml(songs: ActiveSongState[], mode: ExportKeyMode): string {
  const pages = songs.map(song => {
    const { key, offset } = exportKeyOf(song, mode)
    const parsed = parseGtarSong(song.rawContent, offset)
    const meta = [key && `Key ${key}`, song.bpm && song.bpm !== '120' ? song.bpm : '', song.time, song.capo && !/no capo/i.test(song.capo) ? `Capo ${song.capo}` : '']
      .filter(Boolean).map(v => escapeHtml(String(v))).join(' · ')
    return `<section class="song"><h1>${escapeHtml(song.title || parsed.title)}</h1>` +
      (song.artist ? `<h2>${escapeHtml(song.artist)}</h2>` : '') + (meta ? `<p class="meta">${meta}</p>` : '') +
      parsed.lines.map(renderLine).join('') + '</section>'
  }).join('')
  const title = songs.length === 1 ? songs[0].title : `GTAR songs (${songs.length})`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { margin: 14mm; }
body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; }
.song { break-after: page; } .song:last-child { break-after: auto; }
h1 { font-size: 20pt; margin: 0 0 2pt; } h2 { font-size: 12pt; font-weight: normal; margin: 0 0 4pt; color: #444; }
.meta { font-size: 10pt; color: #555; margin: 0 0 10pt; }
h3 { font-size: 11pt; margin: 10pt 0 3pt; text-transform: uppercase; letter-spacing: .04em; break-after: avoid; }
pre { font-family: "Courier New", monospace; font-size: 10.5pt; margin: 0; white-space: pre-wrap; break-inside: avoid; }
.chords { color: #a00; font-weight: bold; }
.cp { display: flex; flex-wrap: wrap; align-items: flex-end; break-inside: avoid; margin: 1pt 0; }
.seg { display: inline-flex; flex-direction: column; white-space: pre; }
.c { color: #a00; font-weight: bold; font-size: 10pt; min-height: 1.2em; padding-right: 2pt; }
.l { font-size: 11pt; }
.gap { height: 6pt; }
</style></head><body>${pages}</body></html>`
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Opens the printable page from the user's click and starts the print dialog. False if blocked. */
export function printSongs(songs: ActiveSongState[], mode: ExportKeyMode, open: typeof window.open = window.open.bind(window)): boolean {
  const win = open('', '_blank')
  if (!win) return false
  win.document.open()
  win.document.write(buildPrintHtml(songs, mode))
  win.document.close()
  win.focus()
  // Let layout settle before printing; no script runs inside the printed page.
  setTimeout(() => { try { win.print() } catch { /* the user can still print from the tab */ } }, 300)
  return true
}
