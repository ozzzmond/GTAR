// Deterministic synthetic GTAR songbook fixtures for scale tests and benchmarks (#139).
// All content is generated: no real lyrics, charts or user data.
'use strict'

const KEYS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Am', 'Em']
const PROGRESSIONS = [['C', 'G', 'Am', 'F'], ['G', 'D', 'Em', 'C'], ['D', 'A', 'Bm', 'G'], ['A', 'E', 'F#m', 'D'], ['E', 'B', 'C#m', 'A']]
const WORDS = ['light', 'river', 'morning', 'grace', 'open', 'song', 'mountain', 'quiet', 'hands', 'rise', 'home', 'fire', 'gentle', 'voice']
// Approximate chart sizes in characters; the mix skews toward typical worship-song charts.
const SIZE_CLASSES = [{ name: 'short', chars: 1200 }, { name: 'typical', chars: 3000 }, { name: 'typical', chars: 3500 }, { name: 'long', chars: 8000 }]

/** Small seeded PRNG (mulberry32) so every run produces identical fixtures. */
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)]
const pad = n => String(n).padStart(6, '0')

/** ChordPro chart with the canonical six-field header, sized to roughly targetChars. */
function chart(rand, title, artist, key, targetChars) {
  const header = `{title: ${title}}\n{artist: ${artist}}\n{original_key: ${key}}\n{tempo: ${60 + Math.floor(rand() * 80)} BPM}\n{time: 4/4}\n{year: ${1990 + Math.floor(rand() * 35)}}\n`
  const lines = [header]
  let size = header.length
  let section = 0
  while (size < targetChars) {
    const label = section % 3 === 2 ? 'Chorus' : `Verse ${Math.floor(section / 3) + 1}`
    const block = [`\n{comment: ${label}}`]
    const progression = pick(rand, PROGRESSIONS)
    for (let i = 0; i < 4; i++) {
      const words = Array.from({ length: 6 }, () => pick(rand, WORDS))
      block.push(words.map((w, j) => (j % 2 === 0 ? `[${progression[(i + j / 2) % 4]}]` : '') + w).join(' '))
    }
    const text = block.join('\n')
    lines.push(text)
    size += text.length
    section++
  }
  return lines.join('')
}

function makeSong(index, options = {}) {
  const rand = prng((options.seed ?? 139) * 1_000_003 + index)
  const size = options.chars ?? SIZE_CLASSES[index % SIZE_CLASSES.length].chars
  const key = KEYS[index % KEYS.length]
  const title = `Synthetic Song ${pad(index)}`
  const artist = `Test Artist ${String(index % 97).padStart(2, '0')}`
  return {
    id: `synthetic-${pad(index)}`,
    title,
    artist,
    key,
    originalKey: key,
    bpm: String(60 + (index % 80)),
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: chart(rand, title, artist, key, size),
  }
}

/** Library with `count` distinct songs and one setlist of the first `setlistSize` songs. */
function makeLibrary(count, setlistSize = Math.min(count, 62), options = {}) {
  const songs = Array.from({ length: count }, (_, i) => makeSong(i + 1, options))
  const setlist = { id: `synthetic-set-${setlistSize}`, name: `${setlistSize}-Song Synthetic Setlist`,
    songs: songs.slice(0, setlistSize).map(s => ({ id: s.id, title: s.title, artist: s.artist })) }
  return { songs, setlists: [setlist] }
}

/** In-memory Storage that throws a QuotaExceededError past `quotaChars` (key + value length). */
class QuotaStorage {
  constructor(quotaChars = 5 * 1024 * 1024) { this.quotaChars = quotaChars; this.map = new Map() }
  get length() { return this.map.size }
  key(i) { return Array.from(this.map.keys())[i] ?? null }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
  used(except) { let n = 0; for (const [k, v] of this.map) if (k !== except) n += k.length + v.length; return n }
  setItem(k, v) {
    v = String(v)
    if (this.used(k) + k.length + v.length > this.quotaChars) {
      const error = new Error('The quota has been exceeded.'); error.name = 'QuotaExceededError'; error.code = 22
      throw error
    }
    this.map.set(k, v)
  }
}

module.exports = { prng, makeSong, makeLibrary, QuotaStorage, SIZE_CLASSES }
