// Loopback-only, ephemeral P1 review Worker. Never used by a deployment workflow.
const { build } = require('esbuild')
const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
const path = require('node:path')
async function main() {
  const bundle = await build({ stdin: { contents: `
    import { createStageCast2Worker } from './workers/stageCast2Worker.ts';
    export { StageCast2Hub } from './workers/stageCast2Backend.ts';
    export default createStageCast2Worker(async request => request.headers.get('Authorization') === 'Bearer local-test'
      ? { user: { id: 'local-review-owner', access_status: 'active' } } : { error: 'AUTH_REQUIRED', status: 401 });`,
    resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'esm',
    platform: 'browser', external: ['node:crypto'], target: 'es2022' })
  const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 8789, modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'],
    bindings: { CAST2_MODE: 'reviewed-v1', CAST2_ORIGIN: 'https://gtar.test' },
    durableObjects: { CAST2_HUB: { className: 'StageCast2Hub', useSQLite: true } },
  }))
  await mf.ready
  console.info('Stage Cast 2 local review: loopback port 8789; ephemeral test authentication only.')
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void mf.dispose().then(() => process.exit(0)) })
}
main().catch(() => { console.error('Local Stage Cast 2 worker failed.'); process.exitCode = 1 })
