export type UserRole = 'SUPER_ADMIN' | 'USER' | 'NONE'

export const DEFAULT_ROOT_ADMIN = 'jlopez3rd@gmail.com'
export const DEFAULT_BUILTIN_ALLOWED = [DEFAULT_ROOT_ADMIN, 'johncriscaculitan01@gmail.com']
export const DEFAULT_AUTHORIZED_EMAILS = DEFAULT_BUILTIN_ALLOWED.join(', ')
const WHITELIST_STORAGE_KEY = 'gtar_authorized_emails_override'

// In-memory set to ensure overrides function reliably even if localStorage is unavailable
let memoryOverrides: Set<string> | null = null

export function getAuthorizedEmailsList(configured?: string): string[] {
  const rawBase = configured !== undefined ? configured : DEFAULT_AUTHORIZED_EMAILS
  const base = rawBase
    .split(/[,;\s]+/)
    .map(val => val.trim().toLowerCase())
    .filter(Boolean)

  if (memoryOverrides === null) {
    memoryOverrides = new Set<string>()
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
        const raw = localStorage.getItem(WHITELIST_STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const cleaned = String(item).trim().toLowerCase()
              if (cleaned) memoryOverrides.add(cleaned)
            }
          }
        }
      }
    } catch {
      // Storage access blocked or corrupt
    }
  }

  const combined = new Set<string>([...base, ...memoryOverrides])
  return Array.from(combined)
}

export function mergeCloudAuthorizedEmails(cloudEmails: string[], configured?: string): string[] {
  if (!Array.isArray(cloudEmails) || cloudEmails.length === 0) {
    return getAuthorizedEmailsList(configured)
  }
  getAuthorizedEmailsList(configured)
  let added = false
  for (const email of cloudEmails) {
    const cleaned = String(email).trim().toLowerCase()
    if (cleaned && !memoryOverrides?.has(cleaned)) {
      memoryOverrides?.add(cleaned)
      added = true
    }
  }
  if (added) {
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem(WHITELIST_STORAGE_KEY, JSON.stringify(Array.from(memoryOverrides ?? [])))
      }
    } catch { /* storage quota or blocked */ }
  }
  return getAuthorizedEmailsList(configured)
}

export function authorizedEmail(email: string, configured?: string): boolean {
  if (!email) return false
  const allowed = getAuthorizedEmailsList(configured)
  return allowed.includes(email.trim().toLowerCase())
}

export function getUserRole(email: string | undefined | null, rootAdminEmail?: string, configuredEmails?: string): UserRole {
  if (!email) return 'NONE'
  const normalizedEmail = email.trim().toLowerCase()
  const root = (rootAdminEmail || DEFAULT_ROOT_ADMIN).trim().toLowerCase()
  if (normalizedEmail === root) return 'SUPER_ADMIN'
  if (configuredEmails !== undefined) {
    return authorizedEmail(normalizedEmail, configuredEmails) ? 'USER' : 'NONE'
  }
  return 'USER'
}

export function addAuthorizedEmail(email: string, configured?: string): string[] {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return getAuthorizedEmailsList(configured)
  // Ensure memoryOverrides is initialized
  getAuthorizedEmailsList(configured)
  memoryOverrides?.add(normalized)
  const current = getAuthorizedEmailsList(configured)
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(WHITELIST_STORAGE_KEY, JSON.stringify(Array.from(memoryOverrides ?? [])))
    }
  } catch { /* storage quota or blocked */ }
  return current
}

export function removeAuthorizedEmail(email: string, configured?: string, rootAdminEmail?: string): string[] {
  const normalized = email.trim().toLowerCase()
  const root = (rootAdminEmail || DEFAULT_ROOT_ADMIN).trim().toLowerCase()
  if (normalized === root) {
    // Root admin can never be removed from whitelist
    return getAuthorizedEmailsList(configured)
  }
  // Ensure memoryOverrides is initialized
  getAuthorizedEmailsList(configured)
  memoryOverrides?.delete(normalized)
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(WHITELIST_STORAGE_KEY, JSON.stringify(Array.from(memoryOverrides ?? [])))
    }
  } catch { /* storage quota or blocked */ }
  return getAuthorizedEmailsList(configured).filter(e => e !== normalized)
}

export function resetAuthorizedEmails(): void {
  memoryOverrides = new Set<string>()
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
      localStorage.removeItem(WHITELIST_STORAGE_KEY)
    }
  } catch { /* storage quota or blocked */ }
}

export function allowLocalBypass(dev: boolean, hostname: string): boolean {
  return dev && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
}

