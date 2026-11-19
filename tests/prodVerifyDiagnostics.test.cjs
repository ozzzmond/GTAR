const test = require('node:test')
const assert = require('node:assert/strict')
const { classifyVerificationFailure } = require('../.github/prod_controller.cjs')

test('network failure identifies request stage and safe transport cause', () => {
  const err = new TypeError('fetch failed', { cause: Object.assign(new Error('secret URL'), { code: 'ETIMEDOUT' }) })
  assert.deepEqual(classifyVerificationFailure('runtime-release', err), {
    stage: 'runtime-release', category: 'TRANSPORT', detail: 'ETIMEDOUT'
  })
})

test('unrecognized error text, URL and cause never enter diagnostics', () => {
  const err = new Error('Authorization Bearer super-secret https://example.test/private')
  err.cause = Object.assign(new Error('token-value'), { code: 'SECRET_CODE' })
  assert.deepEqual(classifyVerificationFailure('cloudflare-deployment', err), {
    stage: 'cloudflare-deployment', category: 'CONTRACT', detail: 'CHECK_FAILED'
  })
})

test('HTTP denial, redirect, and temporary HTTP errors stay distinct', () => {
  assert.equal(classifyVerificationFailure('cloudflare-project', Object.assign(new Error('unknown'), { httpStatus: 403 })).category, 'HTTP_DENIED')
  assert.equal(classifyVerificationFailure('runtime-release', Object.assign(new Error('unknown'), { redirectBlocked: true })).category, 'REDIRECT_BLOCKED')
  assert.equal(classifyVerificationFailure('github-policy', Object.assign(new Error('unknown'), { httpStatus: 503 })).category, 'HTTP_TRANSIENT')
})

test('transport classification does not report a generic fetch failure as Zero Trust', () => {
  const classified = classifyVerificationFailure('github-environment', new TypeError('fetch failed'))
  assert.deepEqual(classified, { stage: 'github-environment', category: 'TRANSPORT', detail: 'UNKNOWN' })
})
