import React, { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Folder, FolderPlus, MoreHorizontal } from 'lucide-react'
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
const button = 'min-h-11 min-w-11 rounded-xl sm:rounded-lg max-sm:h-(--control-h) max-sm:min-h-(--control-h) max-sm:shrink-0 text-app-muted hover:bg-app-surface hover:text-app-heading flex items-center justify-center'
const editorButton = "relative h-7 max-sm:h-(--control-h) max-sm:min-h-(--control-h) max-sm:whitespace-nowrap after:absolute after:-inset-y-2 after:content-[''] max-sm:after:hidden"
const field = 'min-h-[36px] max-sm:min-h-(--control-h) w-full min-w-0 rounded-xl border border-app-border hover:border-app-border/80 bg-app-surface px-3 py-1.5 max-sm:py-2 text-xs text-app-text font-medium placeholder:text-app-muted focus:border-app-accent focus:ring-2 focus:ring-app-accent/20 focus:outline-none transition-all duration-200'
/** Folder actions share the Explorer's existing compact navigation surface. */
export function ExplorerFolderTree({ folders, setlists, selectedId, onSelect, onSave, onDelete }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<SetlistFolder | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const edit = (folder: SetlistFolder) => { setEditing(folder); setConfirmDelete(false); setError('') }
  const create = (parentId: string | null) => edit({ id: generateUUID(), name: '', parentId, createdAt: Date.now() })
  const renderNode = ({ folder, children }: FolderTreeNode, depth: number): React.ReactNode => <div key={folder.id}>
    <div className="flex min-w-0 items-center max-sm:rounded-xl">
      <button type="button" aria-label={`${collapsed.has(folder.id) ? 'Expand' : 'Collapse'} ${folder.name}`} aria-expanded={!collapsed.has(folder.id)}
        className={button} onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next })}>
        {collapsed.has(folder.id) ? <ChevronRight className="h-3 w-3 max-sm:size-5" /> : <ChevronDown className="h-3 w-3 max-sm:size-5" />}
      </button>
      <button type="button" data-explorer-drop-folder={folder.id} aria-current={selectedId === folder.id ? 'page' : undefined} onClick={() => onSelect(folder.id)}
        className={`flex min-h-[42px] h-[42px] min-w-0 flex-1 items-center gap-2 rounded-xl sm:rounded-lg px-1 max-sm:px-2 max-sm:h-(--control-h) max-sm:min-h-(--control-h) text-left ${selectedId === folder.id ? 'bg-app-action text-app-on-action' : 'text-app-text hover:bg-app-surface'}`}>
        <Folder className="h-4 w-4 shrink-0" /><span className="truncate">{folder.name}</span>
        <span className="ml-auto max-sm:shrink-0 max-sm:rounded-full max-sm:border max-sm:border-current max-sm:px-2 max-sm:py-1 max-sm:text-xs max-sm:leading-none">{setlists.filter(list => !list.isDeleted && list.folderId === folder.id).length}</span>
      </button>
      {onSave && <button type="button" className={button} aria-label={`Folder actions for ${folder.name}`} onClick={() => edit(folder)}><MoreHorizontal className="h-4 w-4 max-sm:size-5" aria-hidden="true" /></button>}
    </div>
    {!collapsed.has(folder.id) && children.length > 0 && (
      <div className={`ml-3 border-l border-app-border pl-1 max-sm:ml-0 ${depth < 3 ? 'max-sm:pl-2' : 'max-sm:border-l-0 max-sm:pl-0'}`}>
        {children.map(child => renderNode(child, depth + 1))}
      </div>
    )}
  </div>
  return <div data-testid="explorer-folder-tree">
    {onSave && <button type="button" className={`${button} w-full justify-start gap-2 px-2.5 max-sm:px-2 text-xs`} onClick={() => create(null)}><FolderPlus className="h-4 w-4" />New Folder</button>}
    {buildFolderTree(folders).map(node => renderNode(node, 0))}
    {editing && <form aria-label="Folder editor" className="space-y-2 rounded-xl border border-app-border bg-app-surface p-2.5 max-sm:p-3 max-sm:rounded-2xl my-1" onSubmit={event => {
      event.preventDefault()
      if (!editing.name.trim()) { setError('Enter a folder name.'); return }
      if (!validateFolderParentChange(folders, editing.id, editing.parentId)) { setError('Choose a parent outside this folder.'); return }
      if (onSave?.({ ...editing, name: editing.name.trim(), updatedAt: Date.now() })) setEditing(null)
      else setError('Not saved. Resolve the storage conflict and retry.')
    }}>
      <label className="block space-y-1">
        <span className="text-[11px] max-sm:text-xs font-semibold text-app-muted">Folder name</span>
        <input autoFocus aria-label="Folder name" className={field} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] max-sm:text-xs font-semibold text-app-muted">Parent folder</span>
        <select aria-label="Parent folder" className={field} value={editing.parentId ?? ''} onChange={e => setEditing({ ...editing, parentId: e.target.value || null })}>
          <option value="">Root</option>
          {folders.filter(folder => validateFolderParentChange(folders, editing.id, folder.id)).map(folder => (
            <option key={folder.id} value={folder.id}>{folder.name}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-1.5 pt-1 max-sm:grid max-sm:grid-cols-2 max-sm:gap-2">
        <button type="submit" className={`${editorButton} px-3 rounded-xl bg-app-action hover:brightness-110 text-app-on-action border border-app-action/50 font-medium text-xs transition-colors flex items-center justify-center cursor-pointer`}>
          Save
        </button>
        <button type="button" className={`${editorButton} px-3 rounded-xl bg-app-surface hover:bg-app-base border border-app-border hover:border-app-border/80 text-app-text font-medium text-xs transition-colors flex items-center justify-center cursor-pointer`} onClick={() => setEditing(null)}>
          Cancel
        </button>
        {folders.some(folder => folder.id === editing.id) && (
          <>
            <button type="button" className={`${editorButton} px-2.5 rounded-xl bg-app-surface hover:bg-app-base border border-app-border hover:border-app-border/80 text-app-text font-medium text-xs transition-colors flex items-center justify-center cursor-pointer`} onClick={() => create(editing.id)}>
              Subfolder
            </button>
            <button type="button" className={`${editorButton} px-2.5 rounded-xl bg-status-error/15 hover:bg-status-error/25 border border-status-error/30 text-status-error font-medium text-xs transition-colors flex items-center justify-center cursor-pointer`} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          </>
        )}
      </div>
      {confirmDelete && (
        <div role="alert" className="rounded-xl border border-status-error/40 bg-app-base/80 p-3 space-y-2.5 max-sm:space-y-2 max-sm:rounded-2xl animate-in fade-in duration-150">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-status-error shrink-0 mt-0.5" />
            <p className="text-xs text-app-heading font-medium leading-relaxed">
              Delete this folder? Its setlists move to Unfiled; subfolders move to its parent.
            </p>
          </div>
          <div className="flex items-center gap-2 max-sm:flex-wrap">
            <button
              type="button"
              className={`${editorButton} flex-1 px-3 rounded-xl bg-app-surface hover:bg-app-base border border-app-border hover:border-app-border/80 text-app-text font-medium text-xs transition-colors flex items-center justify-center cursor-pointer`}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${editorButton} flex-1 px-3 rounded-xl bg-status-error hover:brightness-110 text-white font-medium text-xs transition-colors flex items-center justify-center cursor-pointer`}
              onClick={() => {
                if (onDelete?.(editing.id)) setEditing(null)
                else setError('Folder was not deleted.')
              }}
            >
              Confirm delete folder
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-medium text-status-error">{error}</p>}
    </form>}
  </div>
}
