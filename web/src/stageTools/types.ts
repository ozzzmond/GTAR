import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * A Stage tool: switched on or off in Advanced Tools. While ON it owns one button in the Stage
 * toolbar, which opens its compact panel. To add a tool, write its definition and list it in
 * `registry.ts`; the Advanced Tools row, the toolbar button and the panel shell follow from that.
 */
export interface StageTool {
  /** Stable id; also names the saved on/off setting. */
  id: string
  /** Shown on the Advanced Tools row, the toolbar button and the panel header. */
  name: string
  Icon: LucideIcon
  /** Panel body. The shell supplies the frame, the header and Close. */
  Panel: ComponentType
  /** Releases everything the tool holds (sound, microphone). Runs when it is switched OFF. */
  stop(): void
}
