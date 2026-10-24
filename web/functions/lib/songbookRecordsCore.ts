/**
 * RFC #188 S4: per-record songbook storage on D1 (migration 0009).
 *
 * - Each record has a revision (`rev`) used as compare-and-swap: a change based on a stale
 *   revision is rejected and returned as a conflict with the current server copy. No
 *   last-write-wins and no automatic merging; identical content is accepted as-is.
 * - Each write takes the next per-user sequence number (`seq`) in the same transaction, so a
 *   pull with `since = <last seq seen>` never skips a write.
 * - The first access seeds the records from the user's whole-document songbook (0002), and every
 *   push mirrors the records back into it, so turning the feature off loses nothing.
 */
import { computeSongbookChecksum } from '../../src/utils/cloudSongbookSync.ts'
import {
  MAX_PULL_RECORDS,
  libraryToRecords,
  recordChecksum,
  recordKey,
  recordsToLibrary,
  type PushAccepted,
  type PushConflict,
  type PushResponse,
  type PullResponse,
  type RecordChange,
  type RecordKind,
  type ServerRecord,
} from '../../src/utils/songbookRecords.ts'
import type { SyncLibrary } from '../../src/utils/syncMerge.ts'
import { findUserSongbook, type D1Database, type D1PreparedStatement } from './authCore.ts'

export const MIRROR_MAX_BYTES = 2 * 1024 * 1024
/** D1 allows 100 bound parameters per statement. */
const KEY_CHUNK = 90
/** Pull pages stop growing past this many bytes of record data. */
const PULL_PAGE_BYTES = 1536 * 1024

interface RecordRow { kind: RecordKind; record_id: string; rev: number; seq: number; removed: number; data_json: string | null; checksum: string }

/** D1 batch: one transaction. Required for the sequence and the write to land together. */
function runBatch(db: D1Database, statements: D1PreparedStatement[]) {
  if (!db.batch) throw new Error('D1 batch unavailable')
  return db.batch(statements)
}

const toServerRecord = (row: RecordRow): ServerRecord => ({
  kind: row.kind, id: row.record_id, rev: row.rev, seq: row.seq, removed: row.removed === 1, checksum: row.checksum,
  data: row.removed === 1 || row.data_json === null ? null : JSON.parse(row.data_json),
})

async function headSeq(db: D1Database, userId: string): Promise<number | null> {
  const row = await db.prepare('SELECT seq FROM user_songbook_cursors WHERE user_id = ?').bind(userId).first<{ seq: number }>()
  return row ? row.seq : null
}

/**
 * #208 F2: once a user has per-record records, they are the source of truth. Classic whole-document
 * writes are then refused (409) so the two never diverge. No 0009 tables (PROD today) = false.
 */
export async function recordsActiveForUser(db: D1Database, userId: string): Promise<boolean> {
  try { return (await headSeq(db, userId)) !== null } catch (err) {
    if (err instanceof Error && /no such table: user_songbook_cursors/.test(err.message)) return false
    throw err
  }
}

/**
 * Creates the user's cursor and, when a whole-document songbook exists, its records (rev 1).
 * Concurrent first calls are safe: only the call whose token claimed the cursor inserts records.
 */
export async function ensureRecordsSeeded(db: D1Database, userId: string, now: string): Promise<number> {
  const existing = await headSeq(db, userId)
  if (existing !== null) return existing
  let records: ReturnType<typeof libraryToRecords> = []
  const legacy = await findUserSongbook(db, userId)
  if (legacy) {
    try { records = libraryToRecords(JSON.parse(legacy.data_json) as SyncLibrary) } catch { records = [] }
  }
  const token = `${now}#${crypto.randomUUID()}`
  // Two statements whatever the library size (D1 counts statements per invocation): the cursor,
  // then every record from one JSON array. Only the call whose token claimed the cursor inserts.
  const rows = records.map((record, index) => ({ k: record.kind, i: record.id, s: index + 1,
    d: JSON.stringify(record.data), c: recordChecksum(false, record.data) }))
  const statements = [
    db.prepare(`INSERT INTO user_songbook_cursors (user_id, seq, seeded_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO NOTHING`).bind(userId, records.length, token),
    db.prepare(`INSERT INTO user_songbook_records (user_id, kind, record_id, rev, seq, removed, data_json, checksum, updated_at)
      SELECT ?, json_extract(value, '$.k'), json_extract(value, '$.i'), 1, json_extract(value, '$.s'), 0,
        json_extract(value, '$.d'), json_extract(value, '$.c'), ?
      FROM json_each(?) WHERE (SELECT seeded_at FROM user_songbook_cursors WHERE user_id = ?) = ?
      ON CONFLICT(user_id, kind, record_id) DO NOTHING`).bind(userId, now, JSON.stringify(rows), userId, token),
  ]
  await runBatch(db, statements)
  return (await headSeq(db, userId)) ?? 0
}

