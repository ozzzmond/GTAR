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
  // Qualified names: `NEW . col` and `NEW /* x */ . col` are the same tokens as `NEW.col`. Only joins an
  // identifier (or quoted name) to an identifier start, so numeric literals such as `1 .5` are never merged.
  return parts.map((part, index) => index % 2 ? part : part.replace(/\s+/g, ' ').replace(/\s*([(),;=<>+*/|])\s*/g, '$1')
    .replace(/([A-Za-z0-9_"`\]]) ?\. ?(?=[A-Za-z_"`[])/g, '$1.'))
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

/**
 * Reviewed CREATE TABLE / CREATE INDEX text of every table Catalog V2 depends on, as it exists after
 * 0001..0010 (ALTER TABLE ADD COLUMN rewrites the stored table text). A weakened CHECK, renamed or
 * missing column, missing prerequisite migration (0008 guard, 0009 tables) or unknown extra index fails.
 * Verified against the migrations by tests/sharedCatalogV2Remediation.test.cjs.
 */
export const KNOWN_V2_TABLES: Record<string, string> = {
  catalog_moderation_actions: '440a997a58c97670dc313b22661229514c1e23c76b8b6a1c4209af21e81c0c1e',
  catalog_reports: '093e4f540636499185db0aefdb7b4f931bf8971f0019d40adb7c423a21dcabd5',
  catalog_setlist_heads: '33243530d99b079ac5ff99f3a1283c067035c3a0e2c28923a218e0fa429a1f06',
  catalog_setlist_mutations: '5a40f27962f166d5821ec93b9478ccfed0bbcf97fa8538ebf431774138cc9569',
  catalog_setlist_rates: '9665345a94bd37b133599aa8483d4faa903f2939c4b1c7b5076cf0ab477a7f27',
  catalog_setlist_revisions: '8364d59ffb7d227a8d9a572ed4ea2fe540ca7e87b36d58fbfdc4694c5218573f',
  shared_catalog_revisions: '0db0f10d92235d7695e0485420ef342f1e19f5bea9c1f4874c1c1137381ec144',
  shared_catalog_songs: 'dee1a84315926ad0688005d64cad4a372ffac422752a861d04990f8023338dd6',
  user_songbook_cursors: '0cb33265d2dc19ab4a0f62f6f726f3713af74523fa26e33d068f87a7a575a4ec',
  user_songbook_records: '2ed5683139ece44b8920da12affd220277546f21978731b045da1ba5ddf43091',
  users: '951e3c0cbe02a303d2e7622784f2c10f59538beb13b9f0400f2821cacd344b7e',
  catalog_moderation_actions_report: '04fabde9b19f2a497d68fdfe0c6c2b6bb17fdf2463f4b8183bf907fef68a4e0d',
  catalog_reports_one_open: '4fa2d87952a438b0370684fac87f5047e9fdc4b7aec9fbde781fb097fa787222',
  catalog_reports_queue: 'ce33a2b198784c10af05afe20388eac3e39f64557de7b6fdcac90d2cf3684e47',
  catalog_reports_reporter: '9ffb9d5403d869ff0db36dbb95a9fec0e4224d99d92215b13624dd5cfa27b1d1',
  catalog_reports_target: '259db459eb9f7d3d69a4da4a41f4c57d3d368c7591e814c937dba53f06ac5cd8',
  catalog_setlist_mutations_owner: '6ced7aed32a6bf2f449ad3d9c3051d3e8cab5248ec82bbb4a2b26782fa51227f',
  idx_shared_catalog_revisions_editor: '474acad94514a593b7260f757a435b1aa67ec8ee6302000eb4387dad47e44835',
  idx_shared_catalog_revisions_song_id: '2da25cfe1877dd73eac63e91dec21941cb9a45b0c71c65059c8f2a9ffa0d328e',
  idx_shared_catalog_songs_is_deleted: 'a36736bd881315838d1f6a9cb354734fcf20fab933651d4ed578edcb5bb4fc8f',
  idx_shared_catalog_songs_last_editor: '19140c76586e185531ab642175357099fc00de4f93d176598d8355036d09a05b',
  idx_shared_catalog_songs_publisher: '8c32f60ccb5025811d6271c2323179b7d37c46cbd2a4c34ca248778f21767ef1',
  idx_shared_catalog_songs_updated_at: 'a5332cf1987c10f1ec179ed1311b63d637541e4d6124628395f101a2c78fa5f6',
  idx_user_songbook_records_seq: 'b2a2ca8df54d80508508fbc5572ecf59fea7aa832c22ba25b754185af66f347a',
  idx_users_access_status: '8bec75e744e8e638160b367eec8370023470bd77deb5e1099c1abe4b8dd25d0a',
  idx_users_email: 'ce2b616650c288041b2f031f7016bc4281622ea3cc2dd5acfdda75a7854f84b9',
  idx_users_google_sub: '98dc802ad454bbde28eb01042d1c301c493f6a757bf50459c87ff5c7f88e1d1d',
}
const V2_TABLES = ['users', 'catalog_setlist_heads', 'catalog_setlist_mutations', 'catalog_setlist_revisions', 'catalog_setlist_rates',
  'catalog_reports', 'catalog_moderation_actions', 'shared_catalog_songs', 'shared_catalog_revisions',
  'user_songbook_records', 'user_songbook_cursors']

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

/** Tables Catalog V2 only reads from; their own extra indexes cannot weaken catalog protections. */
const PREREQUISITE_TABLES = new Set(['users', 'user_songbook_records', 'user_songbook_cursors'])

/** Every reviewed table/index present and identical; no unknown index on a catalog table. Auto-indexes
 * (no SQL) are implied by the table text. */
async function v2TablesVerified(db: D1Database) {
  const rows = await db.prepare(`SELECT lower(type) AS type, lower(name) AS name, lower(tbl_name) AS tbl, sql FROM sqlite_master
    WHERE type IN ('table', 'index') AND lower(tbl_name) IN (${V2_TABLES.map(() => '?').join(',')}) AND sql IS NOT NULL`)
    .bind(...V2_TABLES).all<{ type: string; name: string; tbl: string; sql: string }>()
  if (!rows.success) return false
  const seen = new Set<string>()
  for (const row of rows.results) {
    const expected = KNOWN_V2_TABLES[row.name]
    if (!expected && row.type === 'index' && PREREQUISITE_TABLES.has(row.tbl)) continue
    if (!expected || seen.has(row.name) || expected !== await schemaFingerprint(row.sql)) return false
    seen.add(row.name)
  }
  return Object.keys(KNOWN_V2_TABLES).every(name => seen.has(name))
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
  // V2 needs the 0008 member guard (0007's admin-only guard is not a reviewed V2 state), the exact
  // post-0010 table/index definitions and the columns the server writes.
  else if (setlist?.catalog_setlist_apply === '0010' && setlist.catalog_setlist_guard === '0008' &&
    await v2TablesVerified(db) &&
    await probe(db, `SELECT editor_user_id,idempotency_key,request_digest,operation,setlist_id,publication_key,expected_revision,
      source_version,source_checksum,snapshot_json,snapshot_bytes,created_at,source_kind FROM catalog_setlist_mutations WHERE 0`)) setlists = 'v2'
  if (setlists !== 'v2') return { setlists, reports: false }
  const reportRows = await list(REPORT_TABLES)
  const reports = reportRows.success && !!await variants(reportRows.results, REPORT_OBJECTS) &&
    await probe(db, `SELECT id,target_kind,target_id,target_revision,reporter_user_id,reason,note,status,resolver_user_id,
      resolution_note,created_at,resolved_at FROM catalog_reports WHERE 0`) &&
    await probe(db, `SELECT id,report_id,admin_user_id,idempotency_key,request_digest,action,target_kind,target_id,
      expected_revision,note,created_at FROM catalog_moderation_actions WHERE 0`)
  return { setlists, reports }
}
