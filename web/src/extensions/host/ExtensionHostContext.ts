import { createContext } from 'react'
import type { ExtensionHost } from './ExtensionHost'
export const ExtensionHostContext = createContext<ExtensionHost | null>(null)
