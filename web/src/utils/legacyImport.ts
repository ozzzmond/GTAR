import type { ActiveSongState, WebSetlist, SetlistFolder } from '../types/gtar'
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
    // the device library. Unmatched references remain broken shortcuts after the upgrade.
    const parsed = parseBackupJson(JSON.stringify(data))
    return parsed.isValid ? { ...parsed, importAsNew: true } : parsed
  } catch { return strict }
}

/** Explicit confirmation is required on every attempt, including retries. */
export function confirmImportAsNew(preview: ImportPreview, existing: { songs: ActiveSongState[]; setlists: WebSetlist[]; folders?: SetlistFolder[]; tagColors?: import('./songTags').TagColors }, confirm: (message: string) => boolean): ParsedBackupResult | null {
  if (!preview.isValid || !preview.importAsNew) throw new Error('A valid legacy import preview is required.')
  if (!confirm(`Import as New: ${preview.songs.length} songs and ${preview.setlists.length} setlists? All imported records receive fresh IDs. Title/artist references are bound only within this backup; missing songs stay as broken shortcuts. Existing songs, setlists, trash and settings stay unchanged. Importing again creates another copy and requires confirmation.`)) return null
  assertImportIds(existing.songs, 'Existing songs')
  assertImportIds(existing.setlists, 'Existing setlists')
  const used = new Set([...existing.songs, ...existing.setlists, ...(existing.folders ?? []), ...preview.songs, ...preview.setlists, ...(preview.folders ?? [])].map(record => canonicalImportId(record.id)))
  const fresh = () => {
    const id = generateUUID()
    if (used.has(canonicalImportId(id))) throw new Error('Generated canonical ID collision; import aborted. Retry explicitly.')
    used.add(id)
    return id
  }
  const ids = new Map(preview.songs.map(song => [canonicalImportId(song.id), fresh()]))
  const songs = preview.songs.map(song => ({ ...song, id: ids.get(canonicalImportId(song.id))! }))
  const folderIds = new Map((preview.folders ?? []).map(folder => [folder.id, fresh()]))
  const folders = preview.folders?.map(folder => ({ ...folder, id: folderIds.get(folder.id)!, parentId: folder.parentId ? folderIds.get(folder.parentId) ?? null : null }))
  const setlists = preview.setlists.map(list => ({ ...list, id: fresh(), ...(list.folderId ? { folderId: folderIds.get(list.folderId) ?? null } : {}), songs: list.songs.map((ref, position) => {
    const id = ids.get(canonicalImportId(ref.id)) ?? fresh()
    return { ...ref, id, entryId: fresh(), position }
  }) }))
  // Import as New is always additive and never restores device/account settings.
  return parseBackupJson(JSON.stringify({ songs, setlists, ...(preview.tagColors !== undefined ? { tagColors: preview.tagColors } : {}), ...(folders ? { folders } : {}) }))
}
