import { useSyncExternalStore } from 'react'
import { useExtensionHost } from './useExtensionHost'
export function useBandSyncGate() {
  const host = useExtensionHost()
  const active = useSyncExternalStore(host.subscribe, host.isBandSyncActive, () => false)
  const leader = useSyncExternalStore(host.subscribe, host.isBandSyncLeader, () => false)
  const remote = useSyncExternalStore(host.subscribeBandRemote, host.getBandRemote, () => null)
  return { host, active, leader, remote }
}
