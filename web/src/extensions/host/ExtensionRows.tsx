import React from 'react'
import { Layers, ChevronDown, ChevronUp } from 'lucide-react'
import { ContextualHelp } from '../../components/ContextualHelp'
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

export function ExtensionRows({ host, rowClass }: { host: ExtensionHost; rowClass: string }) {
  return host.entries.map(entry => (
    <ExtensionRow key={entry.manifest.id} host={host} id={entry.manifest.id} rowClass={rowClass} />
  ))
}

function ExtensionRow({ host, id, rowClass }: { host: ExtensionHost; id: string; rowClass: string }) {
  const entry = host.entries.find(e => e.manifest.id === id)!
  const snapshot = React.useSyncExternalStore(
    host.subscribe,
    () => host.getSnapshot(id),
    () => host.getSnapshot(id)
  )
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const [rememberServer, setRememberServer] = React.useState(() => host.getRememberLastServer(id))
  const manifest = entry.manifest
  const availability = entry.checkAvailability({ capabilities: ['ui:panel', 'net:lan'] })
  const isEnabled = ['starting', 'active', 'offline'].includes(snapshot.state)

  const statusBadge = (
    <span
      className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
        snapshot.state === 'active'
          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
          : snapshot.state === 'starting'
          ? 'bg-amber-400/15 text-amber-400 border-amber-400/30'
          : snapshot.state === 'offline'
          ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
          : 'bg-app-surface text-app-muted border-app-border'
      }`}
    >
      {!availability.available ? availability.reason : entry.load ? labels[snapshot.state] : 'Not yet available'}
    </span>
  )

  const content = (
    <>
      <Layers className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0 text-left">
        <span className="block text-xs font-bold text-app-heading truncate">{manifest.name}</span>
        <span className="block text-app-muted text-[10px] truncate">{manifest.summary}</span>
      </div>
      {statusBadge}
      {open ? (
        <ChevronUp className="w-3.5 h-3.5 text-app-muted shrink-0 ml-1.5" aria-hidden="true" />
      ) : (
        <ChevronDown className="w-3.5 h-3.5 text-app-muted shrink-0 ml-1.5" aria-hidden="true" />
      )}
    </>
  )

  // Manifest-only or unavailable entries are informational text, with no dead button or toggle.
  if (!entry.load || !availability.available) {
    return (
      <div data-testid={`extension-${id}`} className="rounded-xl border border-app-border/80 bg-app-surface/50 overflow-hidden mb-2">
        <div className={`${rowClass.replace('cursor-pointer', '')} p-2.5 flex items-center justify-between`}>
          <div className="flex flex-1 min-w-0 items-center gap-2.5">
            <Layers className="w-4 h-4 text-app-muted shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0 text-left">
              <span className="block text-xs font-bold text-app-heading truncate">{manifest.name}</span>
              <span className="block text-app-muted text-[10px] truncate">{manifest.summary}</span>
            </div>
            {statusBadge}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid={`extension-${id}`} className="rounded-xl border border-app-border/80 bg-app-surface/50 overflow-hidden mb-2">
      <div className={`${rowClass.replace('cursor-pointer', '')} justify-between p-2.5`}>
        <button
          type="button"
          data-testid={`extension-${id}-expand`}
          className="flex flex-1 min-w-0 min-h-11 items-center gap-2.5 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action rounded-lg"
          aria-expanded={open}
          aria-controls={`extension-${id}-panel`}
          onClick={() => setOpen(!open)}
        >
          {content}
        </button>

        {/* Master ON/OFF Switch */}
        <label
          className="relative inline-flex items-center cursor-pointer min-w-[44px] min-h-[44px] justify-center select-none"
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
      </div>

      {open && (
        <div
          id={`extension-${id}-panel`}
          className="pl-3 border-l-2 border-app-border/60 my-1 space-y-3 p-2.5 bg-app-base/40 rounded-r-xl"
        >
          {/* Panel Header with Contextual Help */}
          <div className="flex items-center justify-between gap-2 border-b border-app-border/40 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-app-heading">{manifest.name}</span>
              <span
                className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                  snapshot.state === 'active'
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : snapshot.state === 'starting'
                    ? 'bg-amber-400/15 text-amber-400 border-amber-400/30'
                    : snapshot.state === 'offline'
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    : 'bg-app-surface text-app-muted border-app-border'
                }`}
              >
                {labels[snapshot.state]}
              </span>
            </div>

            {id === 'propresenter-follower' && (
              <ContextualHelp
                id="propresenter-help"
                title="ProPresenter"
                buttonLabel="Help for ProPresenter"
                buttonTestId="propresenter-help-button"
                panelTestId="propresenter-help"
                quickSummary="Follow live lyrics and slides automatically from your ProPresenter presentation computer over the local network."
                topics={[
                  {
                    title: 'Status Indicators',
                    content: (
                      <p>
                        <strong className="text-app-heading">Indicators:</strong> Green = following live lyrics; Yellow = paused / manual override / awaiting resumption; Red = disconnected.
                      </p>
                    ),
                  },
                  {
                    title: 'Auto Follow',
                    content: (
                      <p>
                        <strong className="text-app-heading">Auto Follow:</strong> Operates strictly within the active GTAR setlist to keep lyrics and slides aligned.
                      </p>
                    ),
                  },
                  {
                    title: 'Manual Override',
                    content: (
                      <p>
                        <strong className="text-app-heading">Manual Override:</strong> Touching, scrolling, or jumping sections pauses automatic following without losing slide highlights.
                      </p>
                    ),
                  },
                  {
                    title: 'Resuming Following',
                    content: (
                      <p>
                        <strong className="text-app-heading">Resume:</strong> Tap Resume in the ProPresenter popover to re-align with the current slide.
                      </p>
                    ),
                  },
                  {
                    title: 'Stopping Follower',
                    content: (
                      <p>
                        <strong className="text-app-heading">Stop:</strong> Stops Live Lyrics and highlights for the current fullscreen session.
                      </p>
                    ),
                  },
                  {
                    title: 'Network Setup & Troubleshooting',
                    content: (
                      <p>
                        Enter your ProPresenter computer&apos;s IP address and Port (1025). Ensure ProPresenter Network is enabled in its settings and both devices are on the same Wi-Fi subnet. Tap &quot;Test connection&quot; below to verify communication.
                      </p>
                    ),
                  },
                ]}
              />
            )}
          </div>

          {snapshot.message && (
            <p className="text-xs text-app-muted px-1" role="status">
              {snapshot.message}
            </p>
          )}

          {/* Settings Form */}
          <form
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
            className="space-y-2.5"
          >
            {manifest.settings.map(field => (
              <div key={field.key} className="space-y-1">
                <label className="block text-xs font-semibold text-app-heading">
                  {field.label}
                  {field.type === 'select' ? (
                    <select
                      name={field.key}
                      defaultValue={String(snapshot.settings[field.key])}
                      className="w-full min-h-11 bg-app-base border border-app-border rounded-xl px-3 py-2 text-xs text-app-heading focus:outline-none focus:border-app-action mt-1"
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
                      className={`w-full min-h-11 bg-app-base border border-app-border rounded-xl px-3 py-2 text-xs text-app-heading placeholder-app-muted/60 focus:outline-none focus:border-app-action mt-1 ${
                        'readOnly' in field && field.readOnly ? 'opacity-70 cursor-not-allowed' : ''
                      }`}
                    />
                  )}
                </label>

                {field.key === 'host' && id === 'propresenter-follower' && (
                  <label className="flex items-center gap-2 mt-1.5 text-xs text-app-muted cursor-pointer select-none">
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
                    <span>Remember last server</span>
                  </label>
                )}

                {'note' in field && (
                  <span className="block text-[10px] text-app-muted mt-0.5">{field.note}</span>
                )}
              </div>
            ))}

            {manifest.settings.length > 0 && (
              <div className="pt-1">
                <button
                  type="submit"
                  data-testid="propresenter-save-settings"
                  className="min-h-11 px-4 rounded-xl bg-app-action text-app-on-action font-semibold text-xs flex items-center justify-center cursor-pointer hover:bg-app-action/90 focus-visible:outline-2 focus-visible:outline-app-action"
                >
                  Save settings
                </button>
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs text-status-error px-1">
                {error}
              </p>
            )}
          </form>

          {/* Status & Live Monitoring Panel */}
          {snapshot.panel && (
            <div
              aria-label={`${manifest.name} follower`}
              className="rounded-xl border border-app-border bg-app-surface p-3 space-y-2 text-xs text-app-heading"
            >
              <div className="space-y-1.5">
                {snapshot.panel.fields.map(field => (
                  <div key={field.label}>
                    <div className="text-[10px] uppercase font-mono tracking-wider text-app-muted">
                      {field.label}
                    </div>
                    <p className="whitespace-pre-wrap break-words font-medium text-app-heading">
                      {field.value}
                    </p>
                  </div>
                ))}
              </div>
              {snapshot.panel.actions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-app-border/40">
                  {snapshot.panel.actions.map(action => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={action.disabled}
                      onClick={action.run}
                      className="min-h-11 px-3.5 rounded-xl border border-app-border bg-app-base hover:bg-app-surface text-app-heading text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
