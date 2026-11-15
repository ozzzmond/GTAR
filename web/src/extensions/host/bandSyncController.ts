import type { ExtensionPanel, StageSongEvent } from '../contract'
import type { ReceiverSnapshot } from '../../utils/stageCast2Protocol'
import type { BandSyncFollower } from '../../utils/bandSyncSync'
import { BandSyncClient, normalizeRoomCodeInput } from '../../utils/bandSyncClient'
import { bandSync } from '../../utils/bandSync'
import { createBandSyncQr } from '../../utils/bandSyncQr'

export interface StagePublication { event: StageSongEvent; content: ReceiverSnapshot }
export function activateBandSyncController(source: {
  read(): StagePublication | null; subscribe(listener: () => void): () => void
  applyRemote(view: BandSyncFollower | null): void; panel(value: ExtensionPanel): void
  setLeader(leader: boolean): void; setJoin(handler: ((code: string) => void) | null): void
}): () => void {
  let code = '', alive = true, qrCode = '', qr = '', leader = false
  const client = new BandSyncClient(view => {
    if (!alive) return
    const nextLeader = view.role === 'leader' && view.status !== 'error'
    source.setLeader(nextLeader)
    if (nextLeader && !leader) { leader = true; publish() }
    leader = nextLeader
    source.applyRemote(view.role === 'follower' && !view.ended ? view.follower : null)
    if (nextLeader && view.roomCode && view.roomCode !== qrCode) {
      qrCode = view.roomCode; qr = ''
      const roomCode = qrCode
      void createBandSyncQr(location.origin, roomCode).then(value => {
        if (alive && client.getSnapshot().role === 'leader' && qrCode === roomCode) { qr = value; render() }
      }).catch(() => { /* The room code remains available if image generation fails. */ })
    }
    if (!nextLeader) { qrCode = ''; qr = '' }
    render()
  })
  const render = () => {
    const view = client.getSnapshot(), state = view.follower?.state
    source.panel({
      ...(qr && leader ? { qr: { label: 'Band Sync join QR', src: qr } } : {}),
      fields: [{ label: 'Status', value: view.message ?? view.status }, ...(view.roomCode ? [{ label: 'Room code', value: view.roomCode }] : []),
        ...(leader ? [{ label: 'Room control', value: 'Reloading this page ends your control of the room; it expires on its own.' }] : []),
        ...(view.role === 'follower' ? [{ label: 'Leader', value: view.follower?.leaderOnline ? 'Leader online' : 'Leader offline' },
          { label: 'Song', value: state?.displayTitle ?? 'Waiting for song' }, { label: 'Key', value: state?.effectiveKey || '—' }] : [])],
      // maxLength leaves room for pasted spaces/dashes; the code itself is normalized and validated on join.
      inputs: view.role ? [] : [{ label: 'Room code', value: code, maxLength: 12, change: value => { code = normalizeRoomCodeInput(value); render() }, submit: () => { void client.join(code) } }],
      actions: view.role ? [{ label: leader ? 'End room' : 'Leave room', run: () => { void client.end() } }] : [
        { label: 'Start room', run: () => { void client.create() } },
        { label: 'Join with code', run: () => { void client.join(code) } },
      ],
    })
  }
  const publish = () => {
    const value = source.read()
    if (!value || client.getSnapshot().role !== 'leader') return
    const e = value.event
    client.publish({ ...e, notation: value.content.mode.notation }, { contentHash: e.contentHash, snapshot: value.content })
  }
  const stopLegacy = bandSync.activate()
  const unsubscribe = source.subscribe(publish)
  source.setJoin(value => { code = value; void client.join(value) })
  publish(); render()
  return () => { alive = false; source.setJoin(null); unsubscribe(); client.dispose(); stopLegacy(); source.applyRemote(null) }
}
