import { validateSharedSetlistPayload, sanitizeSetlistForShare } from '../../../src/utils/sharedSetlist';
import type { D1Database } from '../../lib/authCore';

interface Env {
  DB?: D1Database;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const rawBody = await request.json();
    const validated = validateSharedSetlistPayload(rawBody);
    if (!validated.isValid) {
      return jsonResponse({ error: 'INVALID_SHARED_SETLIST_PAYLOAD', details: validated.error }, 400);
    }

    const sanitized = sanitizeSetlistForShare(validated.setlist);

    // Generate secure random 16-hex token (8 bytes)
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);
    const token = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const now = new Date().toISOString();
    // Default TTL: 30 days
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO shared_setlists (share_token, setlist_name, payload_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(token, sanitized.name, JSON.stringify(sanitized), now, expiresAt)
        .run();
    }

    return jsonResponse({
      token,
      name: sanitized.name,
      songCount: sanitized.songs.length,
      expiresAt,
    });
  } catch (err: unknown) {
    const details = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'FAILED_TO_CREATE_SHARE', details }, 500);
  }
};

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token || !/^[a-f0-9]{16}$/i.test(token)) {
      return jsonResponse({ error: 'INVALID_OR_MISSING_TOKEN' }, 400);
    }

    if (!env.DB) {
      return jsonResponse({ error: 'DATABASE_UNAVAILABLE' }, 503);
    }

    const row = await env.DB.prepare(
      `SELECT payload_json, expires_at FROM shared_setlists WHERE share_token = ?`
    )
      .bind(token.toLowerCase())
      .first<{ payload_json: string; expires_at: string | null }>();

    if (!row) {
      return jsonResponse({ error: 'SHARED_SETLIST_NOT_FOUND' }, 404);
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: 'SHARED_SETLIST_EXPIRED' }, 410);
    }

    const payload = JSON.parse(row.payload_json);
    const validated = validateSharedSetlistPayload(payload);
    if (!validated.isValid) {
      return jsonResponse({ error: 'CORRUPTED_SHARED_SETLIST', details: validated.error }, 500);
    }

    return jsonResponse({
      setlist: validated.setlist,
      token,
    });
  } catch (err: unknown) {
    const details = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'FAILED_TO_FETCH_SHARE', details }, 500);
  }
};
