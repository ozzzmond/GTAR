import { previewBackupImport, confirmImportAsNew } from '../utils/legacyImport'
import React, { useEffect, useRef, useState } from 'react'
import { CloudUpload, CloudDownload, Download, Copy, Check, AlertCircle, AlertTriangle, X, Database, Share2, Info } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { GTAR_APP_VERSION, GTAR_DEV_VERSION } from '../types/gtar'
import { isDevEnv } from '../utils/env'
import {
  exportRecoveryData,
  buildVerifiedBackup,
  libraryFingerprint,
  parseBackupJson,
  settingsFingerprint,
  type ParsedBackupResult,
  type VerifiedBackup,
} from '../utils/jsonBackup'
import {
  DEFAULT_SETTINGS_RESTORE_CHOICE, SETTINGS_CHANGED, discardSettingsRecovery, inspectSettingsRecovery, isSettingsRestoreError,
  readBackupSettingsV2, restoreBackupSettingsV2, restorePreviousSettings, settingsSignature,
  type SettingsLockManager, type SettingsRecoveryState, type SettingsRestoreChoice,
} from '../utils/backupSettings'
import { isQuotaError } from '../utils/syncJournal'
import {
  canCopyBackup, copyBackup, downloadBackup, ensureRestoreSafetySnapshot, shareOrDownloadBackup, verifyRestoredLibrary,
  type ExportEnvironment, type ExportOutcome,
} from '../utils/backupExport'
import {
  BACKUP_REMINDER_INTERVALS, DELIVERY_LABEL, readBackupReminder, readBackupStatus, saveBackupReminder,
  type BackupReminderSettings, type BackupStatus,
} from '../utils/backupStatus'

const countsText = (c: { songs: number; setlists: number; trash: number }) =>
  `${c.songs} songs, ${c.setlists} setlists, ${c.trash} in trash`
const mb = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const fieldCount = (value: object | undefined) => value ? Object.keys(value).length : 0

interface BackupRestoreDialogModalProps {
  isOpen: boolean
  onClose: () => void
  currentSong?: ActiveSongState
  allSongs: ActiveSongState[]
  setlists?: WebSetlist[]
  onImportAllSongs: (songs: Array<Partial<ActiveSongState>>) => void
  onFullRestoreSongs?: (songs: Array<Partial<ActiveSongState>>) => void
  onFullRestore?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  onOpenAdvancedBridge?: () => void
  storage?: Storage
  /** Test seam for the share sheet, file and download APIs. */
  exportEnv?: ExportEnvironment
  /** Test seam for the cross-tab settings lock (defaults to navigator.locks). */
  settingsLocks?: SettingsLockManager | null
  /** How often the open dialog re-reads the backed-up settings keys to notice same-tab changes (ms). */
  settingsPollMs?: number
}

