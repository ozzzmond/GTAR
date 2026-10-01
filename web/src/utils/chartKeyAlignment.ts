import { normalizeMusicalKey } from './musicalKey'
import { transposeChordToken, transposeChordLine } from './chordTransposer'
import { parseGtarSong, isTabChartLine, isSectionHeader } from './songParser'

type Chart = { key?: string | null; rawContent: string }
const roots = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// A legacy label or first-chord inference alone is not evidence of the tonic.
export function trustworthyChartKey(chart: Chart): string | null {
  const key = normalizeMusicalKey(chart.key || '')
  const declarations = [...chart.rawContent.matchAll(/^\s*\{key:\s*([^}]+)\}\s*$/gim)]
  return key && declarations.length > 0 && declarations.every(m => normalizeMusicalKey(m[1]) === key) ? key : null
}

export function establishChartKey(rawContent: string, key: string): string {
  const declaration = /^([ \t]*)\{key:\s*[^}]+\}([ \t]*)(\r?)$/gim
  return declaration.test(rawContent)
    ? rawContent.replace(declaration, (_match, before, after, cr) => `${before}{key: ${key}}${after}${cr}`)
    : `{key: ${key}}${rawContent.includes('\r\n') ? '\r\n' : '\n'}${rawContent}`
}

// Classification uses the same parser as the preview; never rewrite lyrics or fixed-pitch tabs.
export function transposeChartText(rawContent: string, semitones: number): string {
  if (!semitones) return rawContent
  let tab = false
  let chartBlock = false
  return rawContent.split(/(\r?\n)/).map(line => {
    if (/^\r?\n$/.test(line)) return line
    if (/^\s*\{(?:sot|start_of_tab)\}\s*$/i.test(line)) { tab = true; return line }
    if (/^\s*\{(?:eot|end_of_tab)\}\s*$/i.test(line)) { tab = false; chartBlock = false; return line }
    if (!line.trim() || isSectionHeader(line)) chartBlock = false
    if (tab || chartBlock || isTabChartLine(line)) {
      chartBlock ||= /^\s*(?:chords?|chord\s+(?:chart|diagrams?|definitions?))\s*:/i.test(line)
      return line
    }
    const parsed = parseGtarSong(line).lines
    if (!parsed.some(value => value.type === 'CHORD_ROW' || value.type === 'CHORD_PRO')) return line
    // Protect embedded directives as well as standalone metadata.
    return line.split(/(\{[^{}]*\})/).map(part => {
      if (part.startsWith('{')) return part
      if (/[[<]/.test(part)) return part.split(/(\[[^\]]*\]|<[^>]*>)/).map(piece => {
        if (/^(?:\[|<)/.test(piece)) {
          const chord = piece.slice(1, -1)
          return piece[0] + transposeChordToken(chord, semitones) + piece.slice(-1)
        }
        return parsed.some(value => value.type === 'CHORD_PRO') ? piece : transposeChordLine(piece, semitones)
      }).join('')
      return parsed.some(value => value.type === 'CHORD_PRO') ? part : transposeChordLine(part, semitones)
    }).join('')
  }).join('')
}

export function alignChartKey(chart: Chart, targetValue: string, confirmedSource?: string) {
  const target = normalizeMusicalKey(targetValue)
  if (!target) return { changes: {}, needsSource: false }
  const source = confirmedSource ? normalizeMusicalKey(confirmedSource) : trustworthyChartKey(chart)
  if (!source) return { changes: {}, needsSource: true }
  const delta = (roots.indexOf(target.replace(/m$/, '')) - roots.indexOf(source.replace(/m$/, '')) + 12) % 12
  const rawContent = source === target && !confirmedSource ? chart.rawContent
    : establishChartKey(transposeChartText(chart.rawContent, delta), target)
  return { changes: { key: target, rawContent }, needsSource: false }
}

export function acceptOriginalKey(chart: Chart, value?: string) {
  const originalKey = normalizeMusicalKey(value || '')
  if (!originalKey) return { changes: {}, needsSource: false }
  const aligned = alignChartKey(chart, originalKey)
  return { ...aligned, changes: { ...aligned.changes, originalKey } }
}
