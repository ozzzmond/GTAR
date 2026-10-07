import {
  jsonResponse,
  errorResponse,
  authenticateUserRequest,
  type AuthEnv,
  JSON_HEADERS,
} from '../../lib/authCore.ts'
import { normalizeMusicalKey } from '../../../src/utils/musicalKey.ts'

export interface MetadataEnv extends AuthEnv {
  AI?: {
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>
  }
  GEMINI_API_KEY?: string
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
  originalKey: string
  tempo?: number | string | null
  timeSignature?: string | null
  year?: string | null
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
function validateMetadataPayload(body: unknown): { isValid: boolean; data?: SongMetadataRequest; error?: string } {
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
 * Deterministic metadata lookup via MusicBrainz public recording registry
 */
async function queryMusicBrainz(
  title: string,
  artist?: string
): Promise<{
  matchedTitle: string
  matchedArtist: string
  year?: string
  confidence: 'high' | 'medium' | 'low'
  score: number
} | null> {
  try {
    let query = `recording:"${title.replace(/"/g, '')}"`
    if (artist) {
      query += ` AND artist:"${artist.replace(/"/g, '')}"`
    }
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&limit=5&fmt=json`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'GTAR-Songbook/1.0 (https://github.com/ozzzmond/GTAR)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) return null
    const data = (await res.json()) as {
      recordings?: Array<{
        title: string
        score?: number | string
        'first-release-date'?: string
        'artist-credit'?: Array<{ name?: string }>
      }>
    }

    if (!data.recordings || data.recordings.length === 0) return null
    const first = data.recordings[0]
    const score = Number(first.score) || 0
    if (score < 60) return null

    const matchedTitle = first.title || title
    const matchedArtist = first['artist-credit']?.[0]?.name || artist || ''
    const year = first['first-release-date'] ? first['first-release-date'].slice(0, 4) : undefined
    const confidence: 'high' | 'medium' | 'low' = score >= 90 ? 'high' : score >= 75 ? 'medium' : 'low'

    return {
      matchedTitle,
      matchedArtist,
      year,
      confidence,
      score,
    }
  } catch {
    return null
  }
}

/**
 * Server-side AI metadata resolution using Cloudflare Workers AI or Gemini API if configured
 */
async function queryAiMetadataReconciliation(
  title: string,
  artist: string | undefined,
  currentKey: string | undefined,
  env: MetadataEnv
): Promise<{
  originalKey?: string
  tempo?: number
  timeSignature?: string
  year?: string
  confidence?: 'high' | 'medium' | 'low'
  sourceDescriptor?: string
} | null> {
  const prompt = `You are a music metadata expert. For the song "${title}"${artist ? ` by "${artist}"` : ''}${currentKey ? ` (currently noted in key "${currentKey}")` : ''}:
Identify the original key in which the song was originally recorded/released.
Return ONLY valid JSON matching this schema:
{
  "originalKey": "G", // musical key (e.g. C, G, D, A, E, B, F#, C#, F, Bb, Eb, Ab, Db, Gb, or minor equivalents like Am, Em, Bm, F#m, C#m, G#m, D#m, A#m, Dm, Gm, Cm, Fm, Bbm, Ebm, Abm). Return empty string if unknown.
  "tempo": 120, // integer BPM if known, else null
  "timeSignature": "4/4", // string like "4/4", "3/4", "6/8" if known, else null
  "year": "1975", // 4-digit release year if known, else null
  "confidence": "high" // "high", "medium", or "low"
}`

  // 1. If Cloudflare Workers AI binding is configured
  if (env.AI && typeof env.AI.run === 'function') {
    try {
      const aiRes = (await env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: 'You respond only in strictly formatted JSON.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 256,
      })) as { response?: string }

      const raw = aiRes.response || ''
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          originalKey?: string
          tempo?: number
          timeSignature?: string
          year?: string
          confidence?: 'high' | 'medium' | 'low'
        }
        return {
          originalKey: parsed.originalKey,
          tempo: parsed.tempo ? Number(parsed.tempo) : undefined,
          timeSignature: parsed.timeSignature || undefined,
          year: parsed.year ? String(parsed.year).slice(0, 4) : undefined,
          confidence: parsed.confidence || 'medium',
          sourceDescriptor: 'Workers AI (Llama 3)',
        }
      }
    } catch {
      // Fallback
    }
  }

  // 2. If Gemini API Key is configured in environment secrets
  if (env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(6000),
        }
      )
      if (res.ok) {
        const geminiData = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        }
        const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''
        const parsed = JSON.parse(text) as {
          originalKey?: string
          tempo?: number
          timeSignature?: string
          year?: string
          confidence?: 'high' | 'medium' | 'low'
        }
        return {
          originalKey: parsed.originalKey,
          tempo: parsed.tempo ? Number(parsed.tempo) : undefined,
          timeSignature: parsed.timeSignature || undefined,
          year: parsed.year ? String(parsed.year).slice(0, 4) : undefined,
          confidence: parsed.confidence || 'medium',
          sourceDescriptor: 'Gemini AI',
        }
      }
    } catch {
      // Fallback
    }
  }

  return null
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

  try {
    // 3. Evidence-driven factual lookup via MusicBrainz
    const mbRecord = await queryMusicBrainz(title, artist)

    // 4. Key and musical parameter reconciliation via AI / Provider
    const aiRecord = await queryAiMetadataReconciliation(title, artist || mbRecord?.matchedArtist, currentKey, env)

    const resolvedTitle = mbRecord?.matchedTitle || title
    const resolvedArtist = mbRecord?.matchedArtist || artist || ''
    const resolvedYear = mbRecord?.year || aiRecord?.year || null
    const resolvedTempo = aiRecord?.tempo || null
    const resolvedTime = aiRecord?.timeSignature || null

    let rawKey = aiRecord?.originalKey || ''
    if (!rawKey && currentKey) {
      // If AI did not supply original key, cannot fabricate
      rawKey = ''
    }

    const validatedKey = normalizeMusicalKey(rawKey)

    if (validatedKey) {
      const responsePayload: SongMetadataResponse = {
        success: true,
        status: 'ok',
        metadata: {
          title: resolvedTitle,
          artist: resolvedArtist,
          originalKey: validatedKey,
          tempo: resolvedTempo,
          timeSignature: resolvedTime,
          year: resolvedYear,
          confidence: aiRecord?.confidence || mbRecord?.confidence || 'medium',
          source: [mbRecord ? 'MusicBrainz' : null, aiRecord?.sourceDescriptor || null]
            .filter(Boolean)
            .join(' + ') || 'Metadata Service',
        },
      }
      return jsonResponse(responsePayload, 200)
    }

    // If no valid original key could be verified/discovered
    if (mbRecord) {
      // We found factual song identity but not an authoritative original key
      const responsePayload: SongMetadataResponse = {
        success: true,
        status: 'ambiguous',
        metadata: {
          title: resolvedTitle,
          artist: resolvedArtist,
          originalKey: '',
          tempo: resolvedTempo,
          timeSignature: resolvedTime,
          year: resolvedYear,
          confidence: 'low',
          source: 'MusicBrainz (Key unverified)',
        },
      }
      return jsonResponse(responsePayload, 200)
    }

    const notFoundPayload: SongMetadataResponse = {
      success: true,
      status: 'not_found',
      error: `No authoritative metadata found for "${title}"`,
    }
    return jsonResponse(notFoundPayload, 200)
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal metadata resolution error'
    const errorPayload: SongMetadataResponse = {
      success: false,
      status: 'error',
      error: errorMsg,
    }
    return jsonResponse(errorPayload, 500)
  }
}
