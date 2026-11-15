import React from 'react'
import { Layers, ChevronRight } from 'lucide-react'
import { AppModal, AppModalSection } from '../../components/AppModal'
import { ProPresenterHelp } from '../../components/ProPresenterHelp'
import { launcherRow } from '../../components/advancedToolsRow'
import type { ExtensionHost } from './ExtensionHost'

const labels = {
  absent: 'Not installed',
  disabled: 'Off',
  unavailable: 'Not available on this device/browser',
  starting: 'Starting',
  active: 'On',
  offline: 'Offline',
  error: 'Error',
}

const stateBadge = (state: keyof typeof labels) =>
  `text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
    state === 'active'
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      : state === 'starting'
      ? 'bg-amber-400/15 text-amber-400 border-amber-400/30'
      : state === 'offline'
      ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
      : 'bg-app-surface text-app-muted border-app-border'
  }`

function useExtensionSnapshot(host: ExtensionHost, id: string) {
  return React.useSyncExternalStore(host.subscribe, () => host.getSnapshot(id), () => host.getSnapshot(id))
}

interface ExtensionRowsProps {
  host: ExtensionHost
  rowClass: string
  /** Opens the app-level settings dialog owned by the caller. Without it each row owns its dialog. */
  onOpenDialog?: (id: string) => void
}

export function ExtensionRows({ host, rowClass, onOpenDialog }: ExtensionRowsProps) {
  return host.entries.map(entry => (
    <ExtensionRow key={entry.manifest.id} host={host} id={entry.manifest.id} rowClass={rowClass} onOpenDialog={onOpenDialog} />
  ))
}

/** Launcher row: the row opens the settings dialog, the switch only turns the extension on or off. */
function ExtensionRow({ host, id, rowClass, onOpenDialog }: ExtensionRowsProps & { id: string }) {
  const entry = host.entries.find(e => e.manifest.id === id)!
  const snapshot = useExtensionSnapshot(host, id)
  const [open, setOpen] = React.useState(false)
  const manifest = entry.manifest
  const availability = entry.checkAvailability({ capabilities: ['ui:panel', 'net:lan'] })
  const isEnabled = ['starting', 'active', 'offline'].includes(snapshot.state)

  const statusBadge = (
    <span className={`${stateBadge(snapshot.state)} shrink-0`}>
      {!availability.available ? availability.reason : entry.load ? labels[snapshot.state] : 'Not yet available'}
    </span>
  )

  // Manifest-only or unavailable entries are informational text, with no dead button or toggle.
  if (!entry.load || !availability.available) {
    return (
      <div data-testid={`extension-${id}`} className="mb-1.5 last:mb-0">
        <div className={`${launcherRow(rowClass)} flex items-center justify-between`}>
          <div className="flex flex-1 min-w-0 items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-app-surface border border-app-border flex items-center justify-center text-app-muted shrink-0">
              <Layers className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <span className="block text-xs sm:text-sm font-bold text-app-heading">{manifest.name}</span>
              <span className="block text-app-muted text-[10px] sm:text-[11px]">{manifest.summary}</span>
            </div>
            {statusBadge}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid={`extension-${id}`} className={`${launcherRow(rowClass)} justify-between mb-1.5 last:mb-0`}>
        <button
          type="button"
          data-testid={`extension-${id}-expand`}
          className="flex flex-1 min-w-0 min-h-11 items-center gap-2.5 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action rounded-lg"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (onOpenDialog ? onOpenDialog(id) : setOpen(!open))}
        >
          <div className="w-8 h-8 rounded-lg bg-app-action/15 border border-app-action/30 flex items-center justify-center text-app-action shrink-0">
            <Layers className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex flex-1 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs sm:text-sm font-bold text-app-heading">{manifest.name}</span>
            {/* The switch already says on or off; a pill appears only for what it cannot say. */}
            {(snapshot.state === 'starting' || snapshot.state === 'offline' || snapshot.state === 'error') && statusBadge}
          </div>
          {/* Read to assistive tech with the name; the row itself shows the name only. */}
          <span className="sr-only">{manifest.summary}</span>
          <ChevronRight className="w-3.5 h-3.5 text-app-muted shrink-0" aria-hidden="true" />
        </button>

        {/* Master ON/OFF Switch */}
        <label
          className="relative inline-flex items-center cursor-pointer min-w-[44px] min-h-[44px] justify-center select-none ml-2"
          aria-label={`Enable ${manifest.name}`}
        >
          <input
            type="checkbox"
            role="switch"
            data-testid={`settings-${id}-toggle`}
            checked={isEnabled}
            onChange={event => {
              if (event.target.checked) void host.enable(id)
              else host.disable(id)
            }}
            className="sr-only peer"
          />
          <span
            className={`block w-11 h-6 rounded-full transition-colors relative p-0.5 border ${
              isEnabled ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'
            }`}
          >
            <span
              className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                isEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </span>
        </label>
      {!onOpenDialog && open && <ExtensionSettingsDialog host={host} id={id} onClose={() => setOpen(false)} />}
    </div>
  )
}

