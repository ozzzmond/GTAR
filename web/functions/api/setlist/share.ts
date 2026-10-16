import { enforceAbuseLimit, abuseResponse } from '../../lib/abuseProtection.ts';
import { validateSharedSetlistPayload, sanitizeSetlistForShare } from '../../../src/utils/sharedSetlist';
import { authenticateUserRequest, isValidAuthSecret, verifySessionToken, findUserById } from '../../lib/authCore';
import type { D1Database, AuthEnv, UserRecord } from '../../lib/authCore';

export interface Env extends AuthEnv {
  DB?: D1Database;
}

const userShareTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_SHARES_PER_WINDOW = 30;

export function checkUserRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = userShareTimestamps.get(userId) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (validTimestamps.length >= MAX_SHARES_PER_WINDOW) {
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
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    },
  });
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
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

export async function authenticateShareCaller(
  request: Request,
  env: Env
): Promise<{ user: UserRecord } | { error: string; status: number }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or malformed Authorization header', status: 401 };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { error: 'Empty bearer token', status: 401 };
  }

  if (!isValidAuthSecret(env.AUTH_SECRET)) {
    return { error: 'Authentication service is unavailable', status: 503 };
  }

  // Fast verification for session token: validates signature and claims without exposing D1 state
  const sessionData = await verifySessionToken(token, env.AUTH_SECRET);
  if (sessionData) {
    if (sessionData.status !== 'active' || (sessionData.role !== 'member' && sessionData.role !== 'admin')) {
      return { error: 'Forbidden: Active account approval required', status: 403 };
    }
    if (!env.DB) {
      return { error: 'DATABASE_UNAVAILABLE', status: 503 };
    }
    const auth = await authenticateUserRequest(request, env);
    if ('error' in auth) {
      return auth;
    }
    return { user: auth.user };
  }

  // Fallback: Google ID token or server-verified token
  if (!env.DB) {
    return { error: 'DATABASE_UNAVAILABLE', status: 503 };
  }
  const auth = await authenticateUserRequest(request, env);
  if ('error' in auth) {
    return auth;
  }
  return { user: auth.user };
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const authResult = await authenticateShareCaller(request, env);
    if ('error' in authResult) {
      return jsonResponse({ error: authResult.error }, authResult.status);
    }

    const rejection = await enforceAbuseLimit(env, 'share-create', authResult.user.id);
    if (rejection) return rejection;

    if (!checkUserRateLimit(authResult.user.id)) {
      return abuseResponse(429, 60);
    }

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
    // Default TTL: 30 days
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Generate secure random 128-bit token (16 bytes = 32 hex chars)
    // Retry loop handles extremely rare collisions safely without overwriting existing records
    let token = '';
    let inserted = false;
    const maxCollisionAttempts = 3;

    for (let attempt = 0; attempt < maxCollisionAttempts; attempt++) {
      const randomBytes = new Uint8Array(16);
      crypto.getRandomValues(randomBytes);
      const candidateToken = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      try {
        await env.DB.prepare(
          `INSERT INTO shared_setlists (share_token, setlist_name, payload_json, created_at, expires_at, creator_user_id, is_revoked)
           VALUES (?, ?, ?, ?, ?, ?, 0)`
        )
          .bind(candidateToken, sanitized.name, JSON.stringify(sanitized), now, expiresAt, authResult.user.id)
          .run();
        token = candidateToken;
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
      expiresAt,
    });
  } catch (err: unknown) {
    console.error('Failed to create shared setlist:', err);
    return jsonResponse({ error: 'FAILED_TO_CREATE_SHARE' }, 500);
  }
};

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const authResult = await authenticateShareCaller(request, env);
    if ('error' in authResult) {
      return jsonResponse({ error: authResult.error }, authResult.status);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) {
      return jsonResponse({ error: 'INVALID_OR_MISSING_TOKEN' }, 400);
    }

    if (!env.DB) {
      return jsonResponse({ error: 'DATABASE_UNAVAILABLE' }, 503);
    }

    const rejection = await enforceAbuseLimit(env, 'share-read', authResult.user.id);
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

    if (row.is_revoked === 1) {
      return jsonResponse({ error: 'SHARED_SETLIST_REVOKED' }, 410);
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: 'SHARED_SETLIST_EXPIRED' }, 410);
    }

    // If the share has an authoritative creator, check that the creator has not been denied
    if (row.creator_user_id) {
      const creator = await findUserById(env.DB, row.creator_user_id);
      if (creator && creator.access_status === 'denied') {
        return jsonResponse({ error: 'CREATOR_ACCESS_DENIED' }, 403);
      }
    }

    const payload = JSON.parse(row.payload_json);
    const validated = validateSharedSetlistPayload(payload);
    if (!validated.isValid) {
      return jsonResponse({ error: 'CORRUPTED_SHARED_SETLIST' }, 500);
    }

    return jsonResponse({
      setlist: validated.setlist,
      token,
    });
  } catch (err: unknown) {
    console.error('Failed to fetch shared setlist:', err);
    return jsonResponse({ error: 'FAILED_TO_FETCH_SHARE' }, 500);
  }
};