export async function pullRecords(db: D1Database, userId: string, since: number, limit: number, now: string): Promise<PullResponse> {
  const head = await ensureRecordsSeeded(db, userId, now)
  const pageLimit = Math.max(1, Math.min(limit, MAX_PULL_RECORDS))
  const { results } = await db.prepare(`SELECT kind, record_id, rev, seq, removed, data_json, checksum FROM user_songbook_records
    WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`).bind(userId, since, pageLimit).all<RecordRow>()
  const records: ServerRecord[] = []
  let bytes = 0
  for (const row of results ?? []) {
    const size = row.data_json?.length ?? 0
    if (records.length && bytes + size > PULL_PAGE_BYTES) break
    bytes += size
    records.push(toServerRecord(row))
  }
  const cursor = records.length ? records[records.length - 1].seq : since
  return { records, cursor, head, more: records.length > 0 && cursor < head }
}

async function readRows(db: D1Database, userId: string, keys: string[]): Promise<Map<string, RecordRow>> {
  const rows = new Map<string, RecordRow>()
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    const chunk = keys.slice(i, i + KEY_CHUNK)
    const { results } = await db.prepare(`SELECT kind, record_id, rev, seq, removed, data_json, checksum FROM user_songbook_records
      WHERE user_id = ? AND (kind || ':' || record_id) IN (${chunk.map(() => '?').join(',')})`).bind(userId, ...chunk).all<RecordRow>()
    for (const row of results ?? []) rows.set(recordKey(row.kind, row.record_id), row)
  }
  return rows
}

/**
 * Applies validated changes. Each change is accepted only if its `baseRev` equals the stored
 * revision (0 = not stored), or if it carries exactly the stored content. Everything else is a
 * conflict and is left untouched.
 */
export async function pushRecords(db: D1Database, userId: string, changes: RecordChange[], now: string): Promise<PushResponse> {
  await ensureRecordsSeeded(db, userId, now)
  const keys = changes.map(change => recordKey(change.kind, change.id))
  const before = await readRows(db, userId, keys)

  const accepted: PushAccepted[] = []
  const conflicts: PushConflict[] = []
  const writes: Array<{ change: RecordChange; checksum: string; index: number }> = []
  const planned: Array<{ change: RecordChange; checksum: string; removed: boolean; json: string | null }> = []
  const statements: D1PreparedStatement[] = []

  for (const change of changes) {
    const removed = change.removed === true
    const checksum = recordChecksum(removed, change.data)
    const current = before.get(recordKey(change.kind, change.id))
    if (current && current.checksum === checksum && (current.removed === 1) === removed) {
      // Same content already stored: nothing to write, whatever revision the client started from.
      accepted.push({ kind: change.kind, id: change.id, rev: current.rev, seq: current.seq, checksum })
      continue
    }
    if ((current?.rev ?? 0) !== change.baseRev) {
      conflicts.push({ kind: change.kind, id: change.id, current: current ? toServerRecord(current) : null })
      continue
    }
    const json = removed ? null : JSON.stringify(change.data)
    planned.push({ change, checksum, removed, json })
  }

  // One batch (one transaction): reserve a block of sequence numbers, then one conditional write
  // per change at its own number. A write that loses its revision check leaves a gap, never a skip.
  if (planned.length) {
    statements.push(db.prepare('UPDATE user_songbook_cursors SET seq = seq + ? WHERE user_id = ?').bind(planned.length, userId))
    // #208 F4: the block's top, read inside the same transaction, so acknowledgements describe this write only.
    statements.push(db.prepare('SELECT seq FROM user_songbook_cursors WHERE user_id = ?').bind(userId))
  }
  planned.forEach(({ change, checksum, removed, json }, position) => {
    const back = planned.length - 1 - position
    statements.push(change.baseRev === 0
      ? db.prepare(`INSERT INTO user_songbook_records (user_id, kind, record_id, rev, seq, removed, data_json, checksum, updated_at)
          SELECT ?, ?, ?, 1, (SELECT seq FROM user_songbook_cursors WHERE user_id = ?) - ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM user_songbook_records WHERE user_id = ? AND kind = ? AND record_id = ?)`)
        .bind(userId, change.kind, change.id, userId, back, removed ? 1 : 0, json, checksum, now, userId, change.kind, change.id)
      : db.prepare(`UPDATE user_songbook_records SET rev = rev + 1, seq = (SELECT seq FROM user_songbook_cursors WHERE user_id = ?) - ?,
          removed = ?, data_json = ?, checksum = ?, updated_at = ?
          WHERE user_id = ? AND kind = ? AND record_id = ? AND rev = ?`)
        .bind(userId, back, removed ? 1 : 0, json, checksum, now, userId, change.kind, change.id, change.baseRev))
    writes.push({ change, checksum, index: statements.length - 1 })
  })

  if (statements.length) {
    const results = await runBatch(db, statements)
    const changed = (index: number) => Number((results[index]?.meta as { changes?: number } | undefined)?.changes ?? 0) > 0
    const lostRace = writes.filter(write => !changed(write.index))
    const won = writes.filter(write => changed(write.index))
    // #208 F4: a won write is exactly (baseRev + 1, its own checksum, its reserved seq). Reading the
    // rows again after the batch could report a later writer's revision and checksum instead.
    const top = Number((results[1]?.results as Array<{ seq: number }> | undefined)?.[0]?.seq)
    for (const write of won) {
      const position = planned.findIndex(item => item.change === write.change)
      accepted.push({ kind: write.change.kind, id: write.change.id, rev: write.change.baseRev + 1,
        seq: top - (planned.length - 1 - position), checksum: write.checksum })
    }
    const after = lostRace.length ? await readRows(db, userId, lostRace.map(write => recordKey(write.change.kind, write.change.id))) : new Map<string, RecordRow>()
    // Another request changed the record between the read and the write.
    for (const write of lostRace) {
      const row = after.get(recordKey(write.change.kind, write.change.id))
      conflicts.push({ kind: write.change.kind, id: write.change.id, current: row ? toServerRecord(row) : null })
    }
  }

  const head = (await headSeq(db, userId)) ?? 0
  const mirror = statements.length ? await mirrorToSongbook(db, userId, now) : 'unchanged'
  return { accepted, conflicts, head, mirror }
}

