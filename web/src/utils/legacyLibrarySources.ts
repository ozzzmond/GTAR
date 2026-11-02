/**
 * #300 B3: read-only access to the earlier library storage, for the one-time migration and the
 * recovery export. Nothing here writes, moves or deletes anything.
 *
 * Sources, newest first: B2 partition (DEV toggle `gtar_library_b2_enabled`), B1 index
 * (`gtar_library_v2` + chart bodies in `gtar_library_bodies_db`), `gtar_library_v1`, and the
 * retired v1 copy kept in `gtar_recovery_archives_db` (DEV).
 */
import type { SyncLibrary } from './syncMerge'
import type { LibrarySource } from './libraryStore'

export const LIBRARY_V1_KEY = 'gtar_library_v1'
export const LIBRARY_V2_KEY = 'gtar_library_v2'
export const LIBRARY_B1_KEY = 'gtar_library_b1_enabled'
export const BODY_DB_NAME = 'gtar_library_bodies_db'
export const B2_FLAG_KEY = 'gtar_library_b2_enabled'
export const B2_HEAD_PREFIX = 'gtar_library_b2_head::'
export const B2_WAL_PREFIX = 'gtar_library_b2_wal::'
export const B2_DB_PREFIX = 'gtar_library_b2::'
const ARCHIVE_DB_NAME = 'gtar_recovery_archives_db'
const RETIRED_LIBRARY_KEY = 'gtar_library_v1_retired'

type Song = SyncLibrary['songs'][number]

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })
}
/** Opens an existing database without creating or upgrading it; null when it does not exist. */
function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let created = false
    const open = factory.open(name)
    open.onupgradeneeded = () => { created = true }
    open.onsuccess = () => {
      const db = open.result
      if (!created) { resolve(db); return }
      db.close()
      // Created only by this probe: remove the empty database again.
      try { factory.deleteDatabase(name) } catch { /* ignore */ }
      resolve(null)
    }
    open.onerror = () => reject(open.error ?? new Error(`Failed to open ${name}`))
  })
}
async function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  if (!db.objectStoreNames.contains(store)) return []
  return await request(db.transaction([store], 'readonly').objectStore(store).getAll()) as T[]
}

/** Scopes of the B2 partitions on this device, most recently used first. */
export function b2Scopes(storage: Storage): string[] {
  const scopes: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(B2_HEAD_PREFIX)) scopes.push(key.slice(B2_HEAD_PREFIX.length))
  }
  const used = (scope: string) => Number(storage.getItem('gtar_library_b2_last_used::' + scope) ?? 0)
  return scopes.sort((a, b) => used(b) - used(a) || a.localeCompare(b))
}

/** Full library of one B2 partition. Throws when it has unflushed journal entries or is inconsistent. */
export async function readB2Partition(factory: IDBFactory, storage: Storage, scope: string): Promise<SyncLibrary> {
  const wal = storage.getItem(B2_WAL_PREFIX + scope)
  if (wal !== null && wal !== '[]') throw new Error('B2 partition has saves that were never committed; export recovery data')
  const db = await openExisting(factory, B2_DB_PREFIX + scope)
  if (!db) throw new Error('B2 partition database missing')
  try {
    const [songs, bodies, setlists, meta] = await Promise.all([
      getAll<{ key: string; data: Record<string, unknown>; bodyAt: number; contentHash: string }>(db, 'songs'),
      getAll<{ hash: string; body: string }>(db, 'bodies'),
      getAll<{ key: string; data: SyncLibrary['setlists'][number] }>(db, 'setlists'),
      getAll<{ key: string; keys?: string[]; value?: Record<string, unknown> }>(db, 'meta'),
    ])
    const body = new Map(bodies.map(record => [record.hash, record.body]))
    const songByKey = new Map(songs.map(record => {
      const text = body.get(record.contentHash)
      if (text === undefined) throw new Error(`B2 chart body missing for song ${record.key}`)
      const out: Record<string, unknown> = {}
      const entries = Object.entries(record.data)
      const at = record.bodyAt < 0 || record.bodyAt > entries.length ? entries.length : record.bodyAt
      entries.forEach(([field, value], i) => { if (i === at) out.rawContent = text; out[field] = value })
      if (at === entries.length) out.rawContent = text
      return [record.key, out as unknown as Song]
    }))
    const listByKey = new Map(setlists.map(record => [record.key, record.data]))
    const metaByKey = new Map(meta.map(record => [record.key, record]))
    function order<T>(keys: string[] | undefined, map: Map<string, T>, label: string): T[] {
      if (!keys || keys.length !== map.size || !keys.every(key => map.has(key))) throw new Error(`B2 ${label} order does not match its records`)
      return keys.map(key => map.get(key)!)
    }
    return {
      ...(metaByKey.get('extra')?.value ?? {}),
      songs: order(metaByKey.get('songOrder')?.keys, songByKey, 'song'),
      setlists: order(metaByKey.get('setlistOrder')?.keys, listByKey, 'setlist'),
    } as SyncLibrary
  } finally { db.close() }
}

