import type { CatalogSetlistLineage } from '../utils/catalogSetlistLineage'
/**
 * GTAR Android Room Entity, Setlist & Stage Line Type Definitions (v1.1.62 compatible)
 */

declare const __GTAR_PROD_VERSION__: string | null
// Legacy fallback for local/preview builds; Pages main requires exact tag-derived identity.
export const GTAR_APP_VERSION = typeof __GTAR_PROD_VERSION__ === 'string'
  ? __GTAR_PROD_VERSION__ : '1.1.108';
declare const __GTAR_DEV_VERSION__: string | null
export const GTAR_DEV_VERSION = typeof __GTAR_DEV_VERSION__ === 'string'
  ? __GTAR_DEV_VERSION__ : '1.0.136-dev.1';

export interface DevBuildProvenance {
  tagStatus: 'TAGGED' | 'UNTAGGED' | 'UNVERIFIED'
  tagName: string | null
  commitSha: string
  deploymentId: string | null
}

declare const __GTAR_DEV_PROVENANCE__: DevBuildProvenance | null | undefined
export const GTAR_DEV_PROVENANCE: DevBuildProvenance = typeof __GTAR_DEV_PROVENANCE__ === 'object' && __GTAR_DEV_PROVENANCE__ !== null
  ? __GTAR_DEV_PROVENANCE__
  : {
      tagStatus: 'UNVERIFIED',
      tagName: null,
      commitSha: 'unknown',
      deploymentId: null,
    };
export const GTAR_SETLIST_VERSION = 1
export const GTAR_SETLIST_TYPE = 'GTAR_SETLIST'

export type SongFormat = 'TWO_LINE' | 'CHORD_PRO' | 'PLAIN'

export interface SongEntity {
  id?: string | number
  title: string
  artist?: string | null
  key?: string | null
  /** Explicit user confirmation of the authored chord basis; never inferred. */
  confirmedChartKey?: string
  originalKey?: string | null
  capo?: string | null
  bpm?: string | null
  time?: string | null
  year?: string | null
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
  catalogSource?: CatalogSetlistLineage
  id: string | number
  name: string
  createdAt?: number
  isDeleted?: boolean
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
    id?: string | number
    name: string
    createdAt: number
    songs: Array<{
      title: string
      artist: string
      id?: string | number
      position: number
    }>
  }>
}

export interface ActiveSongState {
  id?: string | number
  title: string
  artist: string
  key: string
  /** Explicit user confirmation of the authored chord basis; never inferred. */
  confirmedChartKey?: string
  originalKey?: string
  capo: string
  bpm: string
  time?: string
  year?: string
  rawContent: string
  format: SongFormat
  transposeOffset: number
  tags?: string
  isDeleted?: boolean
  isFavorite?: boolean
  createdAt?: number
  lastOpenedAt?: number
  isMissing?: boolean
  sharedSourceSongId?: string
  sharedSourceRevision?: number
  sharedSourcePublisherId?: string
  sharedSourcePublisherName?: string
  publishedCatalogSongId?: string
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
  /** Explicit user confirmation of the authored chord basis; never inferred. */
  confirmedChartKey?: string
  originalKey?: string
  capo: string
  bpm: string
  time?: string
  year?: string
  tags?: string
  format: SongFormat
  lines: SongLine[]
}