/**
 * Rebuilds the whole-document songbook (0002) from the records, for rollback and older clients.
 * #208 F3: the records and their head are read in one transaction, and the document is written
 * only while that head is still current. A slower mirror from an older push is then skipped
 * ('superseded') instead of republishing stale content over a newer mirror.
 */
export async function mirrorToSongbook(db: D1Database, userId: string, now: string): Promise<PushResponse['mirror']> {
  try {
    const [rows, cursor] = await runBatch(db, [
      db.prepare(`SELECT kind, record_id, rev, seq, removed, data_json, checksum FROM user_songbook_records
        WHERE user_id = ? AND removed = 0 ORDER BY rowid`).bind(userId),
      db.prepare('SELECT seq FROM user_songbook_cursors WHERE user_id = ?').bind(userId),
    ])
    const head = Number((cursor?.results as Array<{ seq: number }> | undefined)?.[0]?.seq)
    if (!Number.isFinite(head)) return 'failed'
    const library = recordsToLibrary(((rows?.results ?? []) as RecordRow[]).map(toServerRecord))
    const json = JSON.stringify(library)
    if (new TextEncoder().encode(json).byteLength > MIRROR_MAX_BYTES) return 'skipped-size'
    const checksum = computeSongbookChecksum(library)
    const stillCurrent = '(SELECT seq FROM user_songbook_cursors WHERE user_id = ?) = ?'
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await findUserSongbook(db, userId)
      if (current?.checksum === checksum) return 'unchanged'
      const written = current
        ? await db.prepare(`UPDATE user_songbooks SET version = version + 1, data_json = ?, checksum = ?, updated_at = ?
            WHERE user_id = ? AND version = ? AND checksum = ? AND version < 9007199254740991 AND ${stillCurrent}
            RETURNING version`).bind(json, checksum, now, userId, current.version, current.checksum, userId, head).first<{ version: number }>()
        : await db.prepare(`INSERT INTO user_songbooks (user_id, version, data_json, checksum, updated_at)
            SELECT ?, 1, ?, ?, ? WHERE ${stillCurrent}
            ON CONFLICT(user_id) DO NOTHING RETURNING version`).bind(userId, json, checksum, now, userId, head).first<{ version: number }>()
      if (written) return 'updated'
      const latest = await headSeq(db, userId)
      if (latest !== head) return 'superseded'
    }
    return 'skipped-conflict'
  } catch {
    return 'failed'
  }
}
