import { useSyncExternalStore } from 'react'
import { Metronome } from 'lucide-react'
import { MetronomePanel } from '../components/MetronomePanel'
import { metronome } from '../utils/metronome'
import { MetronomeHelp } from '../components/stageToolHelp'
import type { StageTool } from './types'

export const metronomeTool: StageTool = {
  id: 'metronome',
  name: 'Metronome',
  Icon: Metronome,
  Panel: MetronomePanel,
  Help: MetronomeHelp,
  stop: () => metronome.stop(),
  useIsRunning: () =>
    useSyncExternalStore(
      listener => metronome.subscribe(listener),
      () => metronome.getState().isRunning,
      () => false,
    ),
}
