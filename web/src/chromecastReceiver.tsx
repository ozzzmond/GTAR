import { createRoot } from 'react-dom/client'
import { StageCast2Panel } from './components/StageCast2Panel'
import { cast2LocalEnabled } from './utils/stageCast2Local'
import { chromecastAppId, configuredChromecastAppId } from './utils/chromecastConfig'
import './index.css'
import './components/StageCast2Panel.css'

// Receiver-only entry: no AuthGate, controller app, OAuth bootstrap or service worker.
const enabled = Boolean(chromecastAppId(configuredChromecastAppId, cast2LocalEnabled))
createRoot(document.getElementById('root')!).render(enabled
  ? <StageCast2Panel receiver chromecast />
  : <p role="status">Chromecast presentation is disabled.</p>)
