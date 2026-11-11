import { jsonResponse, JSON_HEADERS } from '../../lib/authCore.ts'

/**
 * Songbook cloud sync is retired (#453 N1). Backup and restore are local files only;
 * the endpoint stays as an explicit 410 so cached clients get a clear answer, not an SPA page.
 */
const retired = (): Response => jsonResponse({ error: 'SONGBOOK_SYNC_RETIRED' }, 410)

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { status: 204, headers: JSON_HEADERS })
}
export const onRequestGet = async (): Promise<Response> => retired()
export const onRequestPost = async (): Promise<Response> => retired()
export const onRequestPut = async (): Promise<Response> => retired()
export const onRequestDelete = async (): Promise<Response> => retired()
