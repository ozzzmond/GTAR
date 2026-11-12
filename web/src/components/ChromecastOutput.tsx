import { useEffect, useSyncExternalStore } from 'react'
import { Cast } from 'lucide-react'
import { chromecastSender } from '../utils/chromecastSender'
import { stageCast2Controller } from '../utils/stageCast2Controller'

const subscribeCast2 = (listener: () => void) => stageCast2Controller.subscribe(listener)
const cast2Status = () => stageCast2Controller.getView().state

export function ChromecastOutput() {
  const view = useSyncExternalStore(chromecastSender.subscribe, chromecastSender.getView, chromecastSender.getView)
  const syncState = useSyncExternalStore(subscribeCast2, cast2Status, () => 'IDLE')
  useEffect(() => { void chromecastSender.initialize() }, [])
  if (!chromecastSender.supported() || view.state === 'idle') return null
  // SDK unavailability never leaves an inert picker on unsupported browsers.
  if (view.state === 'unavailable') return <p role="status" className="text-xs text-app-muted">Google Chromecast unavailable. Use Browser / QR pairing.</p>
  const active = Boolean(view.device)
  const status = view.state === 'connected'
    ? syncState === 'CONNECTED' ? `Connected to ${view.device}` : `Chromecast: ${syncState.replaceAll('_', ' ').toLowerCase()}`
    : view.state === 'connecting' ? 'Connecting to Chromecast…' : 'Choose a Chromecast TV on the same Wi-Fi.'
  return <section aria-labelledby="chromecast-output-title" className="space-y-3 p-4 rounded-lg bg-app-surface/60 border border-app-border">
    <h3 id="chromecast-output-title" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-app-action"><Cast className="w-4 h-4" />Google Chromecast</h3>
    <p role="status" aria-live="polite" className="text-xs text-app-muted">{status}</p>
    <p className="text-xs text-app-muted">Present on the TV while keeping Stage Controls on this device.</p>
    {view.error && <p role="alert" className="text-xs text-status-error">{view.error}</p>}
    <div className="flex flex-wrap gap-2">
      {!active && <button type="button" disabled={view.state === 'connecting'} onClick={() => void chromecastSender.connect()}
        className="min-h-11 px-3 py-2 text-xs font-bold rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 disabled:opacity-50 cursor-pointer">{view.reconnect ? 'Reconnect Chromecast' : 'Connect Chromecast'}</button>}
      {active && <button type="button" onClick={() => void chromecastSender.disconnect()}
        className="min-h-11 px-3 py-2 text-xs font-bold rounded-lg bg-app-base border border-app-border cursor-pointer">Disconnect Chromecast</button>}
      {active && view.state === 'error' && <p className="text-xs text-app-muted">Disconnect, then choose Connect Chromecast to pair again.</p>}
    </div>
  </section>
}
