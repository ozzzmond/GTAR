import { useEffect, useState } from 'react'
import { registry } from '../registry'
import { ExtensionHost } from './ExtensionHost'
import { appLogger } from '../../utils/logger'

export function useExtensionHost() {
  const [host] = useState(() => new ExtensionHost(registry, {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  }, { capabilities: ['ui:panel'] }, message => appLogger.debug('Extension', message)))
  useEffect(() => {
    void host.start()
    return () => host.dispose()
  }, [host])
  return host
}
