import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { assertImportIds, canonicalImportId } from './importIdentity'
import { parseBackupJson, type BackupParseOptions, type ParsedBackupResult } from './jsonBackup'
import { generateUUID } from './uuid'

export type ImportPreview = ParsedBackupResult & { importAsNew?: boolean }

/** Preview uses temporary positional IDs only. Original JSON remains untouched. */
export function previewBackupImport(raw: string, options: BackupParseOptions = {}): ImportPreview {
  const strict = parseBackupJson(raw, options)
  if (strict.isValid) return strict
  try {
    const data = JSON.parse(raw)
    const single = data.exportType === 'SINGLE_SETLIST' || 'setlist' in data
    const songs = single ? data.setlist.songs : Array.isArray(data) ? data : data.songs ?? (data.title ? [data] : [])
    const lists = single ? [data.setlist] : data.setlists ?? []
    // Validate the unmodified format first; only absent IDs are compatible.
    if (!Array.isArray(songs) || !Array.isArray(lists)) return strict
    const records = [...songs, ...lists]
    if (!records.some(record => record && !('id' in record))) return strict
    const used = new Set(records.filter(record => record && 'id' in record).map(record => canonicalImportId(record.id)))
    let prefix = 'gtar-import-preview:'
    while ([...used].some(id => id.startsWith(prefix))) prefix += ':'
    records.forEach((record, index) => { if (record && !('id' in record)) record.id = `${prefix}${index}` })
    // Resolve legacy display references only inside this backup, never against
    // the device library. Ambiguous or dangling references still fail closed.
    const parsed = parseBackupJson(JSON.stringify(data))
    return parsed.isValid ? { ...parsed, importAsNew: true } : parsed
  } catch { return strict }
}

/** Explicit confirmation is required on every attempt, including retries. */
export function confirmImportAsNew(preview: ImportPreview, existing: { songs: ActiveSongState[]; setlists: WebSetlist[] }, confirm: (message: string) => boolean): ParsedBackupResult | null {
  if (!preview.isValid || !preview.importAsNew) throw new Error('A valid legacy import preview is required.')
  if (!confirm(`Import as New: ${preview.songs.length} songs and ${preview.setlists.length} setlists? All imported records receive fresh IDs. Unique title/artist references are bound only within this backup. Existing songs, setlists, trash and settings stay unchanged. Importing again creates another copy and requires confirmation.`)) return null
  assertImportIds(existing.songs, 'Existing songs')
  assertImportIds(existing.setlists, 'Existing setlists')
  const used = new Set([...existing.songs, ...existing.setlists, ...preview.songs, ...preview.setlists].map(record => canonicalImportId(record.id)))
  const fresh = () => {
    const id = generateUUID()
    if (used.has(canonicalImportId(id))) throw new Error('Generated canonical ID collision; import aborted. Retry explicitly.')
    used.add(id)
    return id
  }
  const ids = new Map(preview.songs.map(song => [canonicalImportId(song.id), fresh()]))
  const songs = preview.songs.map(song => ({ ...song, id: ids.get(canonicalImportId(song.id))! }))
  const setlists = preview.setlists.map(list => ({ ...list, id: fresh(), songs: list.songs.map(ref => {
    const id = ids.get(canonicalImportId(ref.id))
    if (!id) throw new Error('Unresolved legacy reference; import aborted.')
    return { ...ref, id }
  }) }))
  // Import as New is always additive and never restores device/account settings.
  return parseBackupJson(JSON.stringify({ songs, setlists }))
}
