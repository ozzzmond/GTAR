import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Copy, Trash2 } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import {
  findDuplicateGroups, planDuplicateCleanup, readDismissedDuplicates, dismissDuplicateGroup,
  type DuplicateGroup, type CopyVerdict,
} from '../utils/duplicateSongs'

interface Props {
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  /** Moves `trash` ids to Trash after re-pointing setlist refs per `repoint`. Returns false if nothing changed. */
  onTrashDuplicates: (trash: string[], repoint: Record<string, string>) => boolean
  onClose: () => void
}

const KIND_LABEL: Record<DuplicateGroup['kind'], string> = {
  exact: 'Exact copy',
  likely: 'Likely duplicate (chords differ)',
  distinct: 'Different version (not a duplicate)',
}
const VERDICT_LABEL: Record<CopyVerdict, string> = {
  keep: 'Keep',
  safe: 'Safe to delete',
  repoint: 'Used in setlists: they will use the kept copy',
  review: 'Chords differ: check before deleting',
  blocked: 'Used in setlists: remove it from those setlists first',
  info: 'Different lyrics',
}
const VERDICT_CLASS: Record<CopyVerdict, string> = {
  keep: 'text-status-success', safe: 'text-status-success', repoint: 'text-status-warning',
  review: 'text-status-warning', blocked: 'text-status-error', info: 'text-app-muted',
}

