import {
  jsonResponse,
  errorResponse,
  authenticateUserRequest,
  type AuthEnv,
  JSON_HEADERS,
} from '../../lib/authCore.ts'
import { normalizeMusicalKey } from '../../../src/utils/musicalKey.ts'

/**
 * Single source of truth for the Workers AI metadata model.
 * DEV.5a: @cf/meta/llama-3-8b-instruct was retired by Cloudflare on 2026-05-30 (error 5028).
 * To rotate models without code changes, set the optional WORKERS_AI_METADATA_MODEL var.
 */
export const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

/** Known-retired model IDs; never dispatched even if supplied via env override. */
export const RETIRED_WORKERS_AI_MODELS: readonly string[] = [
  '@cf/meta/llama-3-8b-instruct',
  '@cf/meta/llama-3.1-8b-instruct',
]

const WORKERS_AI_MODEL_ID_PATTERN = /^@cf\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export interface MetadataEnv extends AuthEnv {
  AI?: {
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>
  }
  WORKERS_AI_METADATA_MODEL?: string
}

/**
 * Resolves the model ID: valid, non-retired env override wins; otherwise the centralized default.
 */
export function resolveWorkersAiModel(env?: Pick<MetadataEnv, 'WORKERS_AI_METADATA_MODEL'>): string {
  const override = typeof env?.WORKERS_AI_METADATA_MODEL === 'string' ? env.WORKERS_AI_METADATA_MODEL.trim() : ''
  if (override && WORKERS_AI_MODEL_ID_PATTERN.test(override) && !RETIRED_WORKERS_AI_MODELS.includes(override)) {
    return override
  }
  return WORKERS_AI_MODEL
}

interface PagesContext {
  request: Request
  env: MetadataEnv
}

export interface SongMetadataRequest {
  title: string
  artist?: string
  currentKey?: string
}

export interface SongMetadataResult {
  title: string
  artist: string
  originalKey: string | null
  tempo: number | null
  timeSignature: string | null
  year: string | null
  confidence: 'high' | 'medium' | 'low'
  source: string
}

export interface SongMetadataResponse {
  success: boolean
  status: 'ok' | 'not_found' | 'ambiguous' | 'error'
  metadata?: SongMetadataResult
  error?: string
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: JSON_HEADERS,
  })
}

/**
 * Validates request payload boundary
 */
export function validateMetadataPayload(body: unknown): { isValid: boolean; data?: SongMetadataRequest; error?: string } {
  if (!body || typeof body !== 'object') {
    return { isValid: false, error: 'Request body must be a valid JSON object' }
  }
  const obj = body as Record<string, unknown>
  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    return { isValid: false, error: 'Title is required and must be non-empty' }
  }
  if (obj.title.length > 200) {
    return { isValid: false, error: 'Title length must not exceed 200 characters' }
  }

  let artist: string | undefined
  if (obj.artist !== undefined && obj.artist !== null) {
    if (typeof obj.artist !== 'string') {
      return { isValid: false, error: 'Artist must be a string if provided' }
    }
    if (obj.artist.length > 200) {
      return { isValid: false, error: 'Artist length must not exceed 200 characters' }
    }
    artist = obj.artist.trim() || undefined
  }

  let currentKey: string | undefined
  if (obj.currentKey !== undefined && obj.currentKey !== null) {
    if (typeof obj.currentKey !== 'string') {
      return { isValid: false, error: 'currentKey must be a string if provided' }
    }
    if (obj.currentKey.length > 20) {
      return { isValid: false, error: 'currentKey length must not exceed 20 characters' }
    }
    currentKey = obj.currentKey.trim() || undefined
  }

  return {
    isValid: true,
    data: {
      title: obj.title.trim(),
      artist,
      currentKey,
    },
  }
}

/**
 * Detects if the model's matched artist materially conflicts with the user's requested artist.
 * Prevents silent substitution of different artists, recordings, or cover versions.
 */
export function isArtistIdentityMismatch(requested: string, matched: string): boolean {
  const normReq = requested.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normMat = matched.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!normReq || !normMat) return false
  if (normReq === normMat) return false
  if (normReq.includes(normMat) || normMat.includes(normReq)) return false

  const reqTokens = requested.toLowerCase().split(/[\s,./\\&+-]+/).filter(t => t.length >= 3)
  const matTokens = matched.toLowerCase().split(/[\s,./\\&+-]+/).filter(t => t.length >= 3)
  if (reqTokens.length === 0 || matTokens.length === 0) return false

  const hasOverlap = reqTokens.some(t => matTokens.includes(t))
  return !hasOverlap
}

