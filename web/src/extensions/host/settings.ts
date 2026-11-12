import type { ExtensionManifest, ExtensionSettings, SettingField } from '../contract'
export type ExtensionStorage = Pick<Storage, 'getItem' | 'setItem'>
export const extensionStorageKey = (id: string) => `gtar_ext_${id}_v1`
export function validSetting(field: SettingField, value: unknown): value is string | number | boolean {
  switch (field.type) {
    case 'boolean': return typeof value === 'boolean'
    case 'secret': case 'text': case 'host': return typeof value === 'string'
    case 'select': return typeof value === 'string' && field.options.some(option => option.value === value)
    case 'port': case 'number': return typeof value === 'number' && Number.isFinite(value) &&
      (field.type !== 'port' || (Number.isInteger(value) && value >= 1 && value <= 65535)) &&
      (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max)
  }
}
export function normalizeSettings(manifest: ExtensionManifest, raw: unknown): ExtensionSettings {
  const values = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return Object.freeze(Object.fromEntries(manifest.settings.map(field => {
    const value = values[field.key]
    return [field.key, validSetting(field, value) ? value : field.type === 'secret' ? '' : field.default]
  })))
}
export function readExtension(manifest: ExtensionManifest, storage: ExtensionStorage) {
  try {
    const raw = JSON.parse(storage.getItem(extensionStorageKey(manifest.id)) ?? '{}')
    return { enabled: raw?.enabled === true, settings: normalizeSettings(manifest, raw?.settings), writable: true }
  } catch {
    return { enabled: false, settings: normalizeSettings(manifest, null), writable: false }
  }
}
