import { enforceAbuseLimit, abuseResponse } from '../../lib/abuseProtection.ts';
import { API_SECURITY_HEADERS } from '../../lib/securityHeaders.ts';
import { validateSharedSetlistPayload, sanitizeSetlistForShare } from '../../../src/utils/sharedSetlist';
import type { D1Database, AuthEnv } from '../../lib/authCore';

export interface Env extends AuthEnv {
  DB?: D1Database;
}

const userShareTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_SHARES_PER_WINDOW = 30;

export function checkUserRateLimit(userId: string, limit = MAX_SHARES_PER_WINDOW): boolean {
  const now = Date.now();
  const timestamps = userShareTimestamps.get(userId) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (validTimestamps.length >= limit) {
    userShareTimestamps.set(userId, validTimestamps);
    return false;
  }
  validTimestamps.push(now);
  userShareTimestamps.set(userId, validTimestamps);
  if (userShareTimestamps.size > 1000) {
    for (const [key, tsList] of userShareTimestamps.entries()) {
      if (tsList.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) {
        userShareTimestamps.delete(key);
      }
    }
  }
  return true;
}

export function _resetRateLimitsForTesting(): void {
  userShareTimestamps.clear();
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
    },
  });
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
    },
  });
};

export const MAX_SHARE_PAYLOAD_BYTES = 1024 * 1024; // 1 MB payload limit

export async function readBoundedJson(
  request: Request,
  maxBytes: number
): Promise<{ data?: unknown; error?: string; status: number }> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const parsedLength = parseInt(contentLength, 10);
    if (!Number.isNaN(parsedLength) && parsedLength > maxBytes) {
      return { error: 'PAYLOAD_TOO_LARGE', status: 413 };
    }
  }

  if (!request.body) {
    try {
      const data = await request.json();
      const stringified = JSON.stringify(data);
      if (stringified.length > maxBytes) {
        return { error: 'PAYLOAD_TOO_LARGE', status: 413 };
      }
      return { data, status: 200 };
    } catch {
      return { error: 'EMPTY_OR_MALFORMED_REQUEST_BODY', status: 400 };
    }
  }

  const reader = request.body.getReader();
  let receivedBytes = 0;
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        receivedBytes += value.byteLength;
        if (receivedBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* best effort */
          }
          return { error: 'PAYLOAD_TOO_LARGE', status: 413 };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { error: 'STREAM_READ_ERROR', status: 400 };
  }

  const totalBuffer = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    totalBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder('utf-8').decode(totalBuffer);
  try {
    return { data: JSON.parse(text), status: 200 };
  } catch {
    return { error: 'MALFORMED_JSON_PAYLOAD', status: 400 };
  }
}

