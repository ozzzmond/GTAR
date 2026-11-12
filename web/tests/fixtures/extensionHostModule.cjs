// Test-only implementation, deliberately outside src and the production registry.
const probe = globalThis[Symbol.for('gtar.extension-host.fixture')]
probe.loads++
exports.manifest = {
  id: 'lazy-fixture', name: 'Lazy fixture', version: '1.0.0', contractVersion: 1,
  summary: 'Test-only chunk', capabilities: [], settings: [],
}
exports.checkAvailability = () => ({ available: true })
exports.activate = ctx => {
  probe.activations++
  const listener = () => { probe.events++ }
  probe.target.addEventListener('ping', listener)
  probe.listeners++
  const timer = setInterval(() => { probe.ticks++ }, 60000)
  probe.timers++
  const unsubscribe = ctx.settings.subscribe(() => { probe.settingsChanges++ })
  return () => {
    probe.target.removeEventListener('ping', listener)
    probe.listeners--
    clearInterval(timer)
    probe.timers--
    unsubscribe()
    probe.disposals++
  }
}
