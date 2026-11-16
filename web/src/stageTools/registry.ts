import { metronomeTool } from './metronomeTool'
import { tunerTool } from './tunerTool'
import type { StageTool } from './types'

/** Every Stage tool, in Advanced Tools and toolbar order. A new tool is one more entry here. */
export const STAGE_TOOLS: readonly StageTool[] = [metronomeTool, tunerTool]
