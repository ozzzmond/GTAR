import { Metronome } from 'lucide-react'
import { MetronomePanel } from '../components/MetronomePanel'
import { metronome } from '../utils/metronome'
import type { StageTool } from './types'

export const metronomeTool: StageTool = {
  id: 'metronome',
  name: 'Metronome',
  Icon: Metronome,
  Panel: MetronomePanel,
  stop: () => metronome.stop(),
}
