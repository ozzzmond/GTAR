// Fake Web MIDI for the #536 tests: no real device and no browser.

/** One input port. `onmidimessage` is a property, as in the browser; `sets` counts every listener attached. */
function fakeInput(id, name, extra = {}) {
  let handler = null
  const port = {
    id, name, manufacturer: 'Fake', type: 'input', state: 'connected', connection: 'closed', sets: 0, closes: 0,
    close() { port.closes++; port.connection = 'closed'; return Promise.resolve(port) },
    /** Sends one message to the attached listener, if any. */
    send(bytes) { handler?.({ data: Uint8Array.from(bytes) }) },
    ...extra,
  }
  Object.defineProperty(port, 'onmidimessage', {
    enumerable: true,
    get: () => handler,
    set(value) { handler = value; if (value) { port.sets++; port.connection = 'open' } },
  })
  return port
}

function fakeAccess(inputs = []) {
  const access = {
    inputs: new Map(inputs.map(port => [port.id, port])), outputs: new Map(), sysexEnabled: false, onstatechange: null,
    /** A port appears, or comes back. */
    plug(port) { port.state = 'connected'; access.inputs.set(port.id, port); access.onstatechange?.({ port }) },
    /** A port goes away but stays listed as disconnected. */
    unplug(port) { port.state = 'disconnected'; port.connection = 'closed'; access.onstatechange?.({ port }) },
    /** A port goes away and is no longer listed. */
    remove(port) { port.state = 'disconnected'; access.inputs.delete(port.id); access.onstatechange?.({ port }) },
  }
  return access
}

const CHROME_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'

/**
 * navigator stand-in. `request()` decides each requestMIDIAccess() answer; `permission` is the
 * permissions.query state, or null for a browser without that query.
 */
function fakeNavigator({ access = fakeAccess(), permission = 'granted', request, ...rest } = {}) {
  const nav = {
    userAgent: CHROME_DESKTOP, platform: 'Linux x86_64', maxTouchPoints: 0, onLine: true,
    access, permission, request, requests: [], queries: [],
    requestMIDIAccess(...args) { nav.requests.push(args); return nav.request ? nav.request(...args) : Promise.resolve(nav.access) },
    permissions: {
      query(descriptor) {
        nav.queries.push(descriptor)
        return nav.permission === null ? Promise.reject(new TypeError('midi is not a permission name')) : Promise.resolve({ state: nav.permission })
      },
    },
    ...rest,
  }
  return nav
}

const domError = name => Object.assign(new Error(name), { name })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
/** Lets pending promises and the lazy engine import finish. */
const settle = async (turns = 6) => { for (let i = 0; i < turns; i++) await new Promise(resolve => setImmediate(resolve)) }
const listenerCount = access => [...access.inputs.values()].filter(port => port.onmidimessage).length
const engineLoaded = () => Object.keys(require.cache).some(file => /[\\/]src[\\/]midi[\\/]engine\.ts$/.test(file))
/** Forgets every loaded web/src/midi module, so the next require starts with MIDI off and no engine. */
const forgetMidiModules = () => { for (const file of Object.keys(require.cache)) if (/[\\/]src[\\/]midi[\\/]/.test(file)) delete require.cache[file] }

/** The status and the listened names of a snapshot, without the device list of the Slice 5 choice. */
const brief = ({ state, devices }) => ({ state, devices })

module.exports = { brief, CHROME_DESKTOP, fakeInput, fakeAccess, fakeNavigator, domError, deferred, settle, listenerCount, engineLoaded, forgetMidiModules }
