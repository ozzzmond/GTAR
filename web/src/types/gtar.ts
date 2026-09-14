/**
 * GTAR Android Room Entity, Setlist & Stage Line Type Definitions (v1.1.62 compatible)
 */

export const GTAR_APP_VERSION = '1.1.87';
export const GTAR_DEV_VERSION = '1.0.87-dev.17';
export const GTAR_SETLIST_VERSION = 1
export const GTAR_SETLIST_TYPE = 'GTAR_SETLIST'

export type SongFormat = 'TWO_LINE' | 'CHORD_PRO' | 'PLAIN'

export interface SongEntity {
  id?: string | number
  title: string
  artist?: string | null
  key?: string | null
  capo?: string | null
  rawContent: string
  format: SongFormat | string
  isFavorite?: boolean
  transposeOffset?: number
  tags?: string
  isDeleted?: boolean
  createdAt?: number
  lastOpenedAt?: number
}

export interface WebSetlist {
  id: string | number
  name: string
  createdAt?: number
  songs: Array<{ title: string; artist?: string; id?: string | number }>
}

export interface GtarSetlistSong {
  title: string
  artist: string
  key: string
  chordsContent: string
  order: number
}

export interface GtarSetlist {
  version: number
  type: 'GTAR_SETLIST'
  name: string
  createdAt: string
  songs: GtarSetlistSong[]
}

export interface GtarBackupMetadata {
  appName: string
  appVersion: string
  exportTimestamp: number
}

export interface GtarBackup {
  metadata: GtarBackupMetadata
  songs: SongEntity[]
  setlists?: Array<{
    name: string
    createdAt: number
    songs: Array<{
      title: string
      artist: string
      position: number
    }>
  }>
}

export interface ActiveSongState {
  id?: string | number
  title: string
  artist: string
  key: string
  capo: string
  bpm: string
  rawContent: string
  format: SongFormat
  transposeOffset: number
  tags?: string
  isDeleted?: boolean
  isFavorite?: boolean
  createdAt?: number
  lastOpenedAt?: number
  isMissing?: boolean
}

// Stage Lines Model matching Android SongLine.kt (v1.0.42)
export interface ChordSegment {
  chord: string | null
  text: string
}

export type SongLineType =
  | 'EMPTY'
  | 'SECTION_HEADER'
  | 'TAB'
  | 'CHORD_ROW'
  | 'LYRIC'
  | 'CHORD_PRO'

export interface EmptyLine {
  type: 'EMPTY'
}

export interface SectionHeaderLine {
  type: 'SECTION_HEADER'
  title: string
}

export interface TabLine {
  type: 'TAB'
  content: string
}

export interface ChordRowLine {
  type: 'CHORD_ROW'
  // Array of parsed chord tokens with spacing/position preserved
  chords: string[]
  raw: string
  isOverLyric?: boolean
}

export interface LyricLine {
  type: 'LYRIC'
  lyrics: string
}

export interface ChordProLine {
  type: 'CHORD_PRO'
  raw: string
  segments: ChordSegment[]
}

export type SongLine =
  | EmptyLine
  | SectionHeaderLine
  | TabLine
  | ChordRowLine
  | LyricLine
  | ChordProLine

export interface ParsedGtarSong {
  title: string
  artist: string
  key: string
  capo: string
  bpm: string
  tags?: string
  format: SongFormat
  lines: SongLine[]
}
