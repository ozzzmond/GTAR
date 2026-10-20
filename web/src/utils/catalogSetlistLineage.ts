export interface CatalogSetlistLineage {
  environmentScope: string
  setlistId: string
  revision: number
  checksum?: string
}

export function validateCatalogLineage(value: unknown): asserts value is CatalogSetlistLineage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid catalog lineage')
  const v = value as CatalogSetlistLineage
  if (Object.keys(v).some(k => !['environmentScope', 'setlistId', 'revision', 'checksum'].includes(k)) ||
      typeof v.environmentScope !== 'string' || v.environmentScope.length > 300 ||
      !/^https?:\/\//.test(v.environmentScope) || new URL(v.environmentScope).origin !== v.environmentScope ||
      typeof v.setlistId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(v.setlistId) ||
      !Number.isSafeInteger(v.revision) || v.revision < 1 ||
      (v.checksum !== undefined && (typeof v.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(v.checksum)))) throw new Error('Invalid catalog lineage')
}

export function canonicalCatalogLineage(value?: CatalogSetlistLineage) {
  if (value === undefined) return undefined
  validateCatalogLineage(value)
  return { environmentScope: value.environmentScope, setlistId: value.setlistId, revision: value.revision,
    ...(value.checksum === undefined ? {} : { checksum: value.checksum }) }
}
