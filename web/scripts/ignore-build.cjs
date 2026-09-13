#!/usr/bin/env node
/**
 * Cloudflare Pages Build Ignore Rule
 *
 * Exit 0 = Cloudflare Pages SKIPS the build
 * Exit 1 = Cloudflare Pages PROCEEDS with the build
 *
 * Authoritative deployment branches:
 * - 'main': Production deployment -> https://gtar-web.pages.dev
 * - 'dev':  Dev preview deployment -> https://dev.gtar-web.pages.dev
 *
 * All tag pushes (e.g. web-v1.0.87-dev.X, app-v1.0.87-dev.X) and detached/unaliased refs
 * are skipped to eliminate duplicate/racing builds and unaliased preview URLs.
 */

const branch = process.env.CF_PAGES_BRANCH || ''

if (!branch) {
  // Local development or non-Cloudflare environment: proceed
  process.exit(1)
}

if (branch === 'main' || branch === 'dev') {
  console.log(`[Cloudflare Pages] Authoritative branch '${branch}' detected. Proceeding with build.`)
  process.exit(1)
}

console.log(`[Cloudflare Pages] Non-authoritative ref '${branch}' detected (tag or unaliased ref). Skipping redundant build.`)
process.exit(0)
