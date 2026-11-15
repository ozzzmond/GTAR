import { useSyncExternalStore } from 'react'
import { useExtensionHost } from './useExtensionHost'
export function useBandSyncGate() {
  const host = useExtensionHost()
  const active = useSyncExternalStore(host.subscribe, host.isBandSyncActive, () => false)
  const remote = useSyncExternalStore(host.subscribeBandRemote, host.getBandRemote, () => null)
  return { host, active, remote }
}
