import { parseChordProDirectives } from './chordProMetadata'
import { keysArePitchEquivalent, musicalKeyPitchClass, normalizeMusicalKey } from './musicalKey'
import { transposeKey } from './chordTransposer'
import { detectSongKey } from './songParser'

export interface SongKeySource { key?: string | null; confirmedChartKey?: string | null; originalKey?: string | null; rawContent?: string | null }

export function declaredKey(rawContent: string, original = false) {
  const values = parseChordProDirectives(rawContent).directives
    .filter(d => original ? ['original_key', 'originalkey'].includes(d.name) : ['key', 'k'].includes(d.name))
    .map(d => d.value)
  const key = values.length ? normalizeMusicalKey(values[0]) : ''
  const conflict = values.some(value => normalizeMusicalKey(value) === null || !keysArePitchEquivalent(value, key || ''))
  return { key: key || '', conflict, present: values.length > 0 }
}

/** Resolve provenance without inferring it from chords or from chart state. */
export function resolveSongKeys(song: SongKeySource) {
  const raw = song.rawContent || ''
  const chart = declaredKey(raw)
  const original = declaredKey(raw, true)
  const entityChart = normalizeMusicalKey(song.key)
  const confirmedChart = normalizeMusicalKey(song.confirmedChartKey)
  const entityOriginal = normalizeMusicalKey(song.originalKey)
  // Raw legacy declarations take precedence over cached entity/confirmation state.
  const chartConflict = chart.conflict || (!chart.present && Boolean(song.confirmedChartKey && !confirmedChart))
  const originalConflict = original.conflict || Boolean(song.originalKey && !entityOriginal) ||
    Boolean(entityOriginal && original.present && !keysArePitchEquivalent(entityOriginal, original.key))
  const originalKey = originalConflict ? '' : original.key || entityOriginal || ''
  const canonicalChart = !originalConflict ? original.key : ''
  const chartKey = chart.key || confirmedChart || canonicalChart ||
    (raw ? detectSongKey(raw) : entityChart || '')
  const chartEstimated = raw ? !chart.key && !confirmedChart && !canonicalChart : !confirmedChart && !entityChart
  const compatible = Boolean(originalKey && chartKey && !chartEstimated && !chartConflict &&
    originalKey.endsWith('m') === chartKey.endsWith('m'))
  return { chartKey, originalKey, chartConflict, originalConflict, chartEstimated, originalRelative: compatible }
}

export function wrapKeyOffset(value: number): number {
  return ((value + 6) % 12 + 12) % 12 - 6
}

/** Persisted offsets always remain chart-relative; only the controls use this adapter. */
export function transposeContext(song: SongKeySource, storedOffset: number) {
  const keys = resolveSongKeys(song)
  const distance = keys.originalRelative
    ? wrapKeyOffset(musicalKeyPitchClass(keys.chartKey)! - musicalKeyPitchClass(keys.originalKey)!) : 0
  return {
    ...keys,
    baseKey: keys.originalRelative ? keys.originalKey : keys.chartKey,
    performanceKey: keys.originalRelative
      ? transposeKey(keys.originalKey, wrapKeyOffset(storedOffset + distance))
      : transposeKey(keys.chartKey, storedOffset),
    displayOffset: keys.originalRelative ? wrapKeyOffset(storedOffset + distance) : storedOffset,
    resetOffset: keys.originalRelative ? wrapKeyOffset(-distance) : 0,
    toStoredOffset: (relative: number) => keys.originalRelative ? wrapKeyOffset(relative - distance) : relative,
  }
}
