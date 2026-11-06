// Test-only guard for the Google Identity Services script timeout.
//
// googleAuth.ts arms a 15000 ms rejection timer when the GIS client script is
// requested (web/src/utils/googleAuth.ts:778). jsdom never fires the external
// script's load event, so in tests the timer stays pending after the last
// assertion and keeps the runner process alive for ~15 seconds. Tests still
// observe the same "script unavailable" behavior while they run; this guard
// only records those timers so file teardown can clear an otherwise orphaned
// timer before the process exits.
const GI_SCRIPT_TIMEOUT_MS = 15000
const timers = new Set()
let installed = false

function install() {
  if (installed) return
  installed = true
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = function trackedSetTimeout(callback, delay, ...args) {
    const id = realSetTimeout(callback, delay, ...args)
    if (delay === GI_SCRIPT_TIMEOUT_MS) timers.add(id)
    return id
  }
}

function release() {
  for (const id of timers) clearTimeout(id)
  timers.clear()
}

module.exports = { install, release, GI_SCRIPT_TIMEOUT_MS }
