import { createContext, useContext } from 'react'
import type { UserRole } from './authPolicy'
import type { GoogleSession, AccessStatus } from './googleAuth'

interface AuthState {
  session: GoogleSession | null
  signOut: () => void
  signIn: () => Promise<void>
  checkStatus: () => Promise<void>
  ready: boolean
  bypass: boolean
  role: UserRole
  isSuperAdmin: boolean
  accessStatus: AccessStatus
}

export const AuthContext = createContext<AuthState | null>(null)

export function useOptionalGoogleAuth() {
  return useContext(AuthContext)
}
