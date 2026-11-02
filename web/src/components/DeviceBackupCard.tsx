import { appLogger } from '../utils/logger'
import { previewBackupImport, confirmImportAsNew } from '../utils/legacyImport'
import React, { useEffect, useRef, useState } from 'react'
import { Download, Copy, Share2, Upload } from 'lucide-react'
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
  canCopyBackup, copyBackup, downloadBackup, ensureRestoreSafetySnapshot, libraryWritesSaved, shareOrDownloadBackup, verifyRestoredLibrary,
  type ExportEnvironment, type ExportOutcome,
} from '../utils/backupExport'

import { RestorePreview } from './RestorePreview'
import {
  RESTORE_BLOCKED_MESSAGE, listCounts, outlinedButton, primaryButton, secondaryButton, sectionCard, sectionLabel, tone,
} from './backupCenterUi'

const countsText = (c: { songs: number; setlists: number; trash: number }) =>
  `${c.songs} songs, ${c.setlists} setlists, ${c.trash} in trash`
const mb = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const fieldCount = (value: object | undefined) => value ? Object.keys(value).length : 0

interface DeviceBackupCardProps {
  /** Each opening of the Backup & Restore center starts a new export session. */
  isOpen: boolean
  onClose?: () => void
  /** Editor open or cross-tab conflict: restores are refused (checked again right before applying). */
  restoreBlocked?: boolean
  /** Lets the center keep itself open while a restore or export runs. */
  onBusyChange?: (busy: boolean) => void
  currentSong?: ActiveSongState
  allSongs: ActiveSongState[]
  setlists?: WebSetlist[]
  onImportAllSongs: (songs: Array<Partial<ActiveSongState>>) => void
  onFullRestoreSongs?: (songs: Array<Partial<ActiveSongState>>) => void
  onFullRestore?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  storage?: Storage
  /** Test seam for the share sheet, file and download APIs. */
  exportEnv?: ExportEnvironment
  /** Test seam for the cross-tab settings lock (defaults to navigator.locks). */
  settingsLocks?: SettingsLockManager | null
  /** How often the open dialog re-reads the backed-up settings keys to notice same-tab changes (ms). */
  settingsPollMs?: number
}

