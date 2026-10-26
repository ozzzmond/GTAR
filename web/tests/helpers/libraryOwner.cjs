// #247: test devices whose library belongs to a given account (as after an explicit "link").
// Requires the TypeScript require hook of the calling test file.
const OWNER_KEY = 'gtar_library_owner_v1'
function bindOwner(storage, userId) {
  const { libraryEnv } = require('../../src/utils/libraryOwner.ts')
  storage.setItem(OWNER_KEY, JSON.stringify({ v: 1, userId, env: libraryEnv(), boundAt: 0, reason: 'confirmed' }))
}
module.exports = { bindOwner, OWNER_KEY }