/**
 * Detects if the model's matched title materially conflicts with the user's requested title.
 */
export function isTitleIdentityMismatch(requested: string, matched: string): boolean {
  const normReq = requested.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normMat = matched.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!normReq || !normMat) return false
  if (normReq === normMat) return false
  if (normReq.includes(normMat) || normMat.includes(normReq)) return false

  const reqTokens = requested.toLowerCase().split(/[\s,./\\&+-]+/).filter(t => t.length >= 3)
  const matTokens = matched.toLowerCase().split(/[\s,./\\&+-]+/).filter(t => t.length >= 3)
  if (reqTokens.length === 0 || matTokens.length === 0) return false

  const hasOverlap = reqTokens.some(t => matTokens.includes(t))
  return !hasOverlap
}

/**
 * Builds the strict, uncertainty-tolerant prompt for Workers AI.
 */
export function buildWorkersAiMetadataPrompt(
  title: string,
  artist?: string,
  currentKey?: string
): { system: string; user: string } {
  const system =
    'You are a music metadata catalog assistant. You provide factual studio release metadata and the authoritative original key of the original recording. ' +
    'You MUST NOT guess or hallucinate. If song identity is uncertain, or if the original key is unknown, disputed, or varies across versions, report status "ambiguous" or "not_found" and set originalKey to null. ' +
    'Respond ONLY with a valid JSON object matching the requested schema.'

  const user = `Identify factual metadata and original recording key for:
Title: "${title}"
${artist ? `Artist: "${artist}"` : 'Artist: (unspecified)'}
${currentKey ? `Current Chart Key: "${currentKey}"` : ''}

Strict requirements:
1. Matched Identity: Return matchedTitle and matchedArtist for the original version. If the song cannot be identified with certainty, set status to "not_found".
2. Ambiguity & Covers: If multiple distinct songs share this title, or the artist recording is ambiguous, set status to "ambiguous" and confidence to "low".
3. Original Key: Provide the original key of the original release (standard major or minor, e.g. "C", "G", "Eb", "F#m", "Bbm"). If uncertain or unknown, set originalKey to null. Never fabricate a key.
4. Additional Fields: tempo (integer BPM, e.g. 120), timeSignature (e.g. "4/4"), year (4-digit year string, e.g. "1975"). Set to null if uncertain.
5. Confidence: "high", "medium", or "low".

JSON schema:
{
  "status": "ok" | "ambiguous" | "not_found",
  "matchedTitle": string,
  "matchedArtist": string,
  "originalKey": string | null,
  "tempo": number | null,
  "timeSignature": string | null,
  "year": string | null,
  "confidence": "high" | "medium" | "low"
}`

  return { system, user }
}

/**
 * Validates and reconciles untrusted Workers AI output against strict domain invariants.
 */
