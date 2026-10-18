import { parseChordProDirectives } from './chordProMetadata'
import { keysArePitchEquivalent, musicalKeyPitchClass, normalizeMusicalKey } from './musicalKey'
import { transposeKey } from './chordTransposer'
import { detectSongKey } from './songParser'

export interface SongKeySource { key?: string | null; originalKey?: string | null; rawContent?: string | null }

export function declaredKey(rawContent: string, original = false) {
  const values = parseChordProDirectives(rawContent).directives
    .filter(d => original ? ['original_key', 'originalkey'].includes(d.name) : d.name === 'key')
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
  const entityOriginal = normalizeMusicalKey(song.originalKey)
  const chartConflict = chart.conflict || Boolean(song.key && !entityChart) ||
    Boolean(entityChart && chart.present && !keysArePitchEquivalent(entityChart, chart.key))
  const originalConflict = original.conflict || Boolean(song.originalKey && !entityOriginal) ||
    Boolean(entityOriginal && original.present && !keysArePitchEquivalent(entityOriginal, original.key))
  // Once raw chart text exists, an absent directive cannot validate a cached
  // entity key. Use the same estimate as the renderer, never as provenance or
  // as authority for converting original-relative offsets.
  const chartEstimated = raw ? !chart.key : !entityChart
  const chartKey = raw ? chart.key || detectSongKey(raw) : entityChart || ''
  const originalKey = originalConflict ? '' : entityOriginal || original.key
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
    performanceKey: transposeKey(keys.chartKey, storedOffset),
    displayOffset: keys.originalRelative ? wrapKeyOffset(storedOffset + distance) : storedOffset,
    resetOffset: keys.originalRelative ? wrapKeyOffset(-distance) : 0,
    toStoredOffset: (relative: number) => keys.originalRelative ? wrapKeyOffset(relative - distance) : relative,
  }
}