interface ExtensionSettingsDialogProps {
  host: ExtensionHost
  id: string
  onClose: () => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

/** Extension settings (e.g. ProPresenter) as an application-level dialog; mounted only while open. */
export function ExtensionSettingsDialog({ host, id, onClose, returnFocusRef }: ExtensionSettingsDialogProps) {
  const manifest = host.entries.find(e => e.manifest.id === id)!.manifest
  const snapshot = useExtensionSnapshot(host, id)
  const [error, setError] = React.useState('')
  const [rememberServer, setRememberServer] = React.useState(() => host.getRememberLastServer(id))
  const formId = `extension-${id}-settings-form`

  return (
    <AppModal
      onClose={onClose}
      title={manifest.name}
      titleId={`extension-${id}-modal-title`}
      icon={<Layers className="w-4 h-4" aria-hidden="true" />}
      panelId={`extension-${id}-panel`}
      testId={`extension-${id}-panel`}
      backdropTestId={`extension-${id}-modal-backdrop`}
      returnFocusRef={returnFocusRef}
      footerActions={manifest.settings.length > 0 && (
        <button
          type="submit"
          form={formId}
          data-testid="propresenter-save-settings"
          className="min-h-11 px-4 rounded-xl bg-app-action text-app-on-action font-bold text-xs flex items-center justify-center cursor-pointer hover:bg-app-action/90 focus-visible:outline-2 focus-visible:outline-app-action"
        >
          Save Settings
        </button>
      )}
      headerActions={
        <>
          <span className={`${stateBadge(snapshot.state)} rounded-full px-2`}>{labels[snapshot.state]}</span>
          {id === 'propresenter-follower' && (
            <ProPresenterHelp />
          )}
        </>
      }
    >
      {(manifest.settings.length > 0 || snapshot.message) && <AppModalSection title="Connection">
        {snapshot.message && (
          <p className="text-xs text-app-muted" role="status">
            {snapshot.message}
          </p>
        )}
    <form
      id={formId}
      onSubmit={event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const values = Object.fromEntries(
          manifest.settings.map(field => [
            field.key,
            field.type === 'boolean'
              ? data.has(field.key)
              : field.type === 'number' || field.type === 'port'
              ? Number(data.get(field.key))
              : String(data.get(field.key) ?? ''),
          ])
        )
        setError(
          host.saveSettings(id, values)
            ? ''
            : 'Settings could not be saved. Check values and device storage.'
        )
      }}
      className="space-y-3"
    >
      {manifest.settings.map(field => (
        <div key={field.key} className="space-y-0.5">
          <label className="block text-sm font-semibold text-app-heading">
            {field.label}
            {field.type === 'select' ? (
              <select
                name={field.key}
                defaultValue={String(snapshot.settings[field.key])}
                className="w-full min-h-10 bg-app-base border border-app-border rounded-xl px-3 py-1.5 text-sm font-normal text-app-heading focus:outline-none focus:border-app-action mt-1"
              >
                {field.options.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'boolean' ? (
              <span className="flex items-center gap-2 mt-1">
                <input
                  name={field.key}
                  type="checkbox"
                  defaultChecked={Boolean(snapshot.settings[field.key])}
                  className="h-4 w-4 rounded border-app-border accent-app-action"
                />
              </span>
            ) : (
              <input
                name={field.key}
                type={
                  field.type === 'secret'
                    ? 'password'
                    : field.type === 'number' || field.type === 'port'
                    ? 'number'
                    : 'text'
                }
                defaultValue={String(snapshot.settings[field.key])}
                autoComplete="off"
                placeholder={field.key === 'host' ? 'e.g. 192.168.1.100 or propresenter.local' : ''}
                readOnly={'readOnly' in field && field.readOnly}
                {...(('min' in field || field.type === 'port')
                  ? { min: field.type === 'port' ? Math.max(1, field.min ?? 1) : field.min }
                  : {})}
                {...(('max' in field || field.type === 'port')
                  ? { max: field.type === 'port' ? Math.min(65535, field.max ?? 65535) : field.max }
                  : {})}
                className={`w-full min-h-10 bg-app-base border border-app-border rounded-xl px-3 py-1.5 text-sm font-normal text-app-heading placeholder-app-muted/60 focus:outline-none focus:border-app-action mt-1 ${
                  'readOnly' in field && field.readOnly ? 'opacity-70 cursor-not-allowed' : ''
                }`}
              />
            )}
          </label>

          {field.key === 'host' && id === 'propresenter-follower' && (
            <label className="flex items-center gap-2 min-h-10 text-sm text-app-heading cursor-pointer select-none">
              <input
                type="checkbox"
                name="rememberLastServer"
                data-testid="propresenter-remember-server"
                checked={rememberServer}
                onChange={e => {
                  const next = e.target.checked
                  setRememberServer(next)
                  host.setRememberLastServer(id, next)
                }}
                className="h-4 w-4 rounded border-app-border accent-app-action"
              />
              <span>Remember Last Server</span>
            </label>
          )}

          {'note' in field && (
            <span className="block text-xs text-app-muted">{field.note}</span>
          )}
        </div>
      ))}

      {error && (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      )}
    </form>
      </AppModalSection>}

      {snapshot.panel && (
        <AppModalSection title="Status">
          <div aria-label={`${manifest.name} follower`} className="space-y-2 text-sm text-app-heading">
            {snapshot.panel.qr && <img src={snapshot.panel.qr.src} alt={snapshot.panel.qr.label} width={280} height={280} className="max-w-full" />}
            {snapshot.panel.inputs?.map(input => (
              <label key={input.label} className="block text-sm font-semibold text-app-heading">
                {input.label}
                <input
                  aria-label={input.label}
                  className="w-full min-h-10 bg-app-base border border-app-border rounded-xl px-3 py-1.5 text-sm font-normal text-app-heading focus:outline-none focus:border-app-action mt-1"
                  value={input.value}
                  maxLength={input.maxLength}
                  autoComplete="off"
                  onChange={event => input.change(event.target.value)}
                />
              </label>
            ))}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              {snapshot.panel.fields.map(field => (
                <React.Fragment key={field.label}>
                  <div className="text-xs text-app-muted pt-0.5">{field.label}</div>
                  <div className="whitespace-pre-wrap break-words font-medium text-app-heading">{field.value}</div>
                </React.Fragment>
              ))}
            </div>
            {snapshot.panel.actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {snapshot.panel.actions.map(action => (
                  <button
                    key={action.label}
                    type="button"
                    disabled={action.disabled}
                    onClick={action.run}
                    className="min-h-10 px-3 rounded-xl border border-app-border bg-app-base hover:bg-app-surface text-app-heading text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </AppModalSection>
      )}
    </AppModal>
  )
}