// Shares are anonymous capabilities only (#453 N1). Account-authenticated and pre-anonymous
// "legacy" shares are retired: they are never served and the Authorization header is ignored.
const PUBLIC_SHARE_MODE = 'anonymous-v1';
async function digestCapability(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function randomCapability(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
async function anonymousLimit(env: Env, operation: 'create' | 'read' | 'revoke'): Promise<Response | null> {
  const rejection = await enforceAbuseLimit(env, `share-anonymous-${operation}`);
  if (rejection) return rejection;
  // Conservative per-isolate global fallback also applies when the optional
  // distributed limiter is disabled; never trust caller-supplied identity.
  return checkUserRateLimit(`anonymous-${operation}`, operation === 'read' ? 120 : 30) ? null : abuseResponse(429, 60);
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const rejection = await anonymousLimit(env, 'create');
    if (rejection) return rejection;

    const bodyResult = await readBoundedJson(request, MAX_SHARE_PAYLOAD_BYTES);
    if (bodyResult.error || !bodyResult.data) {
      return jsonResponse({ error: bodyResult.error }, bodyResult.status);
    }

    if (!env.DB) {
      return jsonResponse({ error: 'DATABASE_UNAVAILABLE' }, 503);
    }

    const validated = validateSharedSetlistPayload(bodyResult.data);
    if (!validated.isValid) {
      return jsonResponse({ error: 'INVALID_SHARED_SETLIST_PAYLOAD', details: validated.error }, 400);
    }

    const sanitized = sanitizeSetlistForShare(validated.setlist);

    const now = new Date().toISOString();
    // Anonymous snapshots expire after 3 days.
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    // Token is the SHA-256 of a 256-bit secret held only by the creator. Retry loop handles extremely rare collisions safely without overwriting existing records
    let token = '';
    let revokeSecret = '';
    let inserted = false;
    const maxCollisionAttempts = 3;

    for (let attempt = 0; attempt < maxCollisionAttempts; attempt++) {
      const candidateSecret = randomCapability();
      const candidateToken = await digestCapability(candidateSecret);

      try {
        await env.DB.prepare(
          `INSERT INTO shared_setlists (share_token, setlist_name, payload_json, created_at, expires_at, creator_user_id, is_revoked)
           VALUES (?, ?, ?, ?, ?, ?, 0)`
        )
          .bind(candidateToken, sanitized.name, JSON.stringify({ ...sanitized, shareAccess: PUBLIC_SHARE_MODE }), now, expiresAt, null)
          .run();
        token = candidateToken;
        revokeSecret = candidateSecret;
        inserted = true;
        break;
      } catch (insertErr: unknown) {
        const msg = String(insertErr);
        if (msg.includes('UNIQUE constraint failed') || msg.includes('PRIMARY KEY')) {
          continue;
        }
        throw insertErr;
      }
    }

    if (!inserted) {
      return jsonResponse({ error: 'FAILED_TO_CREATE_SHARE' }, 500);
    }

    return jsonResponse({
      token,
      name: sanitized.name,
      songCount: sanitized.songs.length,
      revokeSecret,
      expiresAt,
    });
  } catch (err: unknown) {
    console.error('Failed to create shared setlist:', err instanceof Error ? err.name : 'UnknownError');
    return jsonResponse({ error: 'FAILED_TO_CREATE_SHARE' }, 500);
  }
};

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) {
      return jsonResponse({ error: 'INVALID_OR_MISSING_TOKEN' }, 400);
    }
    // Pre-anonymous share tokens were 16-63 hex chars and required an account; they are retired.
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return jsonResponse({ error: 'LEGACY_SHARE_RETIRED' }, 410);
    }

    if (!env.DB) {
      return jsonResponse({ error: 'DATABASE_UNAVAILABLE' }, 503);
    }

    const rejection = await anonymousLimit(env, 'read');
    if (rejection) return rejection;

    const row = await env.DB.prepare(
      `SELECT payload_json, expires_at, creator_user_id, is_revoked FROM shared_setlists WHERE share_token = ?`
    )
      .bind(token.toLowerCase())
      .first<{
        payload_json: string;
        expires_at: string | null;
        creator_user_id?: string | null;
        is_revoked?: number | null;
      }>();

    if (!row) {
      return jsonResponse({ error: 'SHARED_SETLIST_NOT_FOUND' }, 404);
    }

    const payload = JSON.parse(row.payload_json);
    if (row.creator_user_id || payload.shareAccess !== PUBLIC_SHARE_MODE) {
      return jsonResponse({ error: 'LEGACY_SHARE_RETIRED' }, 410);
    }

    if (row.is_revoked === 1) {
      return jsonResponse({ error: 'SHARED_SETLIST_REVOKED' }, 410);
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: 'SHARED_SETLIST_EXPIRED' }, 410);
    }

    const validated = validateSharedSetlistPayload(payload);
    if (!validated.isValid) {
      return jsonResponse({ error: 'CORRUPTED_SHARED_SETLIST' }, 500);
    }

    return jsonResponse({
      setlist: validated.setlist,
      token,
    });
  } catch (err: unknown) {
    console.error('Failed to fetch shared setlist:', err instanceof Error ? err.name : 'UnknownError');
    return jsonResponse({ error: 'FAILED_TO_FETCH_SHARE' }, 500);
  }
};

export async function handleRevokeShare(request: Request, env: Env): Promise<Response> {
  try {
    return await revokeAnonymousShare(request, env);
  } catch (err: unknown) {
    console.error('Failed to revoke shared setlist:', err instanceof Error ? err.name : 'UnknownError');
    return jsonResponse({ error: 'FAILED_TO_REVOKE_SHARE' }, 500);
  }
}

export const onRequestDelete = async ({ request, env }: { request: Request; env: Env }) => {
  return handleRevokeShare(request, env);
};

async function revokeAnonymousShare(request: Request, env: Env): Promise<Response> {
  const rejection = await anonymousLimit(env, 'revoke');
  if (rejection) return rejection;
  const body = await readBoundedJson(request, 16 * 1024);
  if (body.error) return jsonResponse({ error: body.error }, body.status);
  const { token, revokeSecret } = (body.data || {}) as Record<string, unknown>;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
      typeof revokeSecret !== 'string' || !/^[a-f0-9]{64}$/.test(revokeSecret) ||
      await digestCapability(revokeSecret) !== token) {
    return jsonResponse({ error: 'FORBIDDEN_NOT_SHARE_OWNER' }, 403);
  }
  if (!env.DB) return jsonResponse({ error: 'DATABASE_UNAVAILABLE' }, 503);
  const row = await env.DB.prepare('SELECT payload_json, creator_user_id FROM shared_setlists WHERE share_token = ?')
    .bind(token).first<{ payload_json: string; creator_user_id: string | null }>();
  if (!row) return jsonResponse({ error: 'SHARED_SETLIST_NOT_FOUND' }, 404);
  if (row.creator_user_id || JSON.parse(row.payload_json).shareAccess !== PUBLIC_SHARE_MODE) {
    return jsonResponse({ error: 'FORBIDDEN_NOT_SHARE_OWNER' }, 403);
  }
  await env.DB.prepare('UPDATE shared_setlists SET is_revoked = 1, revoked_at = ? WHERE share_token = ?')
    .bind(new Date().toISOString(), token).run();
  return jsonResponse({ success: true, revoked: true, token });
}
