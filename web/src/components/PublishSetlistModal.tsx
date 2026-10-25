import { useEffect, useRef, useState } from 'react'
import type { SyncLibrary } from '../utils/syncMerge'
import {
  makePublicationIntent, newPublicationLink, preparePublication, publicationError, publisherSession,
  readPublicationLink, refreshPublication, replacePublicationLink, sendPublicationIntent, verifyPreview,
  type PublicationLink, type SourcePreview,
} from '../utils/sharedSetlistPublishing'
import { useOptionalGoogleAuth } from '../utils/authContext'
import { getStoredSessionStatus } from '../utils/googleAuth'
import { UploadCloud, Globe } from 'lucide-react'

export function PublishSetlistModal({ sourceId, getLocal, blocked, onClose }: {
  sourceId: string | number; getLocal: () => SyncLibrary; blocked: () => boolean; onClose: () => void
}) {
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [link, setLink] = useState<PublicationLink | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [remove, setRemove] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const [identity, setIdentity] = useState<ReturnType<typeof publisherSession> | null>(null)
  const alive = useRef(true)
  // Subscribe to context updates; stored-session checks remain authoritative for requests.
  useOptionalGoogleAuth()
  const stored = getStoredSessionStatus()
  const session = stored.session
  const accountChanged = !!identity && (!session || stored.isExpired ||
    session.user.id !== identity.accountId || (session.sessionToken || session.idToken || session.token) !== identity.token)
  useEffect(() => {
    alive.current = true
    const element = dialog.current!
    element.showModal()
    return () => { alive.current = false; element.close() }
  }, [])
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMessage('')
    try { await action() } catch (error) { if (alive.current) setMessage(publicationError(error)) }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const review = () => run(async () => {
    setPreview(null); setConfirmed(false); setRemove(false)
    const session = publisherSession()
    setIdentity(session)
    const saved = readPublicationLink(session.accountId, sourceId)
    let next = saved || await newPublicationLink(session.accountId, sourceId)
    if (next.pending) {
      setLink(next)
      setMessage(`A previously confirmed ${next.pending.method} request needs recovery. Retry its exact request before any new action.`)
      return
    }
    if (next.result?.unpublished) { setLink(next); setMessage('This publication is permanently unpublished.'); return }
    if (next.result) next = await refreshPublication(next)
    if (!alive.current) return
    setLink(next)
    const source = await preparePublication(sourceId, getLocal, blocked)
    if (!alive.current) return
    await replacePublicationLink(session.accountId, sourceId, saved, next)
    setLink(next); setPreview(source)
  })
  const reviewUnpublish = () => run(async () => {
    setPreview(null); setConfirmed(false)
    const current = publisherSession()
    setIdentity(current)
    const saved = readPublicationLink(current.accountId, sourceId)
    if (!saved?.result || saved.pending || saved.result.unpublished) throw new Error('Recover a verified active publication before unpublishing.')
    const fresh = await refreshPublication(saved)
    if (!alive.current) return
    await replacePublicationLink(current.accountId, sourceId, saved, fresh)
    setLink(fresh); setRemove(true)
    setMessage(`Review unpublish: ${fresh.result!.id} · revision ${fresh.result!.revision}. Previously imported independent copies remain available to their owners.`)
  })
  const submit = (retry = false) => run(async () => {
    const session = publisherSession()
    if (!identity || identity.accountId !== session.accountId || identity.token !== session.token) throw new Error('Account changed. Close and reopen this setlist.')
    if (!link || (!retry && (!confirmed || (!remove && !preview)))) throw new Error('Review and confirm first.')
    let pending = link
    if (!retry) {
      if (!remove) {
        try { await verifyPreview(preview!, getLocal, blocked) }
        catch (error) { setPreview(null); setConfirmed(false); throw error }
      }
      pending = { ...link, pending: makePublicationIntent(link, preview!, remove) }
    }
    // UI and durable intent keep exactly the same body and keys across ambiguous failures.
    setLink(pending)
    try {
      const outcome = await sendPublicationIntent(session.accountId, sourceId, pending)
      if (!alive.current) return
      setPreview(null); setConfirmed(false)
      if (outcome.saved) setLink(readPublicationLink(session.accountId, sourceId))
      setMessage(`${outcome.result.unpublished ? 'Unpublished' : 'Published'}: ${outcome.result.id} · revision ${outcome.result.revision}.${outcome.saved ? '' : ' Server succeeded; local link could not be saved. Keep this ID. Retry the same request to recover without another publication.'}`)
    } catch (error) {
      setLink(readPublicationLink(session.accountId, sourceId))
      setPreview(null); setConfirmed(false)
      throw error
    }
  })
  return <dialog ref={dialog} aria-labelledby="publish-setlist-title" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}
    className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl p-5 bg-app-surface text-app-heading border border-app-border backdrop:bg-black/60 shadow-2xl z-50">
    <div className="flex items-center gap-2 mb-3">
      <UploadCloud className="w-4 h-4 text-app-action shrink-0" />
      <h2 id="publish-setlist-title" className="text-sm sm:text-base font-bold text-app-heading">Share Setlist</h2>
    </div>
    {accountChanged ? <p role="alert" className="text-xs text-status-error font-medium">Account or session changed. Close and reopen this setlist.</p> : <>
    <div className="p-3 rounded-xl bg-status-info/10 border border-status-info/20 text-xs text-app-text space-y-1 my-3">
      <p className="font-semibold text-status-info flex items-center gap-1.5">
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span>Visible to all active GTAR members</span>
      </p>
      <p className="text-[11px] text-app-muted leading-relaxed">
        Team members can view it and save their own copy. Yours stays unchanged.
      </p>
      <p className="text-[11px] text-app-muted leading-relaxed">
        If local and cloud versions differ, sync your changes first, then review again here.
      </p>
    </div>
    {message && <p role="status" className="my-3 text-xs font-mono font-medium whitespace-pre-wrap break-words">{message}</p>}
    {preview && <section aria-label="Exact publication preview" className="my-3 space-y-3 p-3 rounded-xl bg-app-base border border-app-border">
      <h3 className="font-bold text-sm text-app-heading break-words">{preview.snapshot.name}</h3>
      <p className="text-xs text-app-muted">{preview.snapshot.entries.length} songs · Cloud source version {preview.version}{link?.result ? ` · Published revision ${link.result.revision}` : ''}</p>
      <ol className="list-decimal pl-6 space-y-3 text-xs">{preview.snapshot.entries.map((song, index) => <li key={index}>
        <h4 className="font-bold text-app-heading break-words">{String(song.title)}</h4>
        <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-2 text-app-muted">{Object.entries(song).filter(([key]) => !['title', 'rawContent'].includes(key)).map(([key, value]) =>
          <div className="contents" key={key}><dt>{key}</dt><dd className="break-words">{value === null ? 'Not stored' : String(value)}</dd></div>)}</dl>
        <pre className="text-xs whitespace-pre-wrap break-words border border-app-border rounded p-2 max-h-60 overflow-auto select-text font-mono bg-app-surface">{String(song.rawContent)}</pre>
      </li>)}</ol>
      {link?.result && <label className="flex items-center gap-2 min-h-11 text-xs font-medium cursor-pointer"><input type="checkbox" checked={remove} disabled={busy} onChange={e => { setRemove(e.target.checked); setConfirmed(false) }} />Unpublish instead of updating</label>}
      {remove && <p className="text-xs text-app-muted">Unpublishing hides catalog revisions. Previously imported independent copies remain available to their owners.</p>}
      <label className="flex items-center gap-2 min-h-11 text-xs font-medium cursor-pointer"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{remove ? 'I confirm unpublishing this revision.' : 'I reviewed this setlist and approve sharing it.'}</label>
    </section>}
    {remove && !preview && <label className="flex items-center gap-2 min-h-11 text-xs font-medium cursor-pointer"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I confirm unpublishing this exact revision.</label>}
    <div className="flex flex-wrap gap-2 justify-end mt-4 font-mono text-xs font-bold">
      <button type="button" disabled={busy} className="min-h-11 px-3.5 py-2 border border-app-border rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer" onClick={onClose}>Cancel</button>
      <button type="button" disabled={busy} className="min-h-11 px-3.5 py-2 border border-app-border rounded-lg bg-app-surface text-app-heading hover:border-app-action transition-colors cursor-pointer" onClick={review}>Review Setlist</button>
      {link?.result && !link.result.unpublished && !link.pending && <button type="button" disabled={busy} className="min-h-11 px-3.5 py-2 border border-status-error/40 rounded-lg text-status-error hover:bg-status-error/10 transition-colors cursor-pointer" onClick={reviewUnpublish}>Review unpublish</button>}
      {link?.pending ? (
        <button type="button" disabled={busy} className="min-h-11 px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-500 flex items-center gap-1.5 transition-colors cursor-pointer" onClick={() => submit(true)}>
          <UploadCloud className="w-3.5 h-3.5" />
          <span>Retry confirmed request</span>
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || (!preview && !remove) || !confirmed}
          className={`min-h-11 px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 ${
            remove ? 'bg-status-error text-white hover:bg-status-error/90' : 'bg-app-action text-app-on-action hover:bg-app-action/90'
          }`}
          onClick={() => submit()}
        >
          <UploadCloud className="w-3.5 h-3.5" />
          <span>{busy ? 'Verifying…' : remove ? 'Confirm unpublish' : 'Share Setlist'}</span>
        </button>
      )}
    </div>
    </>}
    {accountChanged && <button type="button" className="min-h-11 px-3.5 py-2 border border-app-border rounded-lg bg-app-base text-app-muted hover:text-app-heading mt-4 font-mono text-xs font-bold cursor-pointer" onClick={onClose}>Cancel</button>}
  </dialog>
}
