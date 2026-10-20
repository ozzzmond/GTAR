import { createContext } from 'react'
import type { ImportHost } from './sharedSetlistImport'
export const CatalogImportContext = createContext<ImportHost | null>(null)
