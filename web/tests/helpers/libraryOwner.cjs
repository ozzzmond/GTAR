// Historical owner metadata fixture; production catalog actions no longer use this key.
// Requires the TypeScript require hook of the calling test file.
const OWNER_KEY = 'gtar_library_owner_v1'
// Storage fixtures retain historical owner bytes alongside a session; catalog actions ignore those bytes.
function bindOwner(storage, userId) {
  const env = typeof location !== 'undefined' && location.host ? location.host : 'unknown'
  storage.setItem(OWNER_KEY, JSON.stringify({ v: 1, userId, env, boundAt: 0, reason: 'confirmed' }))
  if (storage.getItem(SESSION_KEY) === null) storage.setItem(SESSION_KEY, JSON.stringify({ user: { id: userId }, sessionToken: 'token' }))
}
const SESSION_KEY = 'gtar_auth_session'
module.exports = { bindOwner, OWNER_KEY }
