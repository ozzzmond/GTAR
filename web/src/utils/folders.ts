import type { SetlistFolder, WebSetlist } from '../types/gtar'

/** Ported from GTAR1, with missing-parent and malformed-cycle protection. */
export function validateFolderParentChange(folders: SetlistFolder[], folderId: string, parentId: string | null): boolean {
  const byId = new Map(folders.map(folder => [folder.id, folder]))
  const visited = new Set<string>([folderId])
  while (parentId) {
    if (visited.has(parentId) || !byId.has(parentId)) return false
    visited.add(parentId)
    parentId = byId.get(parentId)!.parentId ?? null
  }
  return true
}
export interface FolderTreeNode { folder: SetlistFolder; children: FolderTreeNode[] }
export function buildFolderTree(folders: SetlistFolder[]): FolderTreeNode[] {
  const nodes = new Map(folders.map(folder => [folder.id, { folder, children: [] } as FolderTreeNode]))
  const roots: FolderTreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.folder.parentId
    if (parent && validateFolderParentChange(folders, node.folder.id, parent)) nodes.get(parent)!.children.push(node)
    else roots.push(node)
  }
  return roots
}
export function getFolderDescendantIds(folders: SetlistFolder[], folderId: string): Set<string> {
  const found = new Set<string>()
  const queue = [folderId]
  for (let i = 0; i < queue.length; i++) for (const folder of folders) {
    if (folder.parentId === queue[i] && folder.id !== folderId && !found.has(folder.id)) { found.add(folder.id); queue.push(folder.id) }
  }
  return found
}
/** Delete only this folder; retain every setlist and lift children to its parent. */
export function deleteSetlistFolder(folders: SetlistFolder[], setlists: WebSetlist[], id: string) {
  const parent = folders.find(folder => folder.id === id)?.parentId ?? null
  return {
    folders: folders.filter(folder => folder.id !== id).map(folder => folder.parentId === id ? { ...folder, parentId: parent } : folder),
    setlists: setlists.map(list => list.folderId === id ? { ...list, folderId: null } : list),
  }
}
