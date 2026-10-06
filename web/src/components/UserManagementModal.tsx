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
import { useOptionalGoogleAuth } from '../utils/authContext'
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

  const auth = useOptionalGoogleAuth()
  const sessionToken = auth?.session?.sessionToken || auth?.session?.idToken
  const currentEmail = auth?.session?.user?.email

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Modal-open external admin request preserves the synchronous loading and reset sequence.
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
      <div className="relative w-full max-w-xl bg-app-surface border border-app-border rounded-2xl shadow-2xl flex flex-col overflow-hidden text-app-text">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border bg-app-base">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-app-surface text-app-action border border-app-border">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-app-heading">D1 Account &amp; Access Control</h2>
              </div>
              <p className="text-xs text-app-muted">Server-authoritative Google account management</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-app-surface text-app-muted hover:text-app-heading transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {/* Status Filter Tabs */}
          <div className="flex items-center justify-between gap-2 border-b border-app-border/60 pb-3">
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  filter === 'all'
                    ? 'bg-app-action text-app-on-action'
                    : 'bg-app-base text-app-muted hover:text-app-heading'
                }`}
              >
                All ({users.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('pending')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  filter === 'pending'
                    ? 'bg-amber-400 text-black'
                    : 'bg-app-base text-app-muted hover:text-app-heading'
                }`}
              >
                <span>Pending ({pendingCount})</span>
                {pendingCount > 0 && filter !== 'pending' && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setFilter('active')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  filter === 'active'
                    ? 'bg-[#10B981] text-black'
                    : 'bg-app-base text-app-muted hover:text-app-heading'
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
                    : 'bg-app-base text-app-muted hover:text-app-heading'
                }`}
              >
                Denied ({deniedCount})
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyEmails}
              className="text-[11px] text-app-action hover:underline flex items-center gap-1 cursor-pointer shrink-0"
              title="Copy active user emails"
            >
              {copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied!' : 'Copy Active'}</span>
            </button>
          </div>

          {error && <p className="text-xs text-status-error font-semibold">{error}</p>}

          {/* User List */}
          {loading && users.length === 0 ? (
            <div className="py-8 flex flex-col items-center justify-center text-xs text-app-muted gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-app-action" />
              <span>Loading registered accounts from D1...</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-8 text-center text-xs text-app-muted">
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
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-app-base border border-app-border/60 hover:border-app-border transition-colors gap-2"
                  >
                    {/* User Identity */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {user.picture_url ? (
                        <img
                          src={user.picture_url}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded-full border border-app-border shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-app-surface border border-app-border flex items-center justify-center text-app-muted text-xs font-bold shrink-0">
                          {user.email.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-app-heading truncate">
                            {user.display_name || user.email}
                          </span>
                          {user.role === 'admin' ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-app-accent/25 text-app-accent border border-app-accent/30 shrink-0">
                              ADMIN
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-app-action/20 text-app-action border border-app-action/30 shrink-0">
                              MEMBER
                            </span>
                          )}
                          {user.access_status === 'pending' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-400/20 text-status-warning border border-amber-400/30 shrink-0 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              <span>PENDING</span>
                            </span>
                          )}
                          {user.access_status === 'denied' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#DC322F]/20 text-status-error border border-[#DC322F]/30 shrink-0 flex items-center gap-1">
                              <ShieldAlert className="w-2.5 h-2.5" />
                              <span>DENIED</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-app-muted font-mono truncate">{user.email}</div>
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
                            className="px-2.5 py-1 rounded-lg bg-app-action hover:bg-app-action text-app-on-action font-bold text-xs flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                            title="Approve access"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDeny(user.id, user.email)}
                            className="px-2.5 py-1 rounded-lg bg-app-surface hover:bg-[#DC322F]/20 text-status-error border border-[#DC322F]/40 font-bold text-xs flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
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
                          className="px-2 py-1 rounded-lg text-app-muted hover:text-status-error hover:bg-[#DC6E67]/10 transition-colors cursor-pointer text-xs flex items-center gap-1"
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
                          className="px-2.5 py-1 rounded-lg bg-app-action/20 hover:bg-app-action text-app-action hover:text-app-on-action border border-app-action/40 font-bold text-xs flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
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
        <div className="px-5 py-3 border-t border-app-border bg-app-base flex items-center justify-between">
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="text-[11px] text-app-muted hover:text-app-heading flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-app-action hover:bg-app-action text-app-on-action font-bold text-xs transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
