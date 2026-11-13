import { useContext, useEffect, useState } from 'react'
import { ExtensionHostContext } from './ExtensionHostContext'
import { registry } from '../registry'
import { ExtensionHost } from './ExtensionHost'
import { appLogger } from '../../utils/logger'

export function useExtensionHost() {
  const inherited = useContext(ExtensionHostContext)
  const [owned] = useState(() => inherited ? null : new ExtensionHost(registry, {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  }, { capabilities: ['ui:panel', 'net:lan'] }, message => appLogger.debug('Extension', message)))
  const host = inherited ?? owned!
  useEffect(() => {
    if (inherited) return
    void host.start()
    return () => host.dispose()
  }, [host, inherited])
  return host
}