/** B1 index decoded with its chart bodies from IndexedDB. */
async function readB1(factory: IDBFactory, raw: string): Promise<SyncLibrary> {
  const index = JSON.parse(raw) as { format?: string; songs?: Array<Record<string, unknown>> } & Record<string, unknown>
  const { format: _format, ...rest } = index
  void _format
  const db = await openExisting(factory, BODY_DB_NAME)
  const bodies = new Map((db ? await getAll<{ hash: string; body: string }>(db, 'bodies') : []).map(record => [record.hash, record.body]))
  db?.close()
  const songs = (index.songs ?? []).map(song => {
    const { contentHash, pendingRawContent, ...fields } = song
    if (typeof pendingRawContent === 'string') return { ...fields, rawContent: pendingRawContent }
    const text = typeof contentHash === 'string' ? bodies.get(contentHash) : undefined
    if (text === undefined) throw new Error('B1 chart body missing')
    return { ...fields, rawContent: text }
  })
  return { ...rest, songs } as unknown as SyncLibrary
}

async function readRetiredV1(factory: IDBFactory): Promise<string | null> {
  const db = await openExisting(factory, ARCHIVE_DB_NAME)
  if (!db) return null
  try {
    if (!db.objectStoreNames.contains('archives')) return null
    const record = await request(db.transaction(['archives'], 'readonly').objectStore('archives').get(RETIRED_LIBRARY_KEY)) as { raw?: string } | undefined
    return typeof record?.raw === 'string' ? record.raw : null
  } finally { db.close() }
}

/** The library the earlier build showed on this device, or null when there is none. */
export async function readLegacyLibrary(storage: Storage, factory: IDBFactory | null): Promise<LibrarySource | null> {
  if (factory && storage.getItem(B2_FLAG_KEY) === '1') {
    const scope = b2Scopes(storage)[0]
    if (scope !== undefined) return { key: B2_DB_PREFIX + scope, library: await readB2Partition(factory, storage, scope) }
  }
  const index = storage.getItem(LIBRARY_V2_KEY)
  if (factory && storage.getItem(LIBRARY_B1_KEY) === '1' && index !== null) return { key: LIBRARY_V2_KEY, library: await readB1(factory, index) }
  const v1 = storage.getItem(LIBRARY_V1_KEY)
  if (v1 !== null) return { key: LIBRARY_V1_KEY, library: JSON.parse(v1) as SyncLibrary }
  const retired = factory ? await readRetiredV1(factory) : null
  if (retired !== null) return { key: RETIRED_LIBRARY_KEY, library: JSON.parse(retired) as SyncLibrary }
  return null
}

/** Recovery export: every B2 partition left on this device (a failing one is recorded, not fatal). */
export async function exportB2Partitions(storage: Storage, factory: IDBFactory | null): Promise<Record<string, string>> {
  const data: Record<string, string> = {}
  if (!factory) return data
  for (const scope of b2Scopes(storage)) {
    try { data[B2_DB_PREFIX + scope] = JSON.stringify(await readB2Partition(factory, storage, scope)) }
    catch (error) { data[`gtar_library_b2_error::${scope}`] = JSON.stringify({ scope, message: error instanceof Error ? error.message : String(error) }) }
  }
  return data
}
