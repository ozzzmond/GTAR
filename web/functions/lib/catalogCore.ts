import {
  type AuthEnv,
  type D1Database,
  type UserRecord,
  readBoundedJson,
} from './authCore.ts'

export interface CatalogEnv extends AuthEnv {
  DB?: D1Database
}

export interface PagesContext<Params = Record<string, string>> {
  request: Request
  env: CatalogEnv
  params: Params
}

export interface SharedCatalogSongRecord {
  id: string
  title: string
  artist: string | null
  key: string | null
  original_key: string | null
  capo: string | null
  bpm: string | null
  time_signature: string | null
  year: string | null
  raw_content: string
  format: string
  checksum: string
  publisher_user_id: string
  last_editor_user_id: string
  current_revision: number
  is_deleted: number
  deleted_at: string | null
  deleted_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface SharedCatalogRevisionRecord {
  id: string
  song_id: string
  revision: number
  title: string
  artist: string | null
  key: string | null
  original_key: string | null
  capo: string | null
  bpm: string | null
  time_signature: string | null
  year: string | null
  raw_content: string
  format: string
  checksum: string
  editor_user_id: string
  change_summary: string | null
  created_at: string
}

export const SUPPORTED_FORMATS = ['CHORD_PRO', 'PLAIN'] as const
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number]

export const MAX_PAYLOAD_BYTES = 256 * 1024 // 256 KB
export const MAX_TITLE_LENGTH = 200
export const MAX_ARTIST_LENGTH = 200
export const MAX_FIELD_LENGTH = 50
export const MAX_RAW_CONTENT_LENGTH = 100 * 1024 // 100 KB
export const MAX_CHANGE_SUMMARY_LENGTH = 500

export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 100

export function computeSongChecksum(song: {
  title: string
  artist?: string | null
  key?: string | null
  original_key?: string | null
  capo?: string | null
  bpm?: string | null
  time_signature?: string | null
  year?: string | null
  raw_content: string
  format: string
}): string {
  const canonical = JSON.stringify({
    title: (song.title || '').trim(),
    artist: (song.artist || '').trim(),
    key: (song.key || '').trim(),
    original_key: (song.original_key || '').trim(),
    capo: (song.capo || '').trim(),
    bpm: (song.bpm || '').trim(),
    time_signature: (song.time_signature || '').trim(),
    year: (song.year || '').trim(),
    format: String(song.format || 'CHORD_PRO'),
    raw_content: (song.raw_content || '').replace(/\r\n/g, '\n'),
  })

  let h1 = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    h1 ^= canonical.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193)
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0')

  let h2 = 5381
  for (let i = 0; i < canonical.length; i++) {
    h2 = ((h2 << 5) + h2 + canonical.charCodeAt(i)) | 0
  }
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0')

  return `ck_${part1}${part2}`
}

export function sanitizeCatalogSong(song: SharedCatalogSongRecord) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist ?? null,
    key: song.key ?? null,
    original_key: song.original_key ?? null,
    capo: song.capo ?? null,
    bpm: song.bpm ?? null,
    time_signature: song.time_signature ?? null,
    year: song.year ?? null,
    raw_content: song.raw_content,
    format: song.format,
    checksum: song.checksum,
    publisher_user_id: song.publisher_user_id,
    last_editor_user_id: song.last_editor_user_id,
    current_revision: song.current_revision,
    created_at: song.created_at,
    updated_at: song.updated_at,
  }
}

export function sanitizeCatalogRevision(rev: SharedCatalogRevisionRecord) {
  return {
    id: rev.id,
    song_id: rev.song_id,
    revision: rev.revision,
    title: rev.title,
    artist: rev.artist ?? null,
    key: rev.key ?? null,
    original_key: rev.original_key ?? null,
    capo: rev.capo ?? null,
    bpm: rev.bpm ?? null,
    time_signature: rev.time_signature ?? null,
    year: rev.year ?? null,
    raw_content: rev.raw_content,
    format: rev.format,
    checksum: rev.checksum,
    editor_user_id: rev.editor_user_id,
    change_summary: rev.change_summary ?? null,
    created_at: rev.created_at,
  }
}

export interface ValidatedSongInput {
  title: string
  artist: string | null
  key: string | null
  original_key: string | null
  capo: string | null
  bpm: string | null
  time_signature: string | null
  year: string | null
  raw_content: string
  format: string
  change_summary: string | null
}

