// #253 B1: fail-closed schema capability detection for the shared catalog.
// Each protection trigger (and the one-open-report index) must match a reviewed migration definition.
// Comparison is formatting-insensitive (case, whitespace, comments outside string literals), so an
// equivalently formatted schema still works, while an unknown, missing or weakened definition fails
// closed: no capability is advertised and no mutation is accepted.
import type { D1Database } from './authCore.ts'

export type SetlistSchemaMode = 'legacy' | 'v2'
export interface CatalogSchema { setlists: SetlistSchemaMode | null; reports: boolean }

/** Canonical text: comments removed, whitespace collapsed, case folded outside '...' literals. */
export function normalizeSchemaSql(sql: string): string {
  let out = ''
  for (let i = 0; i < sql.length;) {
    const ch = sql[i]
    if (ch === "'") {
      let j = i + 1
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1
      out += sql.slice(i, j + 1); i = j + 1; continue
    }
    if (ch === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; out += ' '; continue }
    if (ch === '/' && sql[i + 1] === '*') { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2; out += ' '; continue }
    out += /\s/.test(ch) ? ' ' : ch.toLowerCase(); i++
  }
  // Collapse whitespace and drop it around punctuation (only outside literals, which contain no bare spaces now... except their own).
  const parts = out.split(/('(?:[^']|'')*')/)
  return parts.map((part, index) => index % 2 ? part : part.replace(/\s+/g, ' ').replace(/\s*([(),;=<>+*/|])\s*/g, '$1'))
    .join('').trim().replace(/;$/, '')
}

const memo = new Map<string, string>()
export async function schemaFingerprint(sql: string): Promise<string> {
  const known = memo.get(sql)
  if (known) return known
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeSchemaSql(sql))))
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  if (memo.size < 256) memo.set(sql, hex)
  return hex
}

/** Reviewed definitions (normalized SHA-256). Verified against the migrations by tests/catalogSchema.test.cjs. */
export const KNOWN_DEFINITIONS: Record<string, Record<string, string>> = {
  catalog_setlist_guard: { '0007': '000197621834d63958806a94330a1dbc24fa8f183a95292be5101d078b815842', '0008': '837547a49eb50b91a66317c319adefe85342f27c42fdae3a5b4a1c0217ee4a6f' },
  catalog_setlist_apply: { '0007': '1500274a51c5ced3ad47efe7f3160e0643429fc66cd5b273543ad7fdc2f5b29a', '0010': '3da08fd5cc4521e89259dc7d7d6a77f3c868e674726811bb80fb04444ee79c01' },
  catalog_setlist_mutation_no_update: { '0007': '67652a1ddc297fdda8c6333bdfeae4badb833d4d63d451fd7f8402a1bb45b2b2' },
  catalog_setlist_mutation_no_delete: { '0007': '62c6e9a38b1bbf42e2655aef8b6bac791a567b3a14cef6e39abb4f8ecf83629e' },
  catalog_setlist_revision_no_update: { '0007': '5d886b4340051a1df7f7608bf9efc589c7fb086ea4d6da82507a0ea72d68f23e' },
  catalog_setlist_revision_no_delete: { '0007': '9611dd74753eeeeb57650ae2b4fe2a4e96853a3139d5013bbda194806d73e0b9' },
  catalog_setlist_head_no_delete: { '0007': '4a35cafafe1f7a7907e2f8e4708dc520afb6f043a46be01602c888167263526d' },
  catalog_setlist_head_guard: { '0007': '120e85496ee965f37928cfd302debb68d29b9695e6ea9b53f4d7218ed1beb35c' },
  catalog_reports_one_open: { '0010': '4fa2d87952a438b0370684fac87f5047e9fdc4b7aec9fbde781fb097fa787222' },
  catalog_report_guard: { '0010': '008054986c18e385afa088e8b07789b0e6e77fb41572f9851191a3f66e4161c0' },
  catalog_moderation_guard: { '0010': 'ee12108ae4d5ecd5a971eea9e22b19b0145381062a5214cd07eb69067e8d5f17' },
  catalog_moderation_apply: { '0010': 'fda68cd507b45657221e85d2c3a28dda2b77e3f26fce21b2f8c332dc3bc258d0' },
  catalog_moderation_no_update: { '0010': '03655609078a5f1a6781ef7ec91a360153bed50723e0055624fb3a8c192a4242' },
  catalog_moderation_no_delete: { '0010': '00c32ec4fbeab2ce42e35352fbbacdde6d4be8427f569e26e8a3aa7bf24ccd91' },
  catalog_report_resolve: { '0010': '64a706746a20cbeb69eb0c9dcd30841b2c03b3245b388308b409139fd1b9ec7a' },
  catalog_report_no_delete: { '0010': 'ded1e0870105f631ff0475f1e1f5c72bd7b4f603a2c8524dec09839ee9c785bb' },
}