export function validateAndReconcileAiOutput(
  rawAiOutput: unknown,
  requestedTitle: string,
  requestedArtist?: string,
  modelId: string = WORKERS_AI_MODEL
): {
  status: 'ok' | 'not_found' | 'ambiguous'
  metadata?: SongMetadataResult
  error?: string
} {
  let rawText = ''
  if (typeof rawAiOutput === 'string') {
    rawText = rawAiOutput
  } else if (rawAiOutput && typeof rawAiOutput === 'object') {
    const response = 'response' in rawAiOutput ? (rawAiOutput as { response: unknown }).response : undefined
    if (typeof response === 'string') {
      rawText = response
    } else if (response && typeof response === 'object') {
      // Newer models may return an already-parsed JSON object in `response`.
      rawText = JSON.stringify(response)
    } else {
      rawText = JSON.stringify(rawAiOutput)
    }
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      status: 'ambiguous',
      error: 'Workers AI returned malformed non-JSON output',
    }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return {
      status: 'ambiguous',
      error: 'Failed to parse Workers AI JSON response',
    }
  }

  const rawStatus = typeof parsed.status === 'string' ? parsed.status.toLowerCase().trim() : ''
  if (rawStatus === 'not_found') {
    return {
      status: 'not_found',
      error: `No authoritative metadata found for "${requestedTitle}"`,
    }
  }

  const matchedTitle =
    typeof parsed.matchedTitle === 'string' && parsed.matchedTitle.trim()
      ? parsed.matchedTitle.trim().slice(0, 200)
      : requestedTitle

  const matchedArtist =
    typeof parsed.matchedArtist === 'string' && parsed.matchedArtist.trim()
      ? parsed.matchedArtist.trim().slice(0, 200)
      : (requestedArtist || '')

  // Identity checks
  const titleMismatch = isTitleIdentityMismatch(requestedTitle, matchedTitle)
  const artistMismatch = requestedArtist ? isArtistIdentityMismatch(requestedArtist, matchedArtist) : false
  const hasIdentityMismatch = titleMismatch || artistMismatch

  // Musical key validation through deterministic GTAR-compatible normalization
  let originalKey: string | null = null
  if (typeof parsed.originalKey === 'string' && parsed.originalKey.trim()) {
    originalKey = normalizeMusicalKey(parsed.originalKey.trim())
  }

  // Confidence enum validation
  let confidence: 'high' | 'medium' | 'low' = 'low'
  if (parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low') {
    confidence = parsed.confidence
  }

  // Tempo bounds validation: 30 to 300 BPM
  let tempo: number | null = null
  if (typeof parsed.tempo === 'number' && Number.isFinite(parsed.tempo) && parsed.tempo >= 30 && parsed.tempo <= 300) {
    tempo = Math.round(parsed.tempo)
  } else if (typeof parsed.tempo === 'string' && /^\d+$/.test(parsed.tempo.trim())) {
    const parsedTempo = parseInt(parsed.tempo.trim(), 10)
    if (parsedTempo >= 30 && parsedTempo <= 300) {
      tempo = parsedTempo
    }
  }

  // Time signature validation
  let timeSignature: string | null = null
  if (typeof parsed.timeSignature === 'string' && /^\d{1,2}\/\d{1,2}$/.test(parsed.timeSignature.trim())) {
    timeSignature = parsed.timeSignature.trim()
  }

  // Year validation: 4-digit
  let year: string | null = null
  if (parsed.year !== undefined && parsed.year !== null) {
    const yStr = String(parsed.year).trim()
    if (/^\d{4}$/.test(yStr)) {
      year = yStr
    }
  }

  let finalStatus: 'ok' | 'ambiguous' = rawStatus === 'ok' ? 'ok' : 'ambiguous'

  if (hasIdentityMismatch) {
    finalStatus = 'ambiguous'
    originalKey = null
    confidence = 'low'
  } else if (!originalKey) {
    finalStatus = 'ambiguous'
    confidence = 'low'
  }

  const source =
    finalStatus === 'ambiguous'
      ? `Workers AI (${modelId}) (Uncertain/Unverified)`
      : `Workers AI (${modelId})`

  return {
    status: finalStatus,
    metadata: {
      title: matchedTitle,
      artist: matchedArtist,
      originalKey,
      tempo,
      timeSignature,
      year,
      confidence,
      source,
    },
  }
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context

  // 1. Strict Bearer authentication boundary
  const authResult = await authenticateUserRequest(request, env)
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status)
  }

  // 2. Parse and validate JSON input
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return errorResponse('Invalid JSON body', 400)
  }

  const validation = validateMetadataPayload(rawBody)
  if (!validation.isValid || !validation.data) {
    return errorResponse(validation.error || 'Validation failed', 400)
  }

  const { title, artist, currentKey } = validation.data

  // 3. Workers AI binding check
  if (!env.AI || typeof env.AI.run !== 'function') {
    return jsonResponse(
      {
        success: false,
        status: 'error',
        error: 'Cloudflare Workers AI binding (env.AI) is not configured',
      },
      503
    )
  }

  // 4. Query Workers AI
  const modelId = resolveWorkersAiModel(env)
  let aiRes: unknown
  try {
    const { system, user } = buildWorkersAiMetadataPrompt(title, artist, currentKey)
    aiRes = await env.AI.run(modelId, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 300,
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Workers AI execution error'
    return jsonResponse(
      {
        success: false,
        status: 'error',
        error: `Workers AI execution failed: ${errorMsg}`,
      },
      500
    )
  }

  // 5. Strict server-side validation and reconciliation
  const result = validateAndReconcileAiOutput(aiRes, title, artist, modelId)

  if (result.status === 'not_found') {
    return jsonResponse(
      {
        success: true,
        status: 'not_found',
        error: result.error || `No authoritative metadata found for "${title}"`,
      },
      200
    )
  }

  if (!result.metadata) {
    return jsonResponse(
      {
        success: false,
        status: 'error',
        error: result.error || 'Invalid metadata resolution from Workers AI',
      },
      500
    )
  }

  return jsonResponse(
    {
      success: true,
      status: result.status,
      metadata: result.metadata,
    },
    200
  )
}
