import { Guitar } from 'lucide-react'
import { TunerPanel } from '../components/TunerPanel'
import { tunerMic } from '../utils/tunerEngine'
import { tunerTone } from '../utils/tunerTone'
import type { StageTool } from './types'

export const tunerTool: StageTool = {
  id: 'tuner',
  name: 'Tuner',
  Icon: Guitar,
  Panel: TunerPanel,
  stop: () => {
    tunerMic.stop()
    tunerTone.release()
  },
}
