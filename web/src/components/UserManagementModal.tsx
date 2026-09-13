import React, { useState, useEffect } from 'react'
import {
  X,
  UserPlus,
  Trash2,
  Shield,
  UserCheck,
  Copy,
  Check,
  RotateCcw,
  Users,
} from 'lucide-react'
import {
  getAuthorizedEmailsList,
  addAuthorizedEmail,
  removeAuthorizedEmail,
  resetAuthorizedEmails,
  DEFAULT_ROOT_ADMIN,
} from '../utils/authPolicy'

interface UserManagementModalProps {
  isOpen: boolean
  onClose: () => void
  onUpdateUsers?: () => void
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({ isOpen, onClose, onUpdateUsers }) => {
  const [emails, setEmails] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const rootAdmin = (import.meta.env.VITE_ROOT_ADMIN_EMAIL as string | undefined) || DEFAULT_ROOT_ADMIN
  const configuredEmails = import.meta.env.VITE_AUTHORIZED_EMAILS as string | undefined

  const notifyChange = () => {
    onUpdateUsers?.()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gtar:auth_updated'))
    }
  }

  const reload = () => {
    setEmails(getAuthorizedEmailsList(configuredEmails))
  }

  useEffect(() => {
    if (isOpen) {
      reload()
      setError('')
      setNewEmail('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed) return
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.')
      return
    }
    if (emails.includes(trimmed)) {
      setError('This email is already in the whitelist.')
      return
    }
    setError('')
    addAuthorizedEmail(trimmed, configuredEmails)
    setNewEmail('')
    reload()
    notifyChange()
  }

  const handleRemove = (emailToRemove: string) => {
    if (emailToRemove.toLowerCase() === rootAdmin.toLowerCase()) {
      setError('Root Super Admin cannot be removed.')
      return
    }
    if (window.confirm(`Revoke access for ${emailToRemove}? They will be blocked upon their next session check.`)) {
      removeAuthorizedEmail(emailToRemove, configuredEmails, rootAdmin)
      reload()
      notifyChange()
    }
  }

  const handleReset = () => {
    if (window.confirm('Reset whitelist to default build configuration? All locally added emails will be cleared.')) {
      resetAuthorizedEmails()
      reload()
      notifyChange()
    }
  }

  const handleCopyEnvConfig = () => {
    const envValue = emails.join(', ')
    const configLine = `VITE_AUTHORIZED_EMAILS="${envValue}"`
    void navigator.clipboard?.writeText(configLine).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-lg bg-[#073642] border border-[#1A4A55] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#EEE8D5]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A4A55] bg-[#002B36]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#073642] text-[#2AA198] border border-[#1A4A55]">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#FDF6E3]">User Whitelist &amp; Access Control</h2>
              </div>
              <p className="text-xs text-[#93A1A1]">
                Manage accounts authorized to log in, view songs, and sync
              </p>
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
        <div className="p-5 space-y-4 overflow-y-auto max-h-[65vh]">
          {/* Add User Form */}
          <form onSubmit={handleAdd} className="space-y-2">
            <label className="text-xs font-bold text-[#FDF6E3] flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-[#2AA198]" />
              <span>Authorize New Google Account</span>
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="musician@gmail.com"
                value={newEmail}
                onChange={(e) => {
                  setNewEmail(e.target.value)
                  if (error) setError('')
                }}
                className="flex-1 px-3 py-2 rounded-xl bg-[#002B36] border border-[#1A4A55] text-xs text-[#FDF6E3] placeholder-[#93A1A1]/60 focus:border-[#2AA198] focus:outline-none transition-colors"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#2AA198] hover:bg-[#35B8AD] text-[#002B36] text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
            {error && <p className="text-xs text-[#DC6E67]">{error}</p>}
          </form>

          <div className="h-[1px] bg-[#1A4A55]/60" />

          {/* List of Whitelisted Users */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#FDF6E3] flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#93A1A1]" />
                <span>Authorized Accounts ({emails.length})</span>
              </span>
              <button
                type="button"
                onClick={handleCopyEnvConfig}
                className="text-[11px] text-[#2AA198] hover:underline flex items-center gap-1 cursor-pointer"
                title="Copy formatted VITE_AUTHORIZED_EMAILS config line for deployment"
              >
                {copied ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied Config!' : 'Copy .env Config'}</span>
              </button>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {emails.map((email) => {
                const isRoot = email.toLowerCase() === rootAdmin.toLowerCase()
                return (
                  <div
                    key={email}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#002B36] border border-[#1A4A55]/60 hover:border-[#1A4A55] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <UserCheck className={`w-3.5 h-3.5 shrink-0 ${isRoot ? 'text-[#B58900]' : 'text-[#2AA198]'}`} />
                      <span className="text-xs font-mono text-[#FDF6E3] truncate">{email}</span>
                      {isRoot ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#B58900]/20 text-[#B58900] border border-[#B58900]/30 shrink-0">
                          ROOT
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#2AA198]/15 text-[#2AA198] border border-[#2AA198]/30 shrink-0">
                          USER
                        </span>
                      )}
                    </div>

                    {!isRoot && (
                      <button
                        type="button"
                        onClick={() => handleRemove(email)}
                        className="p-1 rounded-lg text-[#93A1A1] hover:text-[#DC6E67] hover:bg-[#DC6E67]/10 transition-colors cursor-pointer shrink-0 ml-2"
                        title={`Revoke access for ${email}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-[#1A4A55] bg-[#002B36] flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="text-[11px] text-[#93A1A1] hover:text-[#FDF6E3] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Reset whitelist to initial build configuration"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Overrides</span>
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
