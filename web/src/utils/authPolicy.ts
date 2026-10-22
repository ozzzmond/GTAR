export type UserRole = 'SUPER_ADMIN' | 'USER' | 'NONE'

// Roles and access are server-authoritative (D1 users.role / users.access_status).
// The client keeps no email allowlist and never elevates a role from local data.

export function allowLocalBypass(dev: boolean, hostname: string): boolean {
  return dev && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
}