/** #299: "This device (file)" card of the Backup & Restore center. Works signed out. */
export const DeviceBackupCard: React.FC<DeviceBackupCardProps> = ({
  isOpen,
  restoreBlocked = false,
  onBusyChange,
  allSongs,
  setlists = [],
  onImportAllSongs,
  onFullRestoreSongs,
  onFullRestore,
  onSmartMerge,
  storage,
  exportEnv,
  settingsLocks,
  settingsPollMs = 500,
}) => {
  const lockOptions = settingsLocks === undefined ? undefined : { locks: settingsLocks }
  const targetStorage = storage || (typeof localStorage !== 'undefined' ? localStorage : ({} as Storage))
  const restoreFileInputRef = useRef<HTMLInputElement>(null)
  const restoreBlockedRef = useRef(restoreBlocked)
  useEffect(() => { restoreBlockedRef.current = restoreBlocked }, [restoreBlocked])
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null
  )
  const [restoreChoice, setRestoreChoice] = useState<SettingsRestoreChoice>(DEFAULT_SETTINGS_RESTORE_CHOICE)
  // A verified file waiting for one more tap (the browser refused to open the share sheet).
  const [preparedBackup, setPreparedBackup] = useState<VerifiedBackup | null>(null)
  const [isExporting, setIsExporting] = useState(false)
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
  const refreshSettingsRecovery = () => {
    setSettingsRecovery(inspectSettingsRecovery(targetStorage))
    setConfirmDiscard(false)
  }
  // Effects below read the latest helpers through this ref (they close over current props).
  const helpersRef = useRef({ refreshSettingsRecovery })
  useEffect(() => { helpersRef.current = { refreshSettingsRecovery } })

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

  // Settings recovery is re-checked on opening, whenever the library changes (App passes a memoized array,
  // so this does not run on unrelated renders) and whenever settings change; once per change, after render.
  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(() => {
      helpersRef.current.refreshSettingsRecovery()
    }, 0)
    return () => clearTimeout(timer)
  }, [isOpen, allSongs, setlists, settingsTick])
  // The file picked for restore, parsed for the preview (merge rules); replace re-parses with replace rules.
  const [pendingRestore, setPendingRestore] = useState<{
    rawText: string
    parsed: ParsedBackupResult
  } | null>(null)
  // The center unmounts this card when it closes, so every opening starts without a pending file or result.
  const [isRestoring, setIsRestoring] = useState(false)
  const busyCallback = useRef(onBusyChange)
  useEffect(() => { busyCallback.current = onBusyChange }, [onBusyChange])
  useEffect(() => { busyCallback.current?.(isRestoring || isExporting) }, [isRestoring, isExporting])

  if (!isOpen) return null

  // Results stay on screen until the next action (the center no longer closes itself).
  const showFeedback = (type: 'success' | 'error' | 'info', message: string) => { setFeedback({ type, message }) }

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
    if (settingsRecovery.state !== 'pending' && settingsRecovery.state !== 'committed') return
    const undo = settingsRecovery.state === 'committed'
    try {
      // Consent covers the copy on screen only; a replaced copy is refused under the lock.
      const result = await restorePreviousSettings(targetStorage, { ...lockOptions, expectedRaw: settingsRecovery.raw })
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

  const executeRestore = async (parsed: ParsedBackupResult, isDestructive: boolean) => {
    // #257 F1: a new settings restore would replace the only copy of an unfinished one's original values.
    const recovery = inspectSettingsRecovery(targetStorage)
    if (recovery.state !== 'none' && (restoreChoice.appearance || restoreChoice.preferences)) {
      setPendingRestore(null)
      setSettingsRecovery(recovery)
      showFeedback('error', `Restore not started: ${recovery.state === 'pending' ? 'an earlier settings restore did not finish' : recovery.state === 'committed' ? 'a copy of the settings from before the last restore is still kept' : 'settings recovery data is damaged'}. Resolve it first (see above), or untick Appearance and Preferences to restore only the library. Nothing was changed.`)
      return
    }
    if (restoreBlockedRef.current) { showFeedback('error', RESTORE_BLOCKED_MESSAGE); return }
    setIsRestoring(true)
    try {
      const replace = isDestructive && !parsed.isSingleSetlist
      // Songs-only replacement leaves setlists to the caller, so it cannot be compared with the backup.
      const verifiable = replace ? !!onFullRestore : !!onSmartMerge
      // #251: every restore (merge or replace) saves a verified safety snapshot before the library changes.
      if (verifiable || replace) {
        try {
          await ensureRestoreSafetySnapshot({ songs: allSongs, setlists }, targetStorage)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          setPendingRestore(null)
          showFeedback('error', `Restore aborted: pre-restore safety snapshot failed to save (${msg}). Current library preserved.`)
          return
        }
      }
      // The editor may have opened while the snapshot was written.
      if (restoreBlockedRef.current) { setPendingRestore(null); showFeedback('error', RESTORE_BLOCKED_MESSAGE); return }
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
        const problems = [...await libraryWritesSaved(), ...verifyRestoredLibrary({ songs: allSongs, setlists }, { songs: parsed.songs, setlists: parsed.setlists },
          replace ? 'replace' : 'merge', targetStorage)]
        if (problems.length) {
          setPendingRestore(null)
          showFeedback('error', `Restore could not be verified: ${problems.join('; ')}. Settings were not changed. The previous library is kept in the safety snapshot.`)
          return
        }
      } else {
        setPendingRestore(null)
        showFeedback('info', replace && onFullRestoreSongs
          ? `Songs replaced (${parsed.songs.length}); not verified against the backup. Setlists and settings were not restored.`
          : `Imported ${parsed.songs.length} songs as new copies. Setlists and settings were not restored.`)
        return
      }

      appLogger.info('RestoreApplied', `Restore applied (${replace ? 'replace' : 'merge'}, file): ${parsed.songs.length} songs, ${parsed.setlists.length} setlists`)

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

  const failureMessage = (err: unknown) => isQuotaError(err)
    ? 'Storage quota exceeded: restore aborted and changes could not be saved to device storage.'
    : (err instanceof Error ? err.message : String(err))

  // Restore from file: read and check the file, then show the shared restore preview. Nothing changes yet.
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    try {
      if (restoreBlockedRef.current) { showFeedback('error', RESTORE_BLOCKED_MESSAGE); return }
      const text = await file.text()
      const parsed = parseBackupJson(text, { mode: 'merge', existingSongs: allSongs })
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
          return
        }
        showFeedback('error', preview.error || parsed.error || 'Invalid GTAR backup.')
        return
      }
      setFeedback(null)
      setPendingRestore({ rawText: text, parsed })
    } catch (err: unknown) {
      showFeedback('error', `Failed to restore backup: ${failureMessage(err)}`)
    } finally {
      input.value = ''
    }
  }

  const handleMerge = async () => {
    if (!pendingRestore || isRestoring) return
    try { await executeRestore(pendingRestore.parsed, false) }
    catch (err: unknown) { showFeedback('error', `Failed to restore backup: ${failureMessage(err)}`) }
  }

  const handleReplace = async () => {
    if (!pendingRestore || isRestoring) return
    // Replace checks the file on its own terms (merge may resolve setlist entries from this device's songs).
    const parsed = parseBackupJson(pendingRestore.rawText, { mode: 'replace' })
    if (!parsed.isValid) {
      setPendingRestore(null)
      showFeedback('error', `This file cannot replace the device: ${parsed.error || 'invalid GTAR backup'}. Nothing was changed; Merge into device is still possible.`)
      return
    }
    // ACTION 4: Coordinate restore success with durable persistence
    try {
      await executeRestore(parsed, true)
    } catch (err: unknown) {
      showFeedback('error', `Restore failed: ${failureMessage(err)}. Pre-restore library preserved in safety snapshot.`)
    }
  }

  const recoveryButton = `${secondaryButton} text-[11px]`
  const parsedPending = pendingRestore?.parsed
  return (
    <div data-testid="device-backup-card" className={sectionCard}>
      <input
        ref={restoreFileInputRef}
        data-testid="restore-file-input"
        type="file"
        accept=".json,application/json"
        onChange={handleRestoreFile}
        className="hidden"
      />
      <span className={sectionLabel}>This device (file)</span>
      <div className="grid grid-cols-1 gap-2 pt-2 border-t border-app-border/60 text-[11px] font-mono">
        <div className="min-w-0">
          <span className="text-app-muted block">On this device</span>
          <span className="text-app-heading font-semibold block truncate">{listCounts({ songs: allSongs, setlists })}</span>
        </div>
      </div>

      {settingsRecovery.state !== 'none' && (
        <div role="alert" data-testid="settings-recovery" className={`${tone.error} space-y-2`}>
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
              <button type="button" onClick={handlePutBackSettings} className={recoveryButton}>Put back previous settings</button>
            )}
            {settingsRecovery.state === 'committed' && (
              <>
                <button type="button" onClick={handleDiscardSettingsRecovery} className={recoveryButton}>Keep current settings</button>
                <button type="button" onClick={handlePutBackSettings} className={recoveryButton}>Undo that restore</button>
              </>
            )}
            {settingsRecovery.state !== 'committed' && (
              <>
                <button type="button" onClick={handleDownloadSettingsRecovery} className={recoveryButton}>Download recovery data</button>
                {confirmDiscard ? (
                  <button type="button" onClick={handleDiscardSettingsRecovery} className={recoveryButton}>
                    Confirm discard{settingsRecovery.state === 'pending' ? ' (the saved previous settings are lost)' : ''}
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmDiscard(true)} className={recoveryButton}>
                    {settingsRecovery.state === 'pending' ? 'Discard saved previous settings' : 'Discard damaged recovery data'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {restoreBlocked && <p role="status" className={tone.warning}>{RESTORE_BLOCKED_MESSAGE}</p>}

      {pendingRestore && parsedPending ? (
        <RestorePreview
          sourceLabel="Backup file"
          device={{ songs: allSongs, setlists }}
          backup={{ songs: parsedPending.songs, setlists: parsedPending.setlists }}
          provenance={{ appVersion: parsedPending.metadata?.version, schemaVersion: parsedPending.metadata?.schemaVersion, createdAt: parsedPending.metadata?.exportedAt }}
          canReplace={!parsedPending.isSingleSetlist}
          settings={{ appearance: fieldCount(parsedPending.settings.appearance), preferences: fieldCount(parsedPending.settings.preferences), choice: restoreChoice, onChoice: setRestoreChoice }}
          note={parsedPending.ignoredFields.length > 0 && (
            <p className="text-[11px] text-app-muted leading-snug">
              Not restored (unknown to this version): {parsedPending.ignoredFields.slice(0, 8).join(', ')}{parsedPending.ignoredFields.length > 8 ? ', …' : ''}
            </p>
          )}
          busy={isRestoring}
          blocked={restoreBlocked}
          onMerge={() => { void handleMerge() }}
          onReplace={() => { void handleReplace() }}
          onCancel={() => setPendingRestore(null)}
        />
      ) : (
        <div className="space-y-2 pt-1">
          <button type="button" data-testid="save-backup-file-button" disabled={isExporting} onClick={handleSaveBackup} className={primaryButton}>
            <Share2 className="w-4 h-4" aria-hidden="true" />
            <span>{isExporting ? 'Preparing backup…' : preparedBackup ? 'Open share sheet' : 'Save backup file'}</span>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={handleDownloadBackup} className={secondaryButton}>
              <Download className="max-sm:hidden w-3.5 h-3.5 text-app-link" aria-hidden="true" />
              <span>Download .json</span>
            </button>
            <button type="button" onClick={handleCopyBackup} className={secondaryButton}>
              <Copy className="max-sm:hidden w-3.5 h-3.5 text-app-link" aria-hidden="true" />
              <span>Copy JSON</span>
            </button>
          </div>
          <button type="button" data-testid="restore-file-button" disabled={isRestoring || restoreBlocked}
            onClick={() => restoreFileInputRef.current?.click()} className={outlinedButton}>
            <Upload className="w-3.5 h-3.5 text-app-link" aria-hidden="true" />
            <span>Restore from file</span>
          </button>
        </div>
      )}

      {feedback && (
        <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`${tone[feedback.type]} whitespace-pre-wrap`}>{feedback.message}</p>
      )}

    </div>
  )
}
