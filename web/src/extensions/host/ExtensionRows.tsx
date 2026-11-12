import React from 'react'
import { Layers } from 'lucide-react'
import type { ExtensionHost } from './ExtensionHost'

const labels = { absent: 'Not installed', disabled: 'Off', unavailable: 'Not available on this device/browser', starting: 'Starting', active: 'On', offline: 'Offline', error: 'Error' }
export function ExtensionRows({ host, rowClass }: { host: ExtensionHost; rowClass: string }) {
  return host.entries.map(entry => <ExtensionRow key={entry.manifest.id} host={host} id={entry.manifest.id} rowClass={rowClass} />)
}
function ExtensionRow({ host, id, rowClass }: { host: ExtensionHost; id: string; rowClass: string }) {
  const entry = host.entries.find(entry => entry.manifest.id === id)!
  const snapshot = React.useSyncExternalStore(host.subscribe, () => host.getSnapshot(id))
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const manifest = entry.manifest
  const availability = entry.checkAvailability({ capabilities: ['ui:panel', 'net:lan'] })
  const content = <>
    <Layers className="w-4 h-4 text-app-muted shrink-0" aria-hidden="true" />
    <span className="flex-1 text-left"><span className="block">{manifest.name}</span><span className="block text-app-muted text-[10px]">{manifest.summary}</span></span>
    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-surface text-app-muted ui-secondary-text border border-app-border">{!availability.available ? availability.reason : entry.load ? labels[snapshot.state] : 'Not yet available'}</span>
  </>
  // Manifest-only entries are informational text, with no dead button or toggle.
  if (!entry.load || !availability.available) return <div data-testid={`extension-${id}`} className={rowClass.replace('cursor-pointer', '')}>{content}</div>
  return <div data-testid={`extension-${id}`}>
    <button type="button" className={rowClass} aria-expanded={open} onClick={() => setOpen(!open)}>{content}</button>
    {open && <div className="pl-3 border-l-2 border-app-border/60 my-1 space-y-1">
      <label className={rowClass}><input type="checkbox" checked={['starting', 'active', 'offline'].includes(snapshot.state)} onChange={event => { if (event.target.checked) void host.enable(id); else host.disable(id) }} />Enable {manifest.name}</label>
      {snapshot.message && <p className="text-xs text-app-muted" role="status">{snapshot.message}</p>}
      <form onSubmit={event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const values = Object.fromEntries(manifest.settings.map(field => [field.key,
          field.type === 'boolean' ? data.has(field.key) : field.type === 'number' || field.type === 'port' ? Number(data.get(field.key)) : String(data.get(field.key) ?? ''),
        ]))
        setError(host.saveSettings(id, values) ? '' : 'Settings could not be saved. Check values and device storage.')
      }}>
        {manifest.settings.map(field => <label key={field.key} className="block text-xs text-app-heading mb-2">{field.label}
          {field.type === 'select' ? <select name={field.key} defaultValue={String(snapshot.settings[field.key])} className={rowClass}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'boolean' ?
            <input name={field.key} type="checkbox" defaultChecked={Boolean(snapshot.settings[field.key])} /> :
            <input name={field.key} className={rowClass} type={field.type === 'secret' ? 'password' : field.type === 'number' || field.type === 'port' ? 'number' : 'text'} defaultValue={String(snapshot.settings[field.key])} autoComplete="off" readOnly={'readOnly' in field && field.readOnly} {...(('min' in field || field.type === 'port') ? { min: field.type === 'port' ? Math.max(1, field.min ?? 1) : field.min } : {})} {...(('max' in field || field.type === 'port') ? { max: field.type === 'port' ? Math.min(65535, field.max ?? 65535) : field.max } : {})} />}
          {'note' in field && <span className="block text-app-muted">{field.note}</span>}
        </label>)}
        {manifest.settings.length > 0 && <button type="submit" className={rowClass}>Save settings</button>}
        {error && <p role="alert" className="text-xs text-app-muted">{error}</p>}
      </form>
      {snapshot.panel && <div aria-label={`${manifest.name} follower`} className="space-y-1 text-xs text-app-heading">
        {snapshot.panel.fields.map(field => <div key={field.label}><span className="text-app-muted">{field.label}</span><p className="whitespace-pre-wrap break-words">{field.value}</p></div>)}
        {snapshot.panel.actions.map(action => <button key={action.label} type="button" className={rowClass} disabled={action.disabled} onClick={action.run}>{action.label}</button>)}
      </div>}
    </div>}
  </div>
}
