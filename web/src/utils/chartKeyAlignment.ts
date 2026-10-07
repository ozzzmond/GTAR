import { normalizeMusicalKey, musicalKeyPitchClass } from './musicalKey'
import { transposeChordToken, transposeChordLine } from './chordTransposer'
import { parseGtarSong, isTabChartLine, isSectionHeader } from './songParser'

type Chart = { key?: string | null; rawContent: string }

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

/**
 * Transposes song text by semitones, respecting targetKey enharmonic preference where available.
 * Classification uses the same parser as the preview; never rewrites lyrics or fixed-pitch tabs.
 */
export function transposeChartText(
  rawContent: string,
  semitones: number,
  targetKey?: string | null
): string {
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
          return piece[0] + transposeChordToken(chord, semitones, targetKey) + piece.slice(-1)
        }
        return parsed.some(value => value.type === 'CHORD_PRO') ? piece : transposeChordLine(piece, semitones, targetKey)
      }).join('')
      return parsed.some(value => value.type === 'CHORD_PRO') ? part : transposeChordLine(part, semitones, targetKey)
    }).join('')
  }).join('')
}

/**
 * Pure deterministic canonical song transposition API.
 * Transposes canonical ChordPro text from sourceKey to targetKey:
 * - Computes deterministic semitone movement from pitch classes
 * - Applies target-key aware enharmonic spelling
 * - Updates canonical {key: ...} metadata
 * - Preserves all directives, comments, lyrics, and non-chord lines
 * - Completely local, pure function with no network/AI dependencies
 */
export function transposeCanonicalSong(
  rawContent: string,
  fromKey: string,
  toKey: string
): { rawContent: string; key: string; semitones: number } {
  const normFrom = normalizeMusicalKey(fromKey)
  const normTo = normalizeMusicalKey(toKey)

  if (!normTo) {
    return { rawContent, key: normFrom || fromKey, semitones: 0 }
  }

  if (!normFrom) {
    // If source key is unknown/unspecified, simply establish {key: toKey} without altering chords
    return {
      rawContent: establishChartKey(rawContent, normTo),
      key: normTo,
      semitones: 0,
    }
  }

  const fromPc = musicalKeyPitchClass(normFrom)
  const toPc = musicalKeyPitchClass(normTo)

  if (fromPc === null || toPc === null) {
    return {
      rawContent: establishChartKey(rawContent, normTo),
      key: normTo,
      semitones: 0,
    }
  }

  const delta = ((toPc - fromPc) % 12 + 12) % 12
  if (delta === 0) {
    // Same pitch class: if spelling differs (e.g. C# vs Db), update key declaration and apply target enharmonic
    if (normFrom !== normTo) {
      return {
        rawContent: establishChartKey(rawContent, normTo),
        key: normTo,
        semitones: 0,
      }
    }
    return { rawContent, key: normTo, semitones: 0 }
  }

  const transposed = transposeChartText(rawContent, delta, normTo)
  const finalContent = establishChartKey(transposed, normTo)

  return {
    rawContent: finalContent,
    key: normTo,
    semitones: delta,
  }
}

export function alignChartKey(chart: Chart, targetValue: string, confirmedSource?: string) {
  const target = normalizeMusicalKey(targetValue)
  if (!target) return { changes: {}, needsSource: false }
  const source = confirmedSource ? normalizeMusicalKey(confirmedSource) : trustworthyChartKey(chart)
  if (!source) return { changes: {}, needsSource: true }

  const result = transposeCanonicalSong(chart.rawContent, source, target)
  return { changes: { key: result.key, rawContent: result.rawContent }, needsSource: false }
}

export function acceptOriginalKey(chart: Chart, value?: string, confirmedSource?: string) {
  const originalKey = normalizeMusicalKey(value || '')
  if (!originalKey) return { changes: {}, needsSource: false }
  const aligned = alignChartKey(chart, originalKey, confirmedSource)
  return { ...aligned, changes: { ...aligned.changes, originalKey } }
}
