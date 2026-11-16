import React from 'react'
import { launcherIcon, launcherRow, launcherSwitch } from './advancedToolsRow'
import { STAGE_TOOLS } from '../stageTools/registry'
import { setStageToolEnabled, useEnabledStageTools } from '../stageTools/settings'

interface StageToolRowsProps {
  /** Same row style the Advanced Tools popover uses for its other rows. */
  rowClass: string
}

/** Advanced Tools rows for the Stage tools: the switch puts the tool's button on the Stage toolbar. */
export const StageToolRows: React.FC<StageToolRowsProps> = ({ rowClass }) => {
  // Nothing here opens a dialog, so each row is a label and its switch.
  const enabled = useEnabledStageTools()
  return STAGE_TOOLS.map(tool => {
    const isOn = enabled.includes(tool)
    return (
      <div key={tool.id} data-testid={`stage-tool-row-${tool.id}`} className={`${launcherRow(rowClass)} justify-between mb-2 last:mb-0`}>
        <div className="flex flex-1 min-w-0 min-h-11 -my-px items-center gap-2.5 text-left">
          <tool.Icon className={launcherIcon} aria-hidden="true" />
          <span className="flex-1 min-w-0">{tool.name}</span>
        </div>
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
  })
}
