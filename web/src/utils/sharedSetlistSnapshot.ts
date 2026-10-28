// Shared by server resolution and the exact-source publication preview.
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export const SETLIST_LIMITS = { snapshotBytes: 262144, occurrences: 100, chartBytes: 102400 } as const
const encoder = new TextEncoder()
const formats = ['CHORD_PRO', 'TWO_LINE', 'PLAIN']
const songFields = ['title', 'artist', 'rawContent', 'format', 'key', 'originalKey',
  'confirmedChartKey', 'capo', 'transposeOffset', 'bpm', 'time', 'year']

function fail(message = 'Invalid setlist snapshot'): never { throw new Error(message) }
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) fail()
}
function text(value: unknown, max: number, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail()
}
function identity(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) ||
      !String(value).trim() || String(value).length > 128) fail('Invalid source identity')
  return String(value)
}

/** Strict versioned public contract. No private IDs, lineage, backup or account fields. */
export function validateSnapshot(value: unknown): asserts value is {
  version: number; name: string; entries: Record<string, unknown>[]
} {
  if (!isJsonObject(value)) fail()
  exactKeys(value, ['version', 'name', 'entries'])
  if (value.version !== 1) fail('Unsupported snapshot version')
  text(value.name, 200, true)
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > SETLIST_LIMITS.occurrences) fail()
  for (const entry of value.entries) {
    if (!isJsonObject(entry)) fail()
    exactKeys(entry, songFields)
    text(entry.title, 200, true)
    text(entry.rawContent, SETLIST_LIMITS.chartBytes, true)
    if (encoder.encode(String(entry.rawContent)).length > SETLIST_LIMITS.chartBytes || !formats.includes(String(entry.format))) fail()
    for (const key of songFields.filter(key => !['title', 'rawContent', 'format', 'transposeOffset'].includes(key))) {
      if (entry[key] !== undefined && entry[key] !== null) text(entry[key], key === 'artist' ? 200 : 50)
    }
    if (entry.transposeOffset !== undefined &&
        (!Number.isSafeInteger(entry.transposeOffset) || Math.abs(Number(entry.transposeOffset)) > 48)) fail()
  }
  const size = encoder.encode(JSON.stringify(value)).length
  if (size > SETLIST_LIMITS.snapshotBytes) {
    fail(`Snapshot too large: ${Math.ceil(size / 1024)} KB exceeds the ${SETLIST_LIMITS.snapshotBytes / 1024} KB shared setlist limit. ` +
      'Split the setlist or shorten long charts, then review again.')
  }
}

/** #253 client snapshot: validate the submitted value as-is, then store one canonical field order
 * (null/absent optional fields dropped). Throws before anything is written. */
export function normalizeSnapshot(value: unknown) {
  validateSnapshot(value)
  const snapshot = {
    version: 1,
    name: value.name,
    entries: value.entries.map(entry => Object.fromEntries(songFields
      .filter(key => entry[key] !== undefined && entry[key] !== null).map(key => [key, entry[key]]))),
  }
  validateSnapshot(snapshot)
  return snapshot
}

/** Resolve only the authenticated publisher's exact cloud songbook version.
 * ID matches are authoritative; legacy title matches must be unique, including trash.
 * Per-occurrence overrides are unsupported in the verified personal model: reject them.
 */
export function snapshotFromSongbook(data: unknown, setlistId: unknown) {
  if (!isJsonObject(data) || !Array.isArray(data.songs) || !Array.isArray(data.setlists)) fail('Invalid source songbook')
  const matches = data.setlists.filter(s => isJsonObject(s) && identity(s.id) === identity(setlistId))
  if (matches.length !== 1 || !isJsonObject(matches[0])) fail('Missing or ambiguous source setlist')
  const setlist = matches[0]
  if (setlist.isDeleted || !Array.isArray(setlist.songs)) fail('Deleted or invalid source setlist')
  const entries = setlist.songs.map(ref => {
    if (!isJsonObject(ref)) fail()
    exactKeys(ref, ['id', 'title', 'artist'])
    const candidates = data.songs as unknown[]
    const found = candidates.filter(song => {
      if (!isJsonObject(song)) fail()
      if (ref.id !== undefined) return song.id !== undefined && identity(song.id) === identity(ref.id)
      text(ref.title, 200, true)
      if (ref.artist !== undefined) text(ref.artist, 200)
      return typeof song.title === 'string' && song.title.trim().toLowerCase() === String(ref.title).trim().toLowerCase() &&
        (!String(ref.artist ?? '').trim() || String(song.artist ?? '').trim().toLowerCase() === String(ref.artist).trim().toLowerCase())
    })
    if (found.length !== 1 || !isJsonObject(found[0]) || found[0].isDeleted || found[0].isMissing) fail('Unresolved source occurrence')
    const song = found[0]
    return Object.fromEntries(songFields.filter(key => song[key] !== undefined).map(key => [key, song[key]]))
  })
  const snapshot = { version: 1, name: setlist.name, entries }
  validateSnapshot(snapshot)
  return snapshot
}