const SETLIST_TABLES = ['catalog_setlist_heads', 'catalog_setlist_mutations', 'catalog_setlist_revisions']
const SETLIST_TRIGGERS = ['catalog_setlist_guard', 'catalog_setlist_apply', 'catalog_setlist_mutation_no_update',
  'catalog_setlist_mutation_no_delete', 'catalog_setlist_revision_no_update', 'catalog_setlist_revision_no_delete',
  'catalog_setlist_head_no_delete', 'catalog_setlist_head_guard']
const REPORT_TABLES = ['catalog_reports', 'catalog_moderation_actions', 'shared_catalog_songs']
const REPORT_OBJECTS = ['catalog_report_guard', 'catalog_report_resolve', 'catalog_report_no_delete', 'catalog_moderation_guard',
  'catalog_moderation_apply', 'catalog_moderation_no_update', 'catalog_moderation_no_delete', 'catalog_reports_one_open']

async function probe(db: D1Database, sql: string) {
  try { return (await db.prepare(sql).all()).success === true } catch { return false }
}

/** Which definition variant each object matches, or null when any object on the tables is unknown. */
async function variants(rows: { name: string; sql: string | null }[], required: string[]) {
  const found: Record<string, string> = {}
  for (const row of rows) {
    const allowed = KNOWN_DEFINITIONS[row.name]
    if (!allowed || !row.sql) return null
    const fingerprint = await schemaFingerprint(row.sql)
    const variant = Object.keys(allowed).find(key => allowed[key] === fingerprint)
    if (!variant || found[row.name]) return null
    found[row.name] = variant
  }
  return required.every(name => found[name]) ? found : null
}

export async function inspectCatalogSchema(db: D1Database): Promise<CatalogSchema> {
  // SQLite identifiers are case-insensitive; sqlite_master keeps them as written.
  const list = (tables: string[]) => db.prepare(`SELECT lower(name) AS name, sql FROM sqlite_master WHERE (type = 'trigger' AND lower(tbl_name) IN
    (${tables.map(() => '?').join(',')})) OR (type = 'index' AND lower(name) = 'catalog_reports_one_open')`)
    .bind(...tables).all<{ name: string; sql: string | null }>()
  const setlistRows = await list(SETLIST_TABLES)
  if (!setlistRows.success) return { setlists: null, reports: false }
  const setlist = await variants(setlistRows.results.filter(r => r.name !== 'catalog_reports_one_open'), SETLIST_TRIGGERS)
  let setlists: SetlistSchemaMode | null = null
  if (setlist?.catalog_setlist_apply === '0007') setlists = 'legacy'
  else if (setlist?.catalog_setlist_apply === '0010' &&
    await probe(db, 'SELECT source_kind FROM catalog_setlist_mutations WHERE 0')) setlists = 'v2'
  if (setlists !== 'v2') return { setlists, reports: false }
  const reportRows = await list(REPORT_TABLES)
  const reports = reportRows.success && !!await variants(reportRows.results, REPORT_OBJECTS) &&
    await probe(db, `SELECT id,target_kind,target_id,target_revision,reporter_user_id,reason,note,status,resolver_user_id,
      resolution_note,created_at,resolved_at FROM catalog_reports WHERE 0`) &&
    await probe(db, `SELECT id,report_id,admin_user_id,idempotency_key,request_digest,action,target_kind,target_id,
      expected_revision,note,created_at FROM catalog_moderation_actions WHERE 0`)
  return { setlists, reports }
}
