import { createContext, useContext } from 'react'
import type { TagColors } from './songTags'
export const TagLibraryContext = createContext<{
  colors?: TagColors
  onColorChange?: (tag: string, color?: string) => boolean
  onAddToTag?: (ids: Array<string | number>, tag: string) => boolean
}>({})
export const useTagLibrary = () => useContext(TagLibraryContext)