export function validateSongInput(body: unknown): { isValid: boolean; data?: ValidatedSongInput; error?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { isValid: false, error: 'Request body must be a JSON object' }
  }

  const obj = body as Record<string, unknown>

  // Title: required string
  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    return { isValid: false, error: 'Title is required and must be non-empty' }
  }
  const title = obj.title.trim()
  if (title.length > MAX_TITLE_LENGTH) {
    return { isValid: false, error: `Title must not exceed ${MAX_TITLE_LENGTH} characters` }
  }

  // Raw Content: required string
  if (typeof obj.raw_content !== 'string' || !obj.raw_content.trim()) {
    return { isValid: false, error: 'raw_content is required and must be non-empty' }
  }
  const raw_content = obj.raw_content.replace(/\r\n/g, '\n')
  if (raw_content.length > MAX_RAW_CONTENT_LENGTH) {
    return { isValid: false, error: `raw_content must not exceed ${MAX_RAW_CONTENT_LENGTH} characters` }
  }

  // Format: optional string, default CHORD_PRO, must be in SUPPORTED_FORMATS
  let format = 'CHORD_PRO'
  if (obj.format !== undefined && obj.format !== null) {
    if (typeof obj.format !== 'string') {
      return { isValid: false, error: 'format must be a string' }
    }
    const fmt = obj.format.trim().toUpperCase()
    if (!SUPPORTED_FORMATS.includes(fmt as SupportedFormat)) {
      return { isValid: false, error: `format must be one of: ${SUPPORTED_FORMATS.join(', ')}` }
    }
    format = fmt
  }

  // Optional string fields validation helper
  const validateOptionalField = (
    val: unknown,
    fieldName: string,
    maxLen: number
  ): { value: string | null; error?: string } => {
    if (val === undefined || val === null) {
      return { value: null }
    }
    if (typeof val !== 'string') {
      return { value: null, error: `${fieldName} must be a string if provided` }
    }
    const trimmed = val.trim()
    if (trimmed.length > maxLen) {
      return { value: null, error: `${fieldName} must not exceed ${maxLen} characters` }
    }
    return { value: trimmed.length > 0 ? trimmed : null }
  }

  const artistRes = validateOptionalField(obj.artist, 'artist', MAX_ARTIST_LENGTH)
  if (artistRes.error) return { isValid: false, error: artistRes.error }

  const keyRes = validateOptionalField(obj.key, 'key', MAX_FIELD_LENGTH)
  if (keyRes.error) return { isValid: false, error: keyRes.error }

  const origKeyRes = validateOptionalField(obj.original_key, 'original_key', MAX_FIELD_LENGTH)
  if (origKeyRes.error) return { isValid: false, error: origKeyRes.error }

  const capoRes = validateOptionalField(obj.capo, 'capo', MAX_FIELD_LENGTH)
  if (capoRes.error) return { isValid: false, error: capoRes.error }

  const bpmRes = validateOptionalField(obj.bpm, 'bpm', MAX_FIELD_LENGTH)
  if (bpmRes.error) return { isValid: false, error: bpmRes.error }

  const timeSigRes = validateOptionalField(obj.time_signature, 'time_signature', MAX_FIELD_LENGTH)
  if (timeSigRes.error) return { isValid: false, error: timeSigRes.error }

  const yearRes = validateOptionalField(obj.year, 'year', MAX_FIELD_LENGTH)
  if (yearRes.error) return { isValid: false, error: yearRes.error }

  const changeSummaryRes = validateOptionalField(obj.change_summary, 'change_summary', MAX_CHANGE_SUMMARY_LENGTH)
  if (changeSummaryRes.error) return { isValid: false, error: changeSummaryRes.error }

  return {
    isValid: true,
    data: {
      title,
      artist: artistRes.value,
      key: keyRes.value,
      original_key: origKeyRes.value,
      capo: capoRes.value,
      bpm: bpmRes.value,
      time_signature: timeSigRes.value,
      year: yearRes.value,
      raw_content,
      format,
      change_summary: changeSummaryRes.value,
    },
  }
}

export async function readJsonBody(request: Request): Promise<{ body?: unknown; error?: string; status?: number }> {
  const readRes = await readBoundedJson(request, MAX_PAYLOAD_BYTES)
  if (readRes.error) {
    if (readRes.status === 413) {
      return { error: 'Payload exceeds maximum allowed size of 256KB', status: 413 }
    }
    if (readRes.error === 'EMPTY_BODY') {
      return { error: 'Request body cannot be empty', status: 400 }
    }
    return { error: 'Malformed JSON payload', status: 400 }
  }
  return { body: readRes.data }
}

export function canModifySong(song: SharedCatalogSongRecord, user: UserRecord): boolean {
  if (user.role === 'admin') return true
  return song.publisher_user_id === user.id
}
