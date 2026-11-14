import { useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { ExtensionHostContext } from '../extensions/host/ExtensionHostContext'
import { useOptionalGoogleAuth } from './authContext'
import { SetlistAutoFollower, type FollowSelection, type FollowSetlist } from './setlistAutoFollow'
import { setlistAutoFollowDev } from './setlistAutoFollowDev'
import type { FollowSnapshot } from '../extensions/host/ExtensionHost'
const noSnapshot = () => null
const noSelect = () => false
const noRefresh = () => {}
export function useSetlistAutoFollow(snapshot: FollowSnapshot | null, context: FollowSetlist | null, selectedIndex: number, manualRevision: number, fullscreen: boolean, suspended: boolean, select?: (request: FollowSelection) => boolean) {
  const host = useContext(ExtensionHostContext)
  const auth = useOptionalGoogleAuth()
  const account = JSON.stringify([auth?.bypass ?? false, auth?.session?.user?.sub ?? null, auth?.session?.user?.id ?? null])
  const [controller] = useState(() => new SetlistAutoFollower())
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useLayoutEffect(() => {
    controller.update({ dev: setlistAutoFollowDev, fullscreen, suspended, account, context, selectedIndex, manualRevision, snapshot,
      readSnapshot: host?.getFollowSnapshot ?? noSnapshot, refresh: host?.requestFollowRefresh ?? noRefresh, select: select ?? noSelect })
  })
  useLayoutEffect(() => () => controller.dispose(), [controller])
  return { controller, state, available: setlistAutoFollowDev && fullscreen && !suspended && !!context && !!snapshot?.live && !!select }
}