/** #149 S2: AI Worker duplicate check. Deterministic and local; every change is Move to Trash (recoverable). */
export function DuplicateReviewDialog({ songs, setlists, onTrashDuplicates, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissedDuplicates())
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [keepChoices, setKeepChoices] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    const element = dialog.current!
    if (typeof element.showModal === 'function') element.showModal()
    return () => { if (typeof element.close === 'function') element.close() }
  }, [])

  const byId = useMemo(() => new Map(songs.filter(s => s.id !== undefined).map(s => [String(s.id), s])), [songs])
  const groups = useMemo(() => findDuplicateGroups(songs, setlists, { dismissed, keepChoices })
    .filter(g => !hidden.has(g.dismissKey)), [songs, setlists, dismissed, keepChoices, hidden])
  const actionable = groups.filter(g => g.kind !== 'distinct').length

  const choose = (group: DuplicateGroup, id: string) => { setConfirming(null); setKeepChoices(prev => ({ ...prev, [group.dismissKey]: id })) }
  const notDuplicate = (group: DuplicateGroup) => { dismissDuplicateGroup(group.dismissKey); setDismissed(readDismissedDuplicates()); setFeedback(`Marked “${group.title}” as not a duplicate.`) }
  const apply = (group: DuplicateGroup) => {
    const plan = planDuplicateCleanup(group)
    setConfirming(null)
    let ok: boolean
    try { ok = onTrashDuplicates(plan.trash, plan.repoint) } catch { ok = false }
    setFeedback(ok ? `Moved ${plan.trash.length} ${plan.trash.length === 1 ? 'copy' : 'copies'} of “${group.title}” to Trash.` : 'Nothing was changed. Please try again.')
  }

  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="duplicate-review-title" data-testid="duplicate-review-dialog"
    className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60">
    <div className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="duplicate-review-title" className="font-bold flex items-center gap-2"><Copy className="w-5 h-5 text-app-action" />AI Worker: duplicate check</h2>
        <button type="button" onClick={onClose} aria-label="Close duplicate check" className="p-2 rounded-lg hover:bg-app-base"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-xs text-app-muted mt-1">Checked on this device only. Deleting moves a song to Trash, where you can restore it.</p>
      <p data-testid="duplicate-summary" className="text-sm mt-3 font-mono">
        {groups.length === 0 ? 'No duplicates found.' : `${actionable} duplicate ${actionable === 1 ? 'group' : 'groups'}${groups.length > actionable ? `, ${groups.length - actionable} same-name ${groups.length - actionable === 1 ? 'version' : 'versions'}` : ''}`}
      </p>
      {feedback && <p role="status" className="text-xs text-app-action mt-2">{feedback}</p>}
      <div className="max-h-[60vh] overflow-y-auto mt-3 space-y-3">
        {groups.map(group => {
          const plan = planDuplicateCleanup(group)
          const repointed = Object.keys(plan.repoint).length
          const blocked = group.copies.filter(c => c.verdict === 'blocked').length
          return <section key={group.dismissKey} data-testid={`duplicate-group-${group.kind}`} className="rounded-xl border border-app-border bg-app-base p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0"><span className="font-bold break-words">{group.title}</span>{group.artist && <span className="text-app-muted text-sm"> · {group.artist}</span>}</div>
              <span className="text-[11px] font-mono text-app-muted">{KIND_LABEL[group.kind]}</span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {group.copies.map(copy => <li key={copy.id} className="text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {group.kind !== 'distinct' && <input type="radio" name={`keep-${group.dismissKey}`} aria-label={`Keep this copy of ${copy.title}`}
                    checked={copy.verdict === 'keep'} onChange={() => choose(group, copy.id)} className="accent-app-action" />}
                  <span className="font-mono text-app-muted">#{copy.index + 1}</span>
                  {copy.key && <span className="font-mono">Key {copy.key}</span>}
                  <span className="text-app-muted">{copy.setlists.length ? `In ${copy.setlists.length} ${copy.setlists.length === 1 ? 'setlist' : 'setlists'}: ${copy.setlists.join(', ')}` : 'In no setlist'}</span>
                  <span data-testid={`verdict-${copy.verdict}`} className={`font-semibold ${VERDICT_CLASS[copy.verdict]}`}>{VERDICT_LABEL[copy.verdict]}</span>
                  <button type="button" className="text-app-action underline" onClick={() => setShown(shown === copy.id ? null : copy.id)}>{shown === copy.id ? 'Hide chart' : 'Show chart'}</button>
                </div>
                {shown === copy.id && <pre className="mt-1 p-2 rounded bg-app-surface border border-app-border max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">{byId.get(copy.id)?.rawContent}</pre>}
              </li>)}
            </ul>
            {blocked > 0 && <p className="text-xs text-status-error mt-2">{blocked} {blocked === 1 ? 'copy is' : 'copies are'} used in setlists with different chords. Remove {blocked === 1 ? 'it' : 'them'} from those setlists first.</p>}
            {confirming === group.dismissKey ? <div data-testid="duplicate-confirm" className="mt-3 p-2 rounded-lg border border-status-warning/40 text-xs space-y-2">
              <p>Move {plan.trash.length} {plan.trash.length === 1 ? 'copy' : 'copies'} to Trash{repointed ? ` and switch ${repointed === 1 ? 'its setlists' : 'their setlists'} to the kept copy` : ''}? You can restore from Trash.</p>
              <div className="flex gap-2">
                <button type="button" data-testid="duplicate-confirm-btn" onClick={() => apply(group)} className="px-3 py-1.5 rounded-lg bg-status-error text-white font-bold flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />Move to Trash</button>
                <button type="button" onClick={() => setConfirming(null)} className="px-3 py-1.5 rounded-lg border border-app-border">Cancel</button>
              </div>
            </div> : <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {group.kind !== 'distinct' && <button type="button" data-testid="duplicate-trash-btn" disabled={plan.trash.length === 0}
                onClick={() => setConfirming(group.dismissKey)}
                className="px-3 py-1.5 rounded-lg border border-status-error/40 text-status-error font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                Move {plan.trash.length} to Trash…</button>}
              {group.kind !== 'distinct' && <button type="button" data-testid="duplicate-keep-both-btn" onClick={() => setHidden(prev => new Set(prev).add(group.dismissKey))}
                className="px-3 py-1.5 rounded-lg border border-app-border">Keep both</button>}
              <button type="button" data-testid="duplicate-not-duplicate-btn" onClick={() => notDuplicate(group)}
                className="px-3 py-1.5 rounded-lg border border-app-border">{group.kind === 'distinct' ? 'Hide' : 'Not a duplicate'}</button>
            </div>}
          </section>
        })}
      </div>
    </div>
  </dialog>
}
