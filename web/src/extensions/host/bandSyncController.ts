import type { ExtensionPanel, StageSongEvent } from '../contract'
import type { ReceiverSnapshot } from '../../utils/stageCast2Protocol'
import type { BandSyncFollower } from '../../utils/bandSyncSync'
import { BandSyncClient } from '../../utils/bandSyncClient'
import { bandSync } from '../../utils/bandSync'

export interface StagePublication { event: StageSongEvent; content: ReceiverSnapshot }
export function activateBandSyncController(source: {
  read(): StagePublication | null; subscribe(listener: () => void): () => void
  applyRemote(view: BandSyncFollower | null): void; panel(value: ExtensionPanel): void
}): () => void {
  let code = '', alive = true
  const client = new BandSyncClient(view => {
    if (!alive) return
    source.applyRemote(view.role === 'follower' && !view.ended ? view.follower : null)
    render()
  })
  const render = () => {
    const view = client.getSnapshot(), state = view.follower?.state
    source.panel({
      fields: [{ label: 'Status', value: view.status }, ...(view.roomCode ? [{ label: 'Room code', value: view.roomCode }] : []),
        ...(view.role === 'follower' ? [{ label: 'Leader', value: view.follower?.leaderOnline ? 'Leader online' : 'Leader offline' },
          { label: 'Song', value: state?.displayTitle ?? 'Waiting for song' }, { label: 'Key', value: state?.effectiveKey || '—' }] : [])],
      inputs: view.role ? [] : [{ label: 'Room code', value: code, maxLength: 8, change: value => { code = value.toUpperCase(); render() } }],
      actions: view.role ? [{ label: view.role === 'leader' ? 'End room' : 'Leave room', run: () => { void client.end() } }] : [
        { label: 'Start room', run: () => { void client.create() } },
        { label: 'Join with code', disabled: code.length !== 8, run: () => { void client.join(code) } },
      ],
    })
  }
  const publish = () => {
    const value = source.read()
    if (!value) return
    const e = value.event
    client.publish({ ...e, setlist: { id: null, index: 0, count: 0 }, lineIndex: 0, scrollFraction: 0,
      autoscroll: { on: false, speed: 0 }, notation: value.content.mode.notation }, { contentHash: e.contentHash, snapshot: value.content })
  }
  const stopLegacy = bandSync.activate()
  const unsubscribe = source.subscribe(publish)
  publish(); render()
  return () => { alive = false; unsubscribe(); client.dispose(); stopLegacy(); source.applyRemote(null) }
}
