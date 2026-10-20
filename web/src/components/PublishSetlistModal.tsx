import { useEffect, useRef, useState } from 'react'
import type { SyncLibrary } from '../utils/syncMerge'
import {
  makePublicationIntent, newPublicationLink, preparePublication, publicationError, publisherSession,
  readPublicationLink, refreshPublication, savePublicationLink, sendPublicationIntent, verifyPreview,
  type PublicationLink, type SourcePreview,
} from '../utils/sharedSetlistPublishing'
import { CatalogApiError } from '../types/sharedCatalog'
import { useOptionalGoogleAuth } from '../utils/authContext'
import { getStoredSessionStatus } from '../utils/googleAuth'

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
    let next = readPublicationLink(session.accountId, sourceId) || await newPublicationLink(session.accountId, sourceId)
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
    savePublicationLink(session.accountId, sourceId, next)
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
    savePublicationLink(current.accountId, sourceId, fresh)
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
      if (outcome.saved) setLink({ publicationKey: pending.publicationKey, result: outcome.result })
      setMessage(`${outcome.result.unpublished ? 'Unpublished' : 'Published'}: ${outcome.result.id} · revision ${outcome.result.revision}.${outcome.saved ? '' : ' Server succeeded; local link could not be saved. Keep this ID. Retry the same request to recover without another publication.'}`)
    } catch (error) {
      // These explicit server rejections have no committed mutation. Fresh review required.
      if (error instanceof CatalogApiError && [400, 403, 409, 410, 413, 422, 429].includes(error.status)) {
        const clean = { publicationKey: pending.publicationKey, result: pending.result }
        savePublicationLink(session.accountId, sourceId, clean)
        setLink(clean); setPreview(null); setConfirmed(false)
      }
      throw error
    }
  })
  return <dialog ref={dialog} aria-labelledby="publish-setlist-title" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}
    className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl p-5 bg-app-surface text-app-heading border border-app-border backdrop:bg-black/60">
    <h2 id="publish-setlist-title" className="text-lg font-bold">Publish personal setlist</h2>
    {accountChanged ? <p role="alert">Account or session changed. Close and reopen this setlist.</p> : <>
    <p className="my-3 text-sm">The published snapshot, including authored charts, becomes readable by other approved members of this environment. Personal saves never publish automatically.</p>
    <p className="text-sm">If local and cloud versions differ, use Cloud Sync, resolve conflicts, then retry review here.</p>
    {message && <p role="status" className="my-3 whitespace-pre-wrap break-words">{message}</p>}
    {preview && <section aria-label="Exact publication preview" className="my-3 space-y-3">
      <h3 className="font-bold break-words">{preview.snapshot.name}</h3>
      <p>{preview.snapshot.entries.length} songs · Cloud source version {preview.version}{link?.result ? ` · Published revision ${link.result.revision}` : ''}</p>
      <ol className="list-decimal pl-6 space-y-3">{preview.snapshot.entries.map((song, index) => <li key={index}>
        <h4 className="font-bold break-words">{String(song.title)}</h4>
        <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-2">{Object.entries(song).filter(([key]) => !['title', 'rawContent'].includes(key)).map(([key, value]) =>
          <div className="contents" key={key}><dt>{key}</dt><dd className="break-words">{value === null ? 'Not stored' : String(value)}</dd></div>)}</dl>
        <pre className="text-xs whitespace-pre-wrap break-words border border-app-border rounded p-2 max-h-60 overflow-auto select-text">{String(song.rawContent)}</pre>
      </li>)}</ol>
      {link?.result && <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={remove} disabled={busy} onChange={e => { setRemove(e.target.checked); setConfirmed(false) }} />Unpublish instead of updating</label>}
      {remove && <p>Unpublishing hides catalog revisions. Previously imported independent copies remain available to their owners.</p>}
      <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{remove ? 'I confirm unpublishing this revision.' : 'I reviewed this exact snapshot and approve publishing it.'}</label>
    </section>}
    {remove && !preview && <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I confirm unpublishing this exact revision.</label>}
    <div className="flex flex-wrap gap-3 mt-4">
      <button type="button" disabled={busy} className="min-h-11 px-3 border rounded-lg" onClick={onClose}>Close</button>
      <button type="button" disabled={busy} className="min-h-11 px-3 border rounded-lg" onClick={review}>Refresh and review</button>
      {link?.result && !link.result.unpublished && !link.pending && <button type="button" disabled={busy} className="min-h-11 px-3 border rounded-lg" onClick={reviewUnpublish}>Review unpublish</button>}
      {link?.pending ? <button type="button" disabled={busy} className="min-h-11 px-3 rounded-lg bg-app-action text-app-on-action" onClick={() => submit(true)}>Retry confirmed request</button> :
        <button type="button" disabled={busy || (!preview && !remove) || !confirmed} className="min-h-11 px-3 rounded-lg bg-app-action text-app-on-action disabled:opacity-40" onClick={() => submit()}>{busy ? 'Verifying…' : remove ? 'Confirm unpublish' : link?.result ? 'Confirm update' : 'Confirm publish'}</button>}
    </div>
    </>}
    {accountChanged && <button type="button" className="min-h-11 px-3" onClick={onClose}>Close</button>}
  </dialog>
}
