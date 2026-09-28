import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  X,
  Shield,
  Clock,
  ShieldAlert,
  Check,
  Ban,
  RotateCcw,
  Copy,
  Loader2,
} from 'lucide-react'
import { useGoogleAuth } from './AuthGate'
import { DEFAULT_ROOT_ADMIN } from '../utils/authPolicy'

interface AdminUser {
  id: string
  google_sub: string
  email: string
  display_name: string | null
  picture_url: string | null
  role: 'admin' | 'member'
  access_status: 'pending' | 'active' | 'denied'
  created_at: string
  updated_at: string
  last_login_at: string
}

interface UserManagementModalProps {
  isOpen: boolean
  onClose: () => void
  onUpdateUsers?: () => void
}

type FilterType = 'all' | 'pending' | 'active' | 'denied'

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  onUpdateUsers,
}) => {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [loading, setLoading] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  let sessionToken: string | undefined
  let currentEmail: string | undefined

  try {
    const auth = useGoogleAuth()
    sessionToken = auth.session?.sessionToken || auth.session?.idToken
    currentEmail = auth.session?.user?.email
  } catch {
    // Isolated tests or previews
  }

  const rootAdmin = (import.meta.env.VITE_ROOT_ADMIN_EMAIL as string | undefined) || DEFAULT_ROOT_ADMIN

  const notifyChange = useCallback(() => {
    onUpdateUsers?.()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gtar:auth_updated'))
    }
  }, [onUpdateUsers])

  const loadUsers = useCallback(async () => {
    if (!sessionToken) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${sessionToken}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        let msg = 'Failed to load users'
        try {
          const errData = await res.json()
          if (errData?.error) msg = errData.error
        } catch { /* ignore */ }
        throw new Error(msg)
      }
      const data = (await res.json()) as { success: boolean; users: AdminUser[] }
      setUsers(data.users || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect to D1 admin API'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => {
    if (isOpen) {
      void loadUsers()
      setError('')
      setFilter('all')
    }
  }, [isOpen, loadUsers])

  const handleApprove = async (userId: string) => {
    if (!sessionToken || actionId) return
    setActionId(userId)
    setError('')
    try {
      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err?.error || 'Failed to approve user')
      }
      await loadUsers()
      notifyChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setActionId(null)
    }
  }

  const handleDeny = async (userId: string, email: string) => {
    if (!sessionToken || actionId) return
    if (!window.confirm(`Revoke / Deny access for ${email}?`)) return

    setActionId(userId)
    setError('')
    try {
      const res = await fetch('/api/admin/deny', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err?.error || 'Failed to deny user')
      }
      await loadUsers()
      notifyChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Denial failed')
    } finally {
      setActionId(null)
    }
  }

  const handleRestore = async (userId: string) => {
    if (!sessionToken || actionId) return
    setActionId(userId)
    setError('')
    try {
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err?.error || 'Failed to restore user')
      }
      await loadUsers()
      notifyChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setActionId(null)
    }
  }

  const pendingCount = useMemo(() => users.filter((u) => u.access_status === 'pending').length, [users])
  const activeCount = useMemo(() => users.filter((u) => u.access_status === 'active').length, [users])
  const deniedCount = useMemo(() => users.filter((u) => u.access_status === 'denied').length, [users])

  const filteredUsers = useMemo(() => {
    if (filter === 'all') return users
    return users.filter((u) => u.access_status === filter)
  }, [users, filter])

  const handleCopyEmails = () => {
    const activeEmails = users
      .filter((u) => u.access_status === 'active')
      .map((u) => u.email)
      .join(', ')
    void navigator.clipboard?.writeText(activeEmails).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-xl bg-[#073642] border border-[#1A4A55] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#EEE8D5]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A4A55] bg-[#002B36]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#073642] text-[#2AA198] border border-[#1A4A55]">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#FDF6E3]">D1 Account &amp; Access Control</h2>
              </div>
              <p className="text-xs text-[#93A1A1]">Server-authoritative Google account management</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-[#073642] text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {/* Status Filter Tabs */}
          <div className="flex items-center justify-between gap-2 border-b border-[#1A4A55]/60 pb-3">
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  filter === 'all'
                    ? 'bg-[#2AA198] text-[#002B36]'
                    : 'bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3]'
                }`}
              >
                All ({users.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('pending')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  filter === 'pending'
                    ? 'bg-[#B58900] text-[#002B36]'
                    : 'bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3]'
                }`}
              >
                <span>Pending ({pendingCount})</span>
                {pendingCount > 0 && filter !== 'pending' && (
                  <span className="w-2 h-2 rounded-full bg-[#B58900] animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setFilter('active')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  filter === 'active'
                    ? 'bg-[#10B981] text-[#002B36]'
                    : 'bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3]'
                }`}
              >
                Active ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('denied')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  filter === 'denied'
                    ? 'bg-[#DC322F] text-white'
                    : 'bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3]'
                }`}
              >
                Denied ({deniedCount})
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyEmails}
              className="text-[11px] text-[#2AA198] hover:underline flex items-center gap-1 cursor-pointer shrink-0"
              title="Copy active user emails"
            >
              {copied ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied!' : 'Copy Active'}</span>
            </button>
          </div>

          {error && <p className="text-xs text-[#DC6E67] font-semibold">{error}</p>}

          {/* User List */}
          {loading && users.length === 0 ? (
            <div className="py-8 flex flex-col items-center justify-center text-xs text-[#93A1A1] gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-[#2AA198]" />
              <span>Loading registered accounts from D1...</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#93A1A1]">
              {filter === 'pending'
                ? 'No pending approval requests.'
                : filter === 'denied'
                ? 'No denied accounts.'
                : 'No registered accounts found.'}
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {filteredUsers.map((user) => {
                const isRoot = user.email.toLowerCase() === rootAdmin.toLowerCase()
                const isSelf = user.email.toLowerCase() === (currentEmail || '').toLowerCase()
                const isBusy = actionId === user.id

                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#002B36] border border-[#1A4A55]/60 hover:border-[#1A4A55] transition-colors gap-2"
                  >
                    {/* User Identity */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {user.picture_url ? (
                        <img
                          src={user.picture_url}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded-full border border-[#1A4A55] shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-[#073642] border border-[#1A4A55] flex items-center justify-center text-[#93A1A1] text-xs font-bold shrink-0">
                          {user.email.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-[#FDF6E3] truncate">
                            {user.display_name || user.email}
                          </span>
                          {user.role === 'admin' ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#B58900]/25 text-[#B58900] border border-[#B58900]/30 shrink-0">
                              ADMIN
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#2AA198]/20 text-[#2AA198] border border-[#2AA198]/30 shrink-0">
                              MEMBER
                            </span>
                          )}
                          {user.access_status === 'pending' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#B58900]/20 text-[#B58900] border border-[#B58900]/30 shrink-0 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              <span>PENDING</span>
                            </span>
                          )}
                          {user.access_status === 'denied' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#DC322F]/20 text-[#DC322F] border border-[#DC322F]/30 shrink-0 flex items-center gap-1">
                              <ShieldAlert className="w-2.5 h-2.5" />
                              <span>DENIED</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#93A1A1] font-mono truncate">{user.email}</div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {user.access_status === 'pending' && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleApprove(user.id)}
                            className="px-2.5 py-1 rounded-lg bg-[#2AA198] hover:bg-[#35B8AD] text-[#002B36] font-bold text-xs flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                            title="Approve access"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDeny(user.id, user.email)}
                            className="px-2.5 py-1 rounded-lg bg-[#073642] hover:bg-[#DC322F]/20 text-[#DC322F] border border-[#DC322F]/40 font-bold text-xs flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                            title="Deny access"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Deny</span>
                          </button>
                        </>
                      )}

                      {user.access_status === 'active' && !isRoot && !isSelf && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDeny(user.id, user.email)}
                          className="px-2 py-1 rounded-lg text-[#93A1A1] hover:text-[#DC6E67] hover:bg-[#DC6E67]/10 transition-colors cursor-pointer text-xs flex items-center gap-1"
                          title="Revoke access"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Revoke</span>
                        </button>
                      )}

                      {user.access_status === 'denied' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleRestore(user.id)}
                          className="px-2.5 py-1 rounded-lg bg-[#2AA198]/20 hover:bg-[#2AA198] text-[#2AA198] hover:text-[#002B36] border border-[#2AA198]/40 font-bold text-xs flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                          title="Restore access"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restore</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-[#1A4A55] bg-[#002B36] flex items-center justify-between">
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="text-[11px] text-[#93A1A1] hover:text-[#FDF6E3] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#2AA198] hover:bg-[#35B8AD] text-[#002B36] font-bold text-xs transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
