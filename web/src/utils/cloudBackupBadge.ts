import { useCallback, useEffect, useMemo, useState } from 'react'
import { SETTINGS_CHANGED, readCloudThemeSettings, settingsSignature } from './backupSettings'
import { SETTINGS_CHECKSUM_SCHEME, computeSongbookChecksum, verifySongbookChecksum, type CloudSongbookRecord } from './cloudBackupFormat'
import { stableStringify } from './contentHash'
import { SESSION_STORAGE_KEY, LEGACY_STORAGE_KEY } from './googleAuth'
import { captureCloudBackup } from './manualCloudBackup'
import { readPersistedLibrary } from './syncJournal'

/** Compare only verified cloud records, using their original checksum contract. */
function matchesCloud(record: CloudSongbookRecord): boolean | null {
  try {
    const library = readPersistedLibrary()
    if (!library) return null
    if (record.data.checksumScheme === SETTINGS_CHECKSUM_SCHEME) {
      return computeSongbookChecksum(captureCloudBackup(library)) === record.checksum
    }
    // Historical checksums omit folders/tag colours. Compare those separately;
    // retain the verifier's documented unversioned tag compatibility.
    const data = { songs: library.songs, setlists: library.setlists,
      ...(record.data.themeSettings === undefined ? {} : { themeSettings: readCloudThemeSettings() }),
      checksumScheme: record.data.checksumScheme }
    return verifySongbookChecksum({ ...record, data }) &&
      stableStringify(library.folders) === stableStringify(record.data.folders) &&
      stableStringify(library.tagColors) === stableStringify(record.data.tagColors)
  } catch { return null }
}

/** A proof belongs to one uninterrupted auth session, never to a persisted cache. */
export function useCloudBackupBadge(sessionKey: string, isOpen: boolean) {
  const [proof, setProof] = useState<{ key: string; epoch: object; record: CloudSongbookRecord | null | undefined }>(
    () => ({ key: sessionKey, epoch: {}, record: undefined }))
  if (proof.key !== sessionKey) setProof({ key: sessionKey, epoch: {}, record: undefined })
  const { epoch } = proof
  const record = proof.key === sessionKey ? proof.record : undefined
  const onBackupSummary = useCallback((record: CloudSongbookRecord | null | undefined) => {
    setProof(current => current.key === sessionKey && current.epoch === epoch ? { ...current, record } : current)
  }, [sessionKey, epoch])
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === SESSION_STORAGE_KEY || event.key === LEGACY_STORAGE_KEY ||
        event.key === 'gtar_manual_cloud_backup_dates' || event.key === 'gtar_manual_cloud_backup_checksums') {
        setProof(current => ({ ...current, epoch: {}, record: undefined }))
      }
      refresh()
    }
    window.addEventListener('gtar-library-persisted', refresh)
    window.addEventListener(SETTINGS_CHANGED, refresh)
    window.addEventListener('storage', storageChanged)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('gtar-library-persisted', refresh)
      window.removeEventListener(SETTINGS_CHANGED, refresh)
      window.removeEventListener('storage', storageChanged)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  // Same-tab settings writes are re-read on render and Backup center open/close,
  // including writers that predate SETTINGS_CHANGED. No status polling.
  let signature: string | null = null
  try { signature = settingsSignature() } catch { /* SSR and denied browser storage cannot provide a settings snapshot. */ }
  const matches = useMemo(() => record ? matchesCloud(record) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- These triggers re-read committed library/settings storage.
    [record, revision, signature, isOpen])
  return { record, matches, onBackupSummary }
}
