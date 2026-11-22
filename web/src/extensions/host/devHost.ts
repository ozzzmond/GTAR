/** DEV and preview hosts only: every subdomain of gtar-web.pages.dev (dev and per-branch previews), never the PROD host itself.
 * Kept local (not utils/env.ts) so plain Node tests can import it. */
export function isDevHost(hostname: string | undefined): boolean {
  return typeof hostname === 'string' && (hostname.endsWith('.gtar-web.pages.dev') || hostname === 'localhost' || hostname === '127.0.0.1')
}
