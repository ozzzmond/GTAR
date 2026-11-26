import React, { useState } from 'react'
import { ChevronRight, Globe, RotateCcw } from 'lucide-react'
import { AppModal, AppModalSection } from './AppModal'
import { ContextualHelp } from './ContextualHelp'
import { launcherButton, launcherIcon, launcherRow, launcherSwitch } from './advancedToolsRow'
import {
  getProviderAvailability,
  restoreDefaultSettings,
  saveOnlineSourceSettings,
  setSourceEnabled,
  useOnlineSourceSettings,
  type OnlineSourceSettings,
} from '../utils/onlineSourceSettings'

interface OnlineSourcesRowProps {
  /** Same row style the Advanced Tools popover uses for its other rows. */
  rowClass: string
  enabled: boolean
  onToggle: (next: boolean) => void
  /** Opens the app-level dialog owned by the caller. Without it the row owns its dialog. */
  onOpenDialog?: () => void
}

const footerAction =
  'min-h-11 px-3 rounded-xl border border-app-border bg-app-base hover:bg-app-surface text-app-heading text-xs font-semibold flex items-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action'
const statusPill =
  'text-xs font-semibold px-2.5 py-0.5 rounded-full bg-app-surface text-app-muted ui-secondary-text border border-app-border shrink-0'

/**
 * #632: the Online Song Sources launcher row in Advanced Tools. The switch turns online search on
 * or off; the row itself opens the simplified Online Song Sources dialog.
 */
export const OnlineSourcesRow: React.FC<OnlineSourcesRowProps> = ({ rowClass, enabled, onToggle, onOpenDialog }) => {
  const [open, setOpen] = useState(false)

  return (
    <div data-testid="online-sources-row" className="mb-2 last:mb-0">
      <div className={`${launcherRow(rowClass)} justify-between`}>
        <button
          type="button"
          data-testid="online-sources-expand"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (onOpenDialog ? onOpenDialog() : setOpen(value => !value))}
          className={launcherButton}
        >
          <Globe className={launcherIcon} aria-hidden="true" />
          <span className="flex-1 min-w-0">Online Song Sources</span>
          <ChevronRight className="w-4 h-4 text-app-muted shrink-0" aria-hidden="true" />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Online song sources"
          data-testid="settings-online-sources"
          onClick={() => onToggle(!enabled)}
          className={`${launcherSwitch} rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent`}
        >
          <span className={`block w-11 h-6 rounded-full transition-colors relative p-0.5 border ${enabled ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>
      {!onOpenDialog && open && <OnlineSourcesDialog onClose={() => setOpen(false)} />}
    </div>
  )
}

interface OnlineSourcesDialogProps {
  onClose: () => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

/** Online Song Sources as an application-level dialog; mounted only while open. */
export const OnlineSourcesDialog: React.FC<OnlineSourcesDialogProps> = ({ onClose, returnFocusRef }) => {
  const settings = useOnlineSourceSettings()
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [status, setStatus] = useState('')

  const save = (next: OnlineSourceSettings, message?: string) => {
    saveOnlineSourceSettings(next)
    if (message) setStatus(message)
  }

  const restore = confirmRestore ? (
    <div className="mr-auto flex flex-wrap items-center gap-2" role="group" aria-label="Confirm restore defaults">
      <button
        type="button"
        className={footerAction}
        onClick={() => {
          save(restoreDefaultSettings(), 'Defaults restored.')
          setConfirmRestore(false)
        }}
      >
        Restore defaults
      </button>
      <button
        type="button"
        className="min-h-11 rounded-xl px-3 text-xs text-app-muted hover:text-app-heading cursor-pointer"
        onClick={() => setConfirmRestore(false)}
      >
        Cancel
      </button>
    </div>
  ) : (
    <button type="button" onClick={() => setConfirmRestore(true)} className={`${footerAction} mr-auto`}>
      <RotateCcw className="w-4 h-4" aria-hidden="true" />
      <span>Restore Defaults</span>
    </button>
  )

  return (
    <AppModal
      onClose={onClose}
      title="Online Song Sources"
      titleId="online-sources-modal-title"
      icon={<Globe className="w-4 h-4" aria-hidden="true" />}
      panelId="online-sources-panel"
      testId="online-sources-panel"
      backdropTestId="online-sources-modal-backdrop"
      returnFocusRef={returnFocusRef}
      footerActions={restore}
      headerActions={
        <ContextualHelp
          id="online-sources-help"
          title="Online Sources"
          buttonLabel="Help for sources"
          buttonTestId="online-sources-help-button"
          panelTestId="online-sources-help"
          quickSummary="Choose which integrated online chord providers GTAR searches alongside your local songbook."
          topics={[
            {
              title: 'Providers',
              defaultExpanded: true,
              content: (
                <>
                  <p>Enable or disable each provider independently. Enabled and available providers are searched concurrently.</p>
                  <p>If no online provider is enabled, search stays local to your songbook.</p>
                </>
              ),
            },
            {
              title: 'Availability',
              content: (
                <p>Unavailable providers are pending automated-access verification and cannot be enabled until permitted.</p>
              ),
            },
          ]}
        />
      }
    >
      <AppModalSection title="Sources">
        <ul data-testid="manage-sources-list" className="space-y-2">
          {settings.sources.map((source) => {
            const availability = getProviderAvailability(source.id)
            const isAvailable = availability.permitted
            const isChecked = isAvailable && source.enabled

            return (
              <li
                key={source.id}
                data-testid={`manage-source-${source.id}`}
                className={`rounded-xl border px-3 py-2 ${
                  isAvailable && isChecked
                    ? 'border-app-border bg-app-base'
                    : 'border-app-border/60 bg-app-base/50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <label
                    className={`flex min-h-11 flex-1 min-w-0 items-center gap-3 text-sm font-semibold ${
                      isAvailable ? 'cursor-pointer text-app-heading' : 'cursor-not-allowed text-app-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!isAvailable}
                      onChange={(event) =>
                        save(
                          setSourceEnabled(settings, source.id, event.target.checked),
                          `${source.name} ${event.target.checked ? 'enabled' : 'disabled'}.`
                        )
                      }
                      aria-label={`Enable ${source.name}`}
                      className="h-4 w-4 shrink-0 accent-app-action disabled:opacity-50"
                    />
                    <span className="min-w-0 break-words">{source.name}</span>
                  </label>
                  {!isAvailable && (
                    <span data-testid={`provider-unavailable-${source.id}`} className={statusPill}>
                      Unavailable
                    </span>
                  )}
                </div>
                {!isAvailable && availability.reason && (
                  <p className="pl-7 text-xs text-app-muted">{availability.reason}</p>
                )}
              </li>
            )
          })}
        </ul>
      </AppModalSection>

      <p role="status" aria-live="polite" data-testid="manage-sources-status" className="sr-only">
        {status}
      </p>
    </AppModal>
  )
}
