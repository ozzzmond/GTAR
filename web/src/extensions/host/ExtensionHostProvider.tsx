import type { ReactNode } from 'react'
import { ExtensionHostContext } from './ExtensionHostContext'
import { useExtensionHost } from './useExtensionHost'
export function ExtensionHostProvider({ children }: { children: ReactNode }) {
  const host = useExtensionHost()
  return <ExtensionHostContext.Provider value={host}>{children}</ExtensionHostContext.Provider>
}
