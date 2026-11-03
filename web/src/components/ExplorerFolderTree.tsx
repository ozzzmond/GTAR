import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderPlus, MoreHorizontal } from 'lucide-react'
import type { SetlistFolder, WebSetlist } from '../types/gtar'
import { buildFolderTree, validateFolderParentChange, type FolderTreeNode } from '../utils/folders'
import { generateUUID } from '../utils/uuid'

interface Props {
  folders: SetlistFolder[]
  setlists: WebSetlist[]
  selectedId?: string
  onSelect: (id: string) => void
  onSave?: (folder: SetlistFolder) => boolean
  onDelete?: (id: string) => boolean
}
const button = 'min-h-11 min-w-11 rounded-lg text-app-muted hover:bg-app-surface hover:text-app-heading flex items-center justify-center'
const field = 'min-h-11 w-full min-w-0 rounded-lg border border-app-border bg-app-base px-2 text-app-text'
/** Folder actions share the Explorer's existing compact navigation surface. */
export function ExplorerFolderTree({ folders, setlists, selectedId, onSelect, onSave, onDelete }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<SetlistFolder | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const edit = (folder: SetlistFolder) => { setEditing(folder); setConfirmDelete(false); setError('') }
  const create = (parentId: string | null) => edit({ id: generateUUID(), name: '', parentId, createdAt: Date.now() })
  const renderNode = ({ folder, children }: FolderTreeNode): React.ReactNode => <div key={folder.id}>
    <div className="flex min-w-0 items-center">
      <button type="button" aria-label={`${collapsed.has(folder.id) ? 'Expand' : 'Collapse'} ${folder.name}`} aria-expanded={!collapsed.has(folder.id)}
        className={button} onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next })}>
        {collapsed.has(folder.id) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      <button type="button" aria-current={selectedId === folder.id ? 'page' : undefined} onClick={() => onSelect(folder.id)}
        className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left ${selectedId === folder.id ? 'bg-app-action text-app-on-action' : 'text-app-text hover:bg-app-surface'}`}>
        <Folder className="h-4 w-4 shrink-0" /><span className="truncate">{folder.name}</span>
        <span className="ml-auto">{setlists.filter(list => !list.isDeleted && list.folderId === folder.id).length}</span>
      </button>
      {onSave && <button type="button" className={button} aria-label={`Folder actions for ${folder.name}`} onClick={() => edit(folder)}><MoreHorizontal className="h-4 w-4" /></button>}
    </div>
    {!collapsed.has(folder.id) && children.length > 0 && <div className="ml-3 border-l border-app-border pl-1">{children.map(renderNode)}</div>}
  </div>
  return <div data-testid="explorer-folder-tree">
    {onSave && <button type="button" className={`${button} w-full justify-start gap-2 px-2.5 text-xs`} onClick={() => create(null)}><FolderPlus className="h-4 w-4" />New Folder</button>}
    {buildFolderTree(folders).map(renderNode)}
    {editing && <form aria-label="Folder editor" className="space-y-2 rounded-lg border border-app-border bg-app-surface p-2" onSubmit={event => {
      event.preventDefault()
      if (!editing.name.trim()) { setError('Enter a folder name.'); return }
      if (!validateFolderParentChange(folders, editing.id, editing.parentId)) { setError('Choose a parent outside this folder.'); return }
      if (onSave?.({ ...editing, name: editing.name.trim(), updatedAt: Date.now() })) setEditing(null)
      else setError('Not saved. Resolve the storage conflict and retry.')
    }}>
      <label className="block">Folder name<input autoFocus aria-label="Folder name" className={field} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label className="block">Parent folder<select aria-label="Parent folder" className={field} value={editing.parentId ?? ''} onChange={e => setEditing({ ...editing, parentId: e.target.value || null })}>
        <option value="">Root</option>{folders.filter(folder => validateFolderParentChange(folders, editing.id, folder.id)).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-1"><button type="submit" className={`${button} px-2`}>Save</button><button type="button" className={`${button} px-2`} onClick={() => setEditing(null)}>Cancel</button>
        {folders.some(folder => folder.id === editing.id) && <><button type="button" className={`${button} px-2`} onClick={() => create(editing.id)}>Subfolder</button><button type="button" className={`${button} px-2`} onClick={() => setConfirmDelete(true)}>Delete</button></>}
      </div>
      {confirmDelete && <div role="alert"><p>Delete this folder? Its setlists move to Unfiled; subfolders move to its parent.</p><button type="button" className={`${button} px-2`} onClick={() => {
        if (onDelete?.(editing.id)) setEditing(null); else setError('Folder was not deleted.')
      }}>Confirm delete folder</button></div>}
      {error && <p role="alert" className="text-app-muted">{error}</p>}
    </form>}
  </div>
}
