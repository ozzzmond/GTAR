/**
 * #167 Option B, phase B1 (DEV toggle, off by default): slim library index.
 *
 * With B1 on, the library revision lives in `gtar_library_v2`: songs carry `contentHash` (body in
 * IndexedDB, see libraryBodyStore) or, until IndexedDB confirms the body, an inline
 * `pendingRawContent`. Saves stay synchronous; bodies are confirmed in the background and the next
 * save swaps the inline copy for its hash. `gtar_library_v1` is frozen as a complete fallback and is
 * never deleted here. This module has no syncJournal import so syncJournal can depend on it.
 */
export const LIBRARY_V2_KEY = 'gtar_library_v2'
export const LIBRARY_B1_KEY = 'gtar_library_b1_enabled'
export const LIBRARY_INDEX_FORMAT = 'gtar-library-index-v2'

export class MissingLibraryBodyError extends Error {
  readonly hashes: string[]
  constructor(hashes: string[]) {
    super(`Library chart bodies unavailable: ${hashes.length}`)
    this.name = 'MissingLibraryBodyError'
    this.hashes = hashes
  }
}
export const isMissingLibraryBodyError = (error: unknown): error is MissingLibraryBodyError => error instanceof MissingLibraryBodyError

/** IndexedDB access, injected by the DEV bootstrap. `load` must return only hash-verified bodies. */
export interface LibraryBodyBackend {
  load(hashes: string[]): Promise<Map<string, string>>
  store(bodies: string[]): Promise<Map<string, string>> // body -> hash, after the write is durable
}

const bodyByHash = new Map<string, string>()
const hashByBody = new Map<string, string>()
let backend: LibraryBodyBackend | null = null
let backendWaiters: Array<(value: LibraryBodyBackend) => void> = []

export function rememberLibraryBodies(entries: Iterable<readonly [string, string]>): void {
  for (const [hash, body] of entries) { bodyByHash.set(hash, body); hashByBody.set(body, hash) }
}
export function forgetLibraryBodies(): void { bodyByHash.clear(); hashByBody.clear() }

export function setLibraryBodyBackend(next: LibraryBodyBackend | null): void {
  backend = next
  if (next) { backendWaiters.forEach(resolve => resolve(next)); backendWaiters = [] }
}
export function waitForLibraryBodyBackend(timeoutMs: number): Promise<LibraryBodyBackend> {
  if (backend) return Promise.resolve(backend)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      backendWaiters = backendWaiters.filter(waiter => waiter !== done)
      reject(new Error('Library body storage unavailable'))
    }, timeoutMs)
    const done = (value: LibraryBodyBackend) => { clearTimeout(timer); resolve(value) }
    backendWaiters.push(done)
  })
}

interface IndexSong { [field: string]: unknown; contentHash?: string; pendingRawContent?: string }
interface IndexValue { format?: string; songs?: IndexSong[]; [field: string]: unknown }

export function isLibraryIndex(value: unknown): value is IndexValue {
  return !!value && typeof value === 'object' && (value as IndexValue).format === LIBRARY_INDEX_FORMAT
}

/** Slim index for a full library. Bodies without a confirmed hash stay inline as `pendingRawContent`. */
export function encodeLibraryIndex(library: { songs: ReadonlyArray<{ rawContent: string }> }): { payload: string; pending: string[] } {
  const pending = new Set<string>()
  const songs = library.songs.map(song => {
    const { rawContent, ...rest } = song
    const hash = hashByBody.get(rawContent)
    if (hash) return { ...rest, contentHash: hash }
    pending.add(rawContent)
    return { ...rest, pendingRawContent: rawContent }
  })
  return { payload: JSON.stringify({ format: LIBRARY_INDEX_FORMAT, ...library, songs }), pending: [...pending] }
}

/** Full library object from a parsed revision. Non-index values pass through unchanged. */
export function decodeLibraryIndex(value: unknown): unknown {
  if (!isLibraryIndex(value)) return value
  const { format: _format, ...rest } = value
  void _format
  const missing: string[] = []
  const songs = (Array.isArray(value.songs) ? value.songs : []).map(song => {
    const { contentHash, pendingRawContent, ...fields } = song
    if (typeof pendingRawContent === 'string') return { ...fields, rawContent: pendingRawContent }
    const body = typeof contentHash === 'string' ? bodyByHash.get(contentHash) : undefined
    if (body === undefined) { missing.push(String(contentHash)); return fields }
    return { ...fields, rawContent: body }
  })
  if (missing.length) throw new MissingLibraryBodyError([...new Set(missing)])
  return { ...rest, songs }
}

/** Loads every body an index references that this tab has not seen yet. */
export async function loadLibraryIndexBodies(raw: string, timeoutMs = 5000): Promise<void> {
  const value: unknown = JSON.parse(raw)
  if (!isLibraryIndex(value) || !Array.isArray(value.songs)) return
  const wanted = [...new Set(value.songs.map(song => song.contentHash).filter((hash): hash is string =>
    typeof hash === 'string' && !bodyByHash.has(hash)))]
  if (!wanted.length) return
  const store = await waitForLibraryBodyBackend(timeoutMs)
  rememberLibraryBodies(await store.load(wanted))
}

let confirming: Promise<void> = Promise.resolve()
/** Background, serialized: make pending bodies durable in IndexedDB, then remember their hashes. */
export function confirmPendingLibraryBodies(bodies: string[], onError?: (error: unknown) => void): Promise<void> {
  const todo = bodies.filter(body => !hashByBody.has(body))
  if (!todo.length || !backend) return confirming
  const store = backend
  confirming = confirming.then(async () => {
    try { rememberLibraryBodies([...(await store.store(todo))].map(([body, hash]) => [hash, body] as const)) }
    catch (error) { onError?.(error) }
  })
  return confirming
}