export async function handleRevokeShare(request: Request, env: Env): Promise<Response> {
  try {
    const authResult = await authenticateShareCaller(request, env);
    if ('error' in authResult) {
      return jsonResponse({ error: authResult.error }, authResult.status);
    }

    const rejection = await enforceAbuseLimit(env, 'share-revoke', authResult.user.id);
    if (rejection) return rejection;

    if (!checkUserRateLimit(authResult.user.id)) {
      return abuseResponse(429, 60);
    }

    let token: string | null = null;
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('token');

    if (request.method === 'POST' || request.method === 'DELETE') {
      const bodyResult = await readBoundedJson(request, 16 * 1024);
      if (bodyResult.data && typeof bodyResult.data === 'object' && !Array.isArray(bodyResult.data)) {
        const rawToken = (bodyResult.data as Record<string, unknown>).token;
        if (typeof rawToken === 'string') {
          token = rawToken.trim();
        }
      }
    }
    if (!token && queryToken) {
      token = queryToken.trim();
    }

    if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) {
      return jsonResponse({ error: 'INVALID_OR_MISSING_TOKEN' }, 400);
    }

    if (!env.DB) {
      return jsonResponse({ error: 'DATABASE_UNAVAILABLE' }, 503);
    }

    const normalizedToken = token.toLowerCase();
    const row = await env.DB.prepare(
      `SELECT share_token, creator_user_id, is_revoked, expires_at FROM shared_setlists WHERE share_token = ?`
    )
      .bind(normalizedToken)
      .first<{
        share_token: string;
        creator_user_id: string | null;
        is_revoked: number | null;
        expires_at: string | null;
      }>();

    if (!row) {
      return jsonResponse({ error: 'SHARED_SETLIST_NOT_FOUND' }, 404);
    }

    const isAdmin = authResult.user.role === 'admin';
    const isOwner = Boolean(row.creator_user_id && row.creator_user_id === authResult.user.id);

    if (!isAdmin && !isOwner) {
      return jsonResponse({ error: 'FORBIDDEN_NOT_SHARE_OWNER' }, 403);
    }

    // Idempotent: already revoked shares return success cleanly
    if (row.is_revoked === 1) {
      return jsonResponse({
        success: true,
        revoked: true,
        token: row.share_token,
        alreadyRevoked: true,
      });
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE shared_setlists
       SET is_revoked = 1, revoked_at = ?, revoked_by_user_id = ?
       WHERE share_token = ?`
    )
      .bind(now, authResult.user.id, row.share_token)
      .run();

    return jsonResponse({
      success: true,
      revoked: true,
      token: row.share_token,
    });
  } catch (err: unknown) {
    console.error('Failed to revoke shared setlist:', err);
    return jsonResponse({ error: 'FAILED_TO_REVOKE_SHARE' }, 500);
  }
}

export const onRequestDelete = async ({ request, env }: { request: Request; env: Env }) => {
  return handleRevokeShare(request, env);
};
