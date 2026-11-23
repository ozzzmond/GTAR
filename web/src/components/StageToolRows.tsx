import React from 'react'
import { ChevronRight } from 'lucide-react'
import { launcherButton, launcherIcon, launcherRow, launcherSwitch } from './advancedToolsRow'
import { STAGE_TOOLS } from '../stageTools/registry'
import {
  openStageTool,
  setStageToolEnabled,
  useActiveStageTool,
  useEnabledStageTools,
} from '../stageTools/settings'

interface StageToolRowsProps {
  /** Same row style the Advanced Tools popover uses for its other rows. */
  rowClass: string
  /** Notified when a tool is opened from the row, e.g. to close the menu. */
  onOpenTool?: (toolId: string) => void
}

interface StageToolRowProps {
  tool: StageTool
  rowClass: string
  isOn: boolean
  onOpenTool?: (toolId: string) => void
}

const StageToolRow: React.FC<StageToolRowProps> = ({ tool, rowClass, isOn, onOpenTool }) => {
  const activeTool = useActiveStageTool()
  const isRunning = tool.useIsRunning ? tool.useIsRunning() : false

  const handleOpen = () => {
    if (!isOn) setStageToolEnabled(tool, true)
    openStageTool(tool.id)
    onOpenTool?.(tool.id)
  }

  return (
    <div data-testid={`stage-tool-row-${tool.id}`} className={`${launcherRow(rowClass)} justify-between mb-2 last:mb-0`}>
      <button
        type="button"
        data-testid={`stage-tool-open-${tool.id}`}
        aria-haspopup="dialog"
        aria-expanded={activeTool?.id === tool.id}
        onClick={handleOpen}
        className={launcherButton}
      >
        <tool.Icon className={launcherIcon} aria-hidden="true" />
        <span className="flex-1 min-w-0 text-left">{tool.name}</span>
        {isRunning && (
          <span
            data-testid={`stage-tool-row-running-${tool.id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#10B981] mr-1"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" aria-hidden="true" />
            <span>Running</span>
          </span>
        )}
        <ChevronRight className="w-3.5 h-3.5 text-app-muted shrink-0" aria-hidden="true" />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={tool.name}
        data-testid={`settings-stage-tool-${tool.id}`}
        onClick={() => setStageToolEnabled(tool, !isOn)}
        className={`${launcherSwitch} rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent`}
      >
        <span className={`block w-11 h-6 rounded-full transition-colors motion-reduce:transition-none relative p-0.5 border ${isOn ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'}`}>
          <span className={`block w-5 h-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${isOn ? 'translate-x-5' : 'translate-x-0'}`} />
        </span>
      </button>
    </div>
  )
}

/** Advanced Tools rows for the Stage tools: selecting a row opens its panel; the switch toggles toolbar presence. */
export const StageToolRows: React.FC<StageToolRowsProps> = ({ rowClass, onOpenTool }) => {
  const enabled = useEnabledStageTools()

  return STAGE_TOOLS.map(tool => (
    <StageToolRow
      key={tool.id}
      tool={tool}
      rowClass={rowClass}
      isOn={enabled.includes(tool)}
      onOpenTool={onOpenTool}
    />
  ))
}
