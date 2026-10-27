// #247: test devices whose library belongs to a given account (as after an explicit "link").
// Requires the TypeScript require hook of the calling test file.
const OWNER_KEY = 'gtar_library_owner_v1'
// #258: an owner-bound library opens only while its owner is signed in, so a linked test device is
// also used by that account (its session in the same storage) unless the test signs in someone else.
function bindOwner(storage, userId) {
  const { libraryEnv } = require('../../src/utils/libraryOwner.ts')
  storage.setItem(OWNER_KEY, JSON.stringify({ v: 1, userId, env: libraryEnv(), boundAt: 0, reason: 'confirmed' }))
  if (storage.getItem(SESSION_KEY) === null) storage.setItem(SESSION_KEY, JSON.stringify({ user: { id: userId }, sessionToken: 'token' }))
}
const SESSION_KEY = 'gtar_auth_session'
module.exports = { bindOwner, OWNER_KEY }