export const BackupRestoreDialogModal: React.FC<BackupRestoreDialogModalProps> = ({
  isOpen,
  onClose,
  allSongs,
  setlists = [],
  onImportAllSongs,
  onFullRestoreSongs,
  onFullRestore,
  onSmartMerge,
  onOpenAdvancedBridge,
  storage,
  exportEnv,
  settingsLocks,
  settingsPollMs = 500,
}) => {
  const lockOptions = settingsLocks === undefined ? undefined : { locks: settingsLocks }
  const targetStorage = storage || (typeof localStorage !== 'undefined' ? localStorage : ({} as Storage))
  const restoreFileInputRef = useRef<HTMLInputElement>(null)
  const [isWipeAndReplace, setIsWipeAndReplace] = useState(false)
  const [showExportOptions, setShowExportOptions] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null
  )
  const [restoreChoice, setRestoreChoice] = useState<SettingsRestoreChoice>(DEFAULT_SETTINGS_RESTORE_CHOICE)
  // A verified file waiting for one more tap (the browser refused to open the share sheet).
  const [preparedBackup, setPreparedBackup] = useState<VerifiedBackup | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  // #257 F3: what changed after the last backup, per part (null = unknown).
  const [changedSinceBackup, setChangedSinceBackup] = useState<{ library: boolean | null; settings: boolean | null }>({ library: null, settings: null })
  const [reminder, setReminder] = useState<BackupReminderSettings>(() => readBackupReminder())
  // #257 F2: unfinished settings restore found on this device (survives remounts and reloads).
  const [settingsRecovery, setSettingsRecovery] = useState<SettingsRecoveryState>({ state: 'none' })
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // Re-check trigger for settings changes (restore in this tab, or another tab via `storage`).
  const [settingsTick, setSettingsTick] = useState(0)
  // Latest library for work done after render.
  const libraryRef = useRef({ songs: allSongs, setlists })
  useEffect(() => { libraryRef.current = { songs: allSongs, setlists } }, [allSongs, setlists])
  const currentFingerprint = () => {
    try { return libraryFingerprint(libraryRef.current.songs, libraryRef.current.setlists) } catch { return null }
  }
  const currentSettingsFingerprint = () => {
    try { return settingsFingerprint(readBackupSettingsV2(targetStorage)) } catch { return null }
  }
  const compareWithBackup = (status: BackupStatus | null) => {
    if (!status) return { library: null, settings: null }
    const library = currentFingerprint(), settings = currentSettingsFingerprint()
    return {
      library: library === null ? null : library !== status.fingerprint,
      settings: settings === null || !status.settingsFingerprint ? null : settings !== status.settingsFingerprint,
    }
  }
  const refreshSettingsRecovery = () => {
    setSettingsRecovery(inspectSettingsRecovery(targetStorage))
    setConfirmDiscard(false)
  }
  // Effects below read the latest helpers through this ref (they close over current props).
  const helpersRef = useRef({ compareWithBackup, refreshSettingsRecovery })
  useEffect(() => { helpersRef.current = { compareWithBackup, refreshSettingsRecovery } })

  useEffect(() => {
    if (!isOpen) return
    // Each opening starts a new export session: a file prepared earlier is dropped (#257 review).
    const timer = setTimeout(() => {
      setPreparedBackup(null)
      helpersRef.current.refreshSettingsRecovery()
    }, 0)
    const bump = () => setSettingsTick(tick => tick + 1)
    window.addEventListener(SETTINGS_CHANGED, bump)
    window.addEventListener('storage', bump)
    // #257 P2: many components write settings keys directly in this tab without an event (stage text,
    // songbook sort, TV size from a cast receiver…). While open, the dialog re-reads the raw values of
    // the backed-up keys (a few string reads, no parsing, no library work) and re-checks only on change.
    let signature = settingsSignature(targetStorage)
    const poll = setInterval(() => {
      const next = settingsSignature(targetStorage)
      if (next !== signature) { signature = next; bump() }
    }, settingsPollMs)
    return () => { clearTimeout(timer); clearInterval(poll); window.removeEventListener(SETTINGS_CHANGED, bump); window.removeEventListener('storage', bump) }
    // targetStorage/settingsPollMs are fixed for a dialog instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // #257 F3: re-compared on opening, whenever the library changes (App passes a memoized array, so this
  // does not run on unrelated renders) and whenever settings change; once per change, after render.
  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(() => {
      const status = readBackupStatus()
      setBackupStatus(status)
      setChangedSinceBackup(helpersRef.current.compareWithBackup(status))
      helpersRef.current.refreshSettingsRecovery()
    }, 0)
    return () => clearTimeout(timer)
  }, [isOpen, allSongs, setlists, settingsTick])
  const [pendingRestore, setPendingRestore] = useState<{
    rawText: string
    parsed: ParsedBackupResult
  } | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  if (!isOpen) return null

  const showFeedback = (type: 'success' | 'error' | 'info', message: string) => {
    setFeedback({ type, message })
    if (type !== 'success') return
    setTimeout(() => {
      setFeedback(null)
      if (type === 'success') {
        onClose()
      }
    }, 2200)
  }

  // #251: every export builds the file once and verifies its bytes before handing it out.
  const prepareBackup = (): VerifiedBackup | null => {
    try {
      return buildVerifiedBackup(allSongs, setlists, isDevEnv ? GTAR_DEV_VERSION : GTAR_APP_VERSION)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      exportRecoveryData({ songs: allSongs, setlists })
      showFeedback('error', `Backup not created: ${msg}. A raw recovery archive was downloaded with every original entry.`)
      return null
    }
  }

  const reportExport = (backup: VerifiedBackup, outcome: ExportOutcome) => {
    if (outcome.kind === 'needs-tap') {
      setPreparedBackup(backup)
      showFeedback('info', `Backup file verified (${countsText(backup.counts)}). Tap "Open share sheet" to choose where to save it.`)
      return
    }
    setPreparedBackup(null)
    if (outcome.kind === 'share-cancelled') { showFeedback('info', 'Share cancelled. No backup was saved.'); return }
    if (outcome.kind === 'failed') { showFeedback('error', `Backup not exported: ${outcome.message}`); return }
    // The status describes the file just handed out; compare it with the library and settings as they are now.
    const status = readBackupStatus()
    setBackupStatus(status)
    setChangedSinceBackup(compareWithBackup(status))
    const verified = `Backup file verified (${countsText(backup.counts)}, ${mb(backup.bytes)})`
    if (outcome.kind === 'shared') showFeedback('info', `${verified} and sent to the share sheet. GTAR cannot see where it was saved; check that it is in Files, iCloud Drive or your cloud drive.`)
    else if (outcome.kind === 'copied') showFeedback('info', `${verified} and copied to the clipboard. Paste it somewhere safe; GTAR cannot see where it went.`)
    else showFeedback('info', `${outcome.reason === 'share-unavailable' ? 'Sharing files is not available here, so ' : outcome.reason === 'share-failed' ? 'The share sheet failed, so ' : ''}${verified} and handed to browser downloads as ${backup.fileName}. Check that it was saved.`)
  }

  const handleSaveBackup = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      // #251 F3: a prepared file is reused only while it still matches the library and settings.
      let backup = preparedBackup
      let rebuilt = false
      if (backup) {
        const prepared = backup
        const fresh = (() => {
          try { return currentFingerprint() === prepared.fingerprint && settingsFingerprint(readBackupSettingsV2()) === prepared.settingsFingerprint } catch { return false }
        })()
        if (!fresh) { setPreparedBackup(null); backup = null; rebuilt = true }
      }
      backup = backup ?? prepareBackup()
      if (!backup) return
      const outcome = await shareOrDownloadBackup(backup, exportEnv)
      if (rebuilt && outcome.kind === 'needs-tap') {
        setPreparedBackup(backup)
        showFeedback('info', `Your library or settings changed after the earlier file was prepared, so a new backup was created and verified (${countsText(backup.counts)}). Tap "Open share sheet" to save it.`)
        return
      }
      reportExport(backup, outcome)
    } finally { setIsExporting(false) }
  }

  const handleDownloadBackup = () => {
    const backup = prepareBackup()
    if (backup) reportExport(backup, downloadBackup(backup, exportEnv))
  }

  const handleCopyBackup = async () => {
    const backup = prepareBackup()
    if (!backup) return
    if (!canCopyBackup(backup)) {
      showFeedback('error', `Backup is too large to copy safely (${mb(backup.bytes)}). Use Save backup file or Download .json.`)
      return
    }
    reportExport(backup, await copyBackup(backup, exportEnv))
  }

  const handlePutBackSettings = async () => {
    const undo = settingsRecovery.state === 'committed'
    try {
      const result = await restorePreviousSettings(targetStorage, lockOptions)
      refreshSettingsRecovery()
      if (result.unresolved.length) showFeedback('error', `These settings could not be put back: ${result.unresolved.join(', ')}. The saved previous settings are kept; try again after reloading.`)
      else if (!result.cleared) showFeedback('error', 'Previous settings were put back and verified, but the saved copy could not be removed. It is kept; putting back again is safe.')
      else showFeedback('info', undo ? 'The last settings restore was undone: previous settings put back and verified.' : 'Previous settings put back and verified.')
    } catch (error) {
      refreshSettingsRecovery()
      showFeedback('error', error instanceof Error ? error.message : String(error))
    }
  }

  const handleDownloadSettingsRecovery = () => {
    if (settingsRecovery.state === 'none') return
    exportRecoveryData({ settingsRestoreSnapshot: settingsRecovery.raw, state: settingsRecovery.state,
      ...(settingsRecovery.state === 'invalid' ? { reason: settingsRecovery.reason } : {}) })
  }

  const handleDiscardSettingsRecovery = async () => {
    if (settingsRecovery.state === 'none') return
    const committed = settingsRecovery.state === 'committed'
    try {
      const removed = await discardSettingsRecovery(settingsRecovery.raw, targetStorage, lockOptions)
      refreshSettingsRecovery()
      showFeedback(removed ? 'info' : 'error', removed
        ? committed ? 'Kept the current settings; the copy from before the last restore was removed.' : 'Settings recovery data discarded. No setting was changed.'
        : 'The saved copy changed or could not be removed; it is kept.')
    } catch (error) {
      refreshSettingsRecovery()
      showFeedback('error', error instanceof Error ? error.message : String(error))
    }
  }

  const updateReminder = (next: BackupReminderSettings) => {
    setReminder(next)
    saveBackupReminder(next)
  }

  const executeRestore = async (parsed: ParsedBackupResult, isDestructive: boolean) => {
    // #257 F1: a new settings restore would replace the only copy of an unfinished one's original values.
    const recovery = inspectSettingsRecovery(targetStorage)
    if (recovery.state !== 'none' && (restoreChoice.appearance || restoreChoice.preferences)) {
      setPendingRestore(null)
      setSettingsRecovery(recovery)
      showFeedback('error', `Restore not started: ${recovery.state === 'pending' ? 'an earlier settings restore did not finish' : recovery.state === 'committed' ? 'a copy of the settings from before the last restore is still kept' : 'settings recovery data is damaged'}. Resolve it first (see above), or untick Appearance and Preferences to restore only the library. Nothing was changed.`)
      return
    }
    setIsRestoring(true)
    try {
      const replace = isDestructive && !parsed.isSingleSetlist
      // Songs-only replacement leaves setlists to the caller, so it cannot be compared with the backup.
      const verifiable = replace ? !!onFullRestore : !!onSmartMerge
      // #251: merges overwrite songs with the same id, so they get the same verified safety snapshot as a wipe.
      if (!replace && verifiable) {
        try {
          await ensureRestoreSafetySnapshot({ songs: allSongs, setlists }, targetStorage)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          setPendingRestore(null)
          showFeedback('error', `Restore aborted: pre-restore safety snapshot failed to save (${msg}). Current library preserved.`)
          return
        }
      }
      if (replace) {
        if (onFullRestore) {
          await onFullRestore(parsed.songs, parsed.setlists)
        } else if (onFullRestoreSongs) {
          await onFullRestoreSongs(parsed.songs)
        } else {
          onImportAllSongs(parsed.songs)
        }
      } else if (onSmartMerge) {
        await onSmartMerge(parsed.songs, parsed.setlists)
      } else {
        onImportAllSongs(parsed.songs)
      }

      // #251: success is claimed only after the saved library is read back and matches the backup.
      if (verifiable) {
        const problems = verifyRestoredLibrary({ songs: allSongs, setlists }, { songs: parsed.songs, setlists: parsed.setlists },
          replace ? 'replace' : 'merge', targetStorage)
        if (problems.length) {
          setPendingRestore(null)
          showFeedback('error', `Restore could not be verified: ${problems.join('; ')}. Settings were not changed. The previous library is kept in the safety snapshot (Review local recovery).`)
          return
        }
      } else {
        setPendingRestore(null)
        showFeedback('info', replace && onFullRestoreSongs
          ? `Songs replaced (${parsed.songs.length}); not verified against the backup. Setlists and settings were not restored.`
          : `Imported ${parsed.songs.length} songs as new copies. Setlists and settings were not restored.`)
        return
      }

      // Library persistence and settings writes are separate operations; never claim
      // an aborted library write when settings fail after the library has been saved.
      let settingsNote = ''
      try {
        const written = await restoreBackupSettingsV2(parsed.settings, restoreChoice, targetStorage, lockOptions)
        const kept = (['appearance', 'preferences'] as const).filter(group => !restoreChoice[group] && fieldCount(parsed.settings[group]))
        if (written.written.length) settingsNote += ` Restored ${written.groups.join(' and ')} settings.`
        if (kept.length) settingsNote += ` Kept this device's ${kept.join(' and ')}.`
        if (restoreChoice.preferences && fieldCount(parsed.settings.preferences)) settingsNote += ' Reopen GTAR to apply every restored preference.'
        if (written.recoveryCopy === 'kept-committed') settingsNote += ' The copy of your settings from before this restore could not be removed; it is kept and marked as finished (see above).'
        if (written.recoveryCopy === 'stale') settingsNote += ' The copy of your settings from before this restore could not be removed or updated, so GTAR will list it as an unfinished restore; putting it back would undo this restore.'
        refreshSettingsRecovery()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setPendingRestore(null)
        const library = `Library restored: ${parsed.songs.length} songs, ${parsed.setlists.length} setlists (verified after saving)`
        refreshSettingsRecovery()
        if (isSettingsRestoreError(err) && err.state !== 'partial') {
          showFeedback('error', `${library}, but settings were not restored: ${msg}. This device's previous settings are unchanged.`)
        } else {
          showFeedback('error', `Partial restore: library saved, but settings restoration failed (${msg}). Some settings may have been applied. ${isSettingsRestoreError(err) ? 'The previous settings are kept in a verified snapshot; use "Put back previous settings" before retrying.' : 'Reload to inspect the saved state before retrying.'} Recovery data retained.`)
        }
        return
      }
      if (parsed.ignoredFields.length) settingsNote += ` Not restored (unknown to this version): ${parsed.ignoredFields.slice(0, 8).join(', ')}${parsed.ignoredFields.length > 8 ? ', …' : ''}.`

      // Keep recovery snapshots after success too; they may contain unique data.
      setPendingRestore(null)
      showFeedback(parsed.ignoredFields.length ? 'info' : 'success', `Backup restored: ${parsed.songs.length} songs, ${parsed.setlists.length} setlists (verified after saving).${settingsNote}`)
    } finally {
      setIsRestoring(false)
    }
  }

  // Restore backup from .json file (Wipe & Replace vs Smart Merge)
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseBackupJson(text, { mode: isWipeAndReplace ? 'replace' : 'merge', existingSongs: allSongs })
      if (!parsed.isValid) {
        const preview = previewBackupImport(text)
        if (preview.isValid && preview.importAsNew) {
          if (!onSmartMerge) throw new Error('Import as New requires library merge support.')
          const imported = confirmImportAsNew(preview, { songs: allSongs, setlists }, message => window.confirm(message))
          if (imported) {
            if (!imported.isValid) throw new Error(imported.error)
            await onSmartMerge(imported.songs, imported.setlists)
            showFeedback('success', `Imported as new: ${imported.songs.length} songs, ${imported.setlists.length} setlists`)
          }
          e.target.value = ''
          return
        }
        showFeedback('error', preview.error || parsed.error || 'Invalid GTAR backup.')
        if (e.target) e.target.value = ''
        return
      }

      if (isWipeAndReplace && !parsed.isSingleSetlist) {
        // ACTION 1: Do NOT immediately mutate the library!
        // Show decision-useful preview summary and wait for explicit confirmation.
        setPendingRestore({ rawText: text, parsed })
        if (e.target) e.target.value = ''
        return
      }

      // ACTION 1: SMART_MERGE_FLOW_MUST_NOT_GAIN_UNNECESSARY_DESTRUCTIVE_CONFIRMATION
      await executeRestore(parsed, false)
    } catch (err: unknown) {
      const msg = isQuotaError(err)
        ? 'Storage quota exceeded: restore aborted and changes could not be saved to device storage.'
        : (err instanceof Error ? err.message : String(err))
      showFeedback('error', `Failed to restore backup: ${msg}`)
    }

    if (e.target) e.target.value = ''
  }

  const handleConfirmWipeAndReplace = async () => {
    if (!pendingRestore) return
    const { parsed } = pendingRestore

    // ACTION 5: Pre-restore safety snapshot for destructive wipe
    try {
      await ensureRestoreSafetySnapshot({ songs: allSongs, setlists }, targetStorage)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showFeedback('error', `Restore aborted: pre-restore safety snapshot failed to save (${msg}). Current library preserved.`)
      setPendingRestore(null)
      return
    }

    // ACTION 4: Coordinate restore success with durable persistence
    try {
      await executeRestore(parsed, true)
    } catch (err: unknown) {
      const msg = isQuotaError(err)
        ? 'Storage quota exceeded: restore aborted and changes could not be saved to device storage.'
        : (err instanceof Error ? err.message : String(err))
      showFeedback('error', `Restore failed: ${msg}. Pre-restore library preserved in safety snapshot.`)
    }
  }

  const settingsChoices = (
    <fieldset className="p-3 rounded-xl bg-app-base border border-app-border space-y-1.5 text-[11px]">
      <legend className="px-1 text-xs font-bold text-app-heading">When restoring, also restore</legend>
      {pendingRestore && (
        <p className="text-app-muted">
          This file has {fieldCount(pendingRestore.parsed.settings.appearance)} appearance and {fieldCount(pendingRestore.parsed.settings.preferences)} preference settings.
        </p>
      )}
      <label className="flex items-start gap-2 text-app-heading">
        <input type="checkbox" checked={restoreChoice.appearance} onChange={e => setRestoreChoice({ ...restoreChoice, appearance: e.target.checked })} />
        <span>Appearance: theme, colours, stage text size and style, scroll speed, TV text size</span>
      </label>
      <label className="flex items-start gap-2 text-app-heading">
        <input type="checkbox" checked={restoreChoice.preferences} onChange={e => setRestoreChoice({ ...restoreChoice, preferences: e.target.checked })} />
        <span>Preferences: songbook sort, filters and collapsed sections, edge-swipe panel</span>
      </label>
      <p className="text-app-muted">Songs, setlists and trash always come from the backup. Unticked settings stay as they are on this device.</p>
    </fieldset>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-app-surface border border-app-border shadow-2xl overflow-hidden flex flex-col">
        {/* Hidden file input for SAF backup restore */}
        <input
          ref={restoreFileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleRestoreFile}
          className="hidden"
        />

        {/* Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-base/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-app-accent/20 border border-app-accent/30 flex items-center justify-center text-app-accent">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-app-heading">
                {pendingRestore ? 'Confirm Full Restore' : 'Backup & Restore'}
              </h2>
              <p className="text-xs text-app-muted">
                {pendingRestore ? 'Review backup contents before replacing library' : 'Manage songbook and setlists backup'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {feedback && (
            <div
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-app-action/15 border-app-action/40 text-app-action'
                  : feedback.type === 'info'
                    ? 'bg-app-accent/15 border-app-accent/40 text-app-heading'
                    : 'bg-[#DC6E67]/15 border-[#DC6E67]/40 text-status-error'
              }`}
            >
              {feedback.type === 'success' ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : feedback.type === 'info' ? (
                <Info className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span className="whitespace-pre-wrap">{feedback.message}</span>

            </div>
          )}

          {settingsRecovery.state !== 'none' && (
            <div role="alert" data-testid="settings-recovery" className="p-3 rounded-xl border border-[#DC6E67]/40 bg-[#DC6E67]/10 text-xs space-y-2">
              {settingsRecovery.state === 'pending' && (
                <p className="font-semibold text-app-heading">
                  An earlier settings restore did not finish. This device&apos;s previous settings ({settingsRecovery.snapshot.keys.length}) are saved from {new Date(settingsRecovery.snapshot.at).toLocaleString()}.
                </p>
              )}
              {settingsRecovery.state === 'committed' && (
                <p className="font-semibold text-app-heading">
                  The last settings restore finished ({new Date(settingsRecovery.snapshot.committedAt!).toLocaleString()}), but the copy of your settings from before it is still kept. Putting it back undoes that restore.
                </p>
              )}
              {settingsRecovery.state === 'invalid' && (
                <p className="font-semibold text-app-heading">
                  Previous-settings recovery data on this device cannot be used: {settingsRecovery.reason}. It was not applied and is kept until you decide.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {settingsRecovery.state === 'pending' && (
                  <button type="button" onClick={handlePutBackSettings} className="px-2 py-1 rounded-lg border border-current font-bold cursor-pointer">
                    Put back previous settings
                  </button>
                )}
                {settingsRecovery.state === 'committed' && (
                  <>
                    <button type="button" onClick={handleDiscardSettingsRecovery} className="px-2 py-1 rounded-lg border border-current font-bold cursor-pointer">
                      Keep current settings
                    </button>
                    <button type="button" onClick={handlePutBackSettings} className="px-2 py-1 rounded-lg border border-current cursor-pointer">
                      Undo that restore
                    </button>
                  </>
                )}
                {settingsRecovery.state !== 'committed' && (
                  <>
                    <button type="button" onClick={handleDownloadSettingsRecovery} className="px-2 py-1 rounded-lg border border-current cursor-pointer">
                      Download recovery data
                    </button>
                    {confirmDiscard ? (
                      <button type="button" onClick={handleDiscardSettingsRecovery} className="px-2 py-1 rounded-lg border border-current font-bold cursor-pointer">
                        Confirm discard{settingsRecovery.state === 'pending' ? ' (the saved previous settings are lost)' : ''}
                      </button>
                    ) : (
                      <button type="button" onClick={() => setConfirmDiscard(true)} className="px-2 py-1 rounded-lg border border-current cursor-pointer">
                        {settingsRecovery.state === 'pending' ? 'Discard saved previous settings' : 'Discard damaged recovery data'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {pendingRestore ? (
            <div className="space-y-4">
              {/* Destructive Warning Alert */}
              <div className="p-3.5 rounded-xl bg-[#DC6E67]/15 border border-[#DC6E67]/40 text-status-error flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-status-error" />
                <div className="text-xs">
                  <div className="font-bold">Destructive Wipe & Replace</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-app-heading">
                    This action will permanently drop your current songs, setlists, and trash, replacing them with the backup contents below.
                  </div>
                </div>
              </div>

              {/* Decision-Useful Summary */}
              <div className="p-4 rounded-xl bg-app-base border border-app-border space-y-2.5">
                <div className="text-xs font-bold text-app-accent border-b border-app-border pb-1.5 flex items-center justify-between">
                  <span>Backup Preview</span>
                  <span className="text-[10px] text-app-muted font-normal">Ready to restore</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-app-muted">App Version:</span>{' '}
                    <span className="font-semibold text-app-heading">
                      {pendingRestore.parsed.metadata?.version || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-app-muted">Schema Version:</span>{' '}
                    <span className="font-semibold text-app-heading">
                      {pendingRestore.parsed.metadata?.schemaVersion !== undefined
                        ? `v${pendingRestore.parsed.metadata.schemaVersion}`
                        : 'Legacy (unversioned)'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-app-muted">Exported At:</span>{' '}
                    <span className="font-semibold text-app-heading">
                      {pendingRestore.parsed.metadata?.exportedAt
                        ? new Date(pendingRestore.parsed.metadata.exportedAt).toLocaleString()
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-app-surface border border-app-border">
                    <div className="text-[10px] text-app-muted">Active Songs</div>
                    <div className="text-sm font-bold text-app-action">
                      {pendingRestore.parsed.metadata?.songCount ?? 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-app-surface border border-app-border">
                    <div className="text-[10px] text-app-muted">Total Setlists</div>
                    <div className="text-sm font-bold text-app-action">
                      {pendingRestore.parsed.metadata?.setlistCount ?? 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-app-surface border border-app-border">
                    <div className="text-[10px] text-app-muted">Active Setlists</div>
                    <div className="text-sm font-bold text-app-action">
                      {pendingRestore.parsed.metadata?.activeSetlistCount ?? 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-app-surface border border-app-border">
                    <div className="text-[10px] text-app-muted">Deleted Setlists</div>
                    <div className="text-sm font-bold text-app-heading">
                      {pendingRestore.parsed.metadata?.deletedSetlistCount ?? 0}
                    </div>
                  </div>
                  <div className="col-span-2 p-2 rounded-lg bg-app-surface border border-app-border flex justify-between items-center">
                    <span className="text-[10px] text-app-muted">Trash Bin (Archived Songs)</span>
                    <span className="text-xs font-semibold text-app-heading">
                      {pendingRestore.parsed.metadata?.trashCount ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              {settingsChoices}
              {pendingRestore.parsed.ignoredFields.length > 0 && (
                <p className="text-[11px] text-app-muted leading-snug">
                  Not restored (unknown to this version): {pendingRestore.parsed.ignoredFields.slice(0, 8).join(', ')}{pendingRestore.parsed.ignoredFields.length > 8 ? ', …' : ''}
                </p>
              )}

              {/* Confirmation Action Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={isRestoring}
                  onClick={() => setPendingRestore(null)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-app-base border border-app-border text-xs font-semibold text-app-muted hover:text-app-heading hover:bg-app-surface transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRestoring}
                  onClick={handleConfirmWipeAndReplace}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-[#DC6E67] hover:bg-[#C95B54] text-white text-xs font-bold transition-all shadow-lg cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <CloudDownload className="w-4 h-4 shrink-0" />
                  <span>{isRestoring ? 'Restoring...' : 'Confirm Wipe & Replace'}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Option 1: Export Backup */}
              {!showExportOptions ? (
                <button
                  type="button"
                  onClick={() => setShowExportOptions(true)}
                  className="w-full text-left p-4 rounded-xl bg-app-base border border-app-border hover:border-app-accent hover:bg-app-accent/30 transition-all flex items-center gap-3.5 group cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-app-surface flex items-center justify-center text-app-accent group-hover:scale-105 transition-transform">
                    <CloudUpload className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-app-heading group-hover:text-app-accent transition-colors">
                      Export Backup
                    </div>
                    <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                      Save to Device (.json) or share via files
                    </div>
                  </div>
                </button>
              ) : (
                <div className="p-4 rounded-xl bg-app-base border border-app-accent/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-app-accent">Export Backup Options</span>
                    <button
                      type="button"
                      onClick={() => setShowExportOptions(false)}
                      className="text-[11px] text-app-muted hover:text-app-heading"
                    >
                      Back
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleSaveBackup}
                    className="w-full py-2.5 px-3 rounded-xl bg-app-action/15 border border-app-action/50 hover:border-app-action text-app-heading text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Share2 className="w-4 h-4 text-app-action" />
                    <span>{isExporting ? 'Preparing backup…' : preparedBackup ? 'Open share sheet' : 'Save backup file'}</span>
                  </button>
                  <p className="text-[11px] text-app-muted leading-snug">
                    Creates a backup file on this device and opens the share sheet, where you choose Files, iCloud Drive, Google Drive or OneDrive. GTAR does not send it anywhere itself.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadBackup}
                      className="py-2.5 px-3 rounded-xl bg-app-surface border border-app-border hover:border-app-action text-app-heading text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-app-action" />
                      <span>Download .json</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyBackup}
                      className="py-2.5 px-3 rounded-xl bg-app-surface border border-app-border hover:border-app-accent text-app-heading text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer"
                    >
                      <Copy className="w-4 h-4 text-app-accent" />
                      <span>Copy JSON</span>
                    </button>
                  </div>

                  <div className="pt-2 border-t border-app-border space-y-2 text-[11px] text-app-muted">
                    <p data-testid="backup-status">
                      {backupStatus
                        ? `Last backup: ${new Date(backupStatus.at).toLocaleString()} (${countsText(backupStatus)}), ${DELIVERY_LABEL[backupStatus.delivery]}. GTAR cannot confirm where the file was saved.`
                        : 'No backup made from this device yet.'}
                      {backupStatus && changedSinceBackup.library ? ' Your library changed after this backup; the newer edits are not in it.' : ''}
                      {backupStatus && changedSinceBackup.settings ? ' Your settings changed after this backup; the newer settings are not in it.' : ''}
                      {backupStatus && changedSinceBackup.library === false && changedSinceBackup.settings === false ? ' Nothing changed since this file was made (GTAR still cannot confirm it was saved).' : ''}
                    </p>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={reminder.enabled} onChange={e => updateReminder({ ...reminder, enabled: e.target.checked })} />
                      <span>Remind me when a backup is due, every</span>
                      <select
                        value={reminder.intervalDays}
                        disabled={!reminder.enabled}
                        onChange={e => updateReminder({ ...reminder, intervalDays: Number(e.target.value) })}
                        className="bg-app-surface border border-app-border rounded px-1 py-0.5 text-app-heading"
                      >
                        {BACKUP_REMINDER_INTERVALS.map(days => <option key={days} value={days}>{days} days</option>)}
                      </select>
                    </label>
                  </div>

                  {onOpenAdvancedBridge && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onOpenAdvancedBridge()
                      }}
                      className="w-full text-center text-[11px] text-app-action hover:underline cursor-pointer pt-1 flex items-center justify-center gap-1"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>Open Advanced JSON Bridge Modal</span>
                    </button>
                  )}
                </div>
              )}

              {settingsChoices}

              {/* Option 2: Full Restore (Wipe & Replace) */}
              <button
                type="button"
                onClick={() => {
                  setIsWipeAndReplace(true)
                  restoreFileInputRef.current?.click()
                }}
                className="w-full text-left p-4 rounded-xl bg-app-base border border-app-border hover:border-[#DC6E67] hover:bg-app-accent/30 transition-all flex items-center gap-3.5 group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-app-surface flex items-center justify-center text-status-error group-hover:scale-105 transition-transform">
                  <CloudDownload className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-app-heading group-hover:text-status-error transition-colors">
                    Full Restore (Wipe & Replace)
                  </div>
                  <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                    Replaces all songs, setlists and trash.
                  </div>
                </div>
              </button>

              {/* Option 3: Restore Backup (Smart Merge) */}
              <button
                type="button"
                onClick={() => {
                  setIsWipeAndReplace(false)
                  restoreFileInputRef.current?.click()
                }}
                className="w-full text-left p-4 rounded-xl bg-app-base border border-app-border hover:border-app-action hover:bg-app-accent/30 transition-all flex items-center gap-3.5 group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-app-surface flex items-center justify-center text-app-action group-hover:scale-105 transition-transform">
                  <CloudDownload className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-app-heading group-hover:text-app-action transition-colors">
                    Restore Backup (Smart Merge)
                  </div>
                  <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                    Adds and updates songs; deletes nothing.
                  </div>
                </div>
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        {!pendingRestore && (
          <div className="px-6 py-3 border-t border-app-border bg-app-base/30 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-app-base border border-app-border text-xs font-semibold text-app-muted hover:text-app-heading transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
