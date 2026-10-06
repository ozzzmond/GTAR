import { parseBackupJson } from '../utils/jsonBackup'
import { readBackupSettings } from '../utils/backupSettings'
import React, { useState, useRef, useMemo } from 'react'
import {
  X,
  Download,
  Upload,
  Copy,
  Check,
  FileJson,
  Music,
  ListMusic,
  CloudUpload,
  AlertCircle
} from 'lucide-react'
import {
  GTAR_APP_VERSION,
  GTAR_SETLIST_VERSION,
  GTAR_SETLIST_TYPE,
  type ActiveSongState,
  type SongEntity,
  type GtarSetlist,
  type GtarBackup,
} from '../types/gtar'

interface JsonBridgeModalProps {
  isOpen: boolean
  initialTab?: 'export' | 'import'
  onClose: () => void
  song: ActiveSongState
  allSongs?: ActiveSongState[]
  onImportSong: (imported: Partial<ActiveSongState>) => void
  onImportAllSongs?: (importedList: Array<Partial<ActiveSongState>>) => void
}

export const JsonBridgeModal: React.FC<JsonBridgeModalProps> = ({
  isOpen,
  initialTab = 'export',
  onClose,
  song,
  allSongs,
  onImportSong,
  onImportAllSongs,
}) => {
  const [tab, setTab] = useState<'export' | 'import'>(initialTab)
  const [exportFormat, setExportFormat] = useState<'song' | 'setlist' | 'backup'>('song')
  const [setlistName, setSetlistName] = useState('My Setlist')
  const [copied, setCopied] = useState(false)

  // Import states
  const [importJsonText, setImportJsonText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [detectedSongs, setDetectedSongs] = useState<Array<Partial<ActiveSongState> & { title: string; content: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [exportTimestamp] = useState(() => Date.now())

  // Generate Song Room Entity, Setlist, and Full GTAR Backup payloads matching Android v1.0.42
  const { songRoomPayload, setlistPayload, backupPayload } = useMemo(() => {
    const isoString = new Date(exportTimestamp).toISOString()
    const songList = allSongs ?? [song]

    // 1. Native SongEntity (.json)
    const songEntity: SongEntity = {
      id: song.id || 0,
      title: song.title || 'Untitled Song',
      artist: song.artist || '',
      key: song.key || '',
      capo: song.capo || '',
      rawContent: song.rawContent,
      format: song.format,
      isFavorite: song.isFavorite ?? false,
      transposeOffset: song.transposeOffset || 0,
      tags: song.tags ?? '',
      isDeleted: song.isDeleted ?? false,
      createdAt: song.createdAt ?? exportTimestamp,
      lastOpenedAt: song.lastOpenedAt ?? exportTimestamp,
    }

    // 2. GTAR Setlist (.json) matching SetlistExportImportManager.kt
    const gtarSetlist: GtarSetlist = {
      version: GTAR_SETLIST_VERSION,
      type: GTAR_SETLIST_TYPE,
      name: setlistName.trim() || 'GTAR Setlist',
      createdAt: isoString,
      songs: songList.map((s, index) => ({
        ...s,
        title: s.title || 'Untitled Song',
        artist: s.artist || '',
        key: s.key || '',
        chordsContent: s.rawContent,
        order: index + 1,
      })),
    }

    // 3. Full GTAR Backup payload matching Android BackupManager.kt (v1.0.42)
    const gtarBackup: GtarBackup = {
      ...(isOpen ? readBackupSettings() : {}),
      metadata: {
        appName: 'GTAR',
        appVersion: GTAR_APP_VERSION,
        exportTimestamp,
      },
      songs: songList.map((s, idx) => ({
        id: s.id || idx + 1,
        title: s.title || 'Untitled Song',
        artist: s.artist || '',
        key: s.key || '',
        capo: s.capo || '',
        rawContent: s.rawContent,
        format: s.format,
        isFavorite: s.isFavorite ?? false,
        transposeOffset: s.transposeOffset || 0,
        tags: s.tags ?? '',
        isDeleted: s.isDeleted ?? false,
        createdAt: s.createdAt ?? exportTimestamp,
        lastOpenedAt: s.lastOpenedAt ?? exportTimestamp,
      })),
      setlists: [
        {
          name: setlistName.trim() || 'GTAR Setlist',
          createdAt: exportTimestamp,
          songs: songList.map((s, idx) => ({
            title: s.title || 'Untitled Song',
            artist: s.artist || '',
            position: idx,
          })),
        },
      ],
    }

    return { songRoomPayload: songEntity, setlistPayload: gtarSetlist, backupPayload: gtarBackup }
  }, [song, allSongs, setlistName, exportTimestamp, isOpen])

  if (!isOpen) return null

  const exportPayloadString =
    exportFormat === 'song'
      ? JSON.stringify(songRoomPayload, null, 2)
      : exportFormat === 'setlist'
      ? JSON.stringify(setlistPayload, null, 2)
      : JSON.stringify(backupPayload, null, 2)

  const handleCopy = () => {
    navigator.clipboard.writeText(exportPayloadString).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleDownload = () => {
    let filename: string
    if (exportFormat === 'song') {
      filename = `${(song.title || 'song').toLowerCase().replace(/[^a-z0-9]/gi, '_')}.song.json`
    } else if (exportFormat === 'setlist') {
      filename = `${(setlistName || 'setlist').toLowerCase().replace(/[^a-z0-9]/gi, '_')}.setlist.json`
    } else {
      const now = new Date(exportTimestamp)
      const yyyy = now.getFullYear()
      const MM = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const HH = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      filename = `gtar_backup_${yyyy}${MM}${dd}_${HH}${mm}.json`
    }

    const blob = new Blob([exportPayloadString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const parseJsonData = (text: string) => {
    setImportError(null)
    setDetectedSongs([])

    const trimmed = text.trim()
    if (!trimmed) {
      setImportError('Please enter or paste JSON content.')
      return
    }

    try {
      const data = JSON.parse(trimmed)

      // Adapt the native setlist content field, then use the shared strict parser.
      const adaptSong = (item: unknown) => {
        if (!item || typeof item !== 'object') return item
        const obj = item as { rawContent?: unknown; chordsContent?: unknown; content?: unknown }
        return {
          ...obj,
          rawContent: obj.rawContent ?? obj.chordsContent ?? obj.content,
        }
      }
      const payload = data?.type === 'GTAR_SETLIST' && Array.isArray(data.songs)
        ? { songs: data.songs.map(adaptSong) }
        : Array.isArray(data) ? data.map(adaptSong)
        : data?.title ? adaptSong(data) : data
      const parsed = parseBackupJson(JSON.stringify(payload), { mode: 'merge', existingSongs: allSongs ?? [] })
      if (!parsed.isValid) {
        setImportError(parsed.error || 'Invalid backup')
        return
      }
      setDetectedSongs(parsed.songs.map(song => ({ ...song, content: song.rawContent })))
    } catch (err: unknown) {
      setImportError(`JSON syntax error: ${err instanceof Error ? err.message : 'Invalid JSON'}`)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      const content = evt.target?.result as string
      setImportJsonText(content)
      parseJsonData(content)
    }
    reader.readAsText(file)
  }

  const handleSelectSongToLoad = (item: Partial<ActiveSongState> & { title: string; content: string }) => {
    onImportSong({
      ...item,
      title: item.title,
      artist: item.artist || '',
      key: item.key || '',
      rawContent: item.content,
      transposeOffset: item.transposeOffset ?? 0,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-2xl rounded-2xl border border-app-border bg-app-surface shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-base">
          <div className="flex items-center gap-2">
            <FileJson className="w-5 h-5 text-app-action" />
            <h2 className="text-base font-bold text-app-heading">
              GTAR JSON Bridge (v1.0.45+)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-app-muted hover:text-app-heading hover:bg-app-surface cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-app-border bg-app-base/60 px-6">
          <button
            type="button"
            onClick={() => setTab('export')}
            className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 cursor-pointer transition-colors ${
              tab === 'export'
                ? 'border-app-accent text-app-accent'
                : 'border-transparent text-app-muted hover:text-app-heading'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Export Backup & JSON</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('import')}
            className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 cursor-pointer transition-colors ${
              tab === 'import'
                ? 'border-app-action text-app-action'
                : 'border-transparent text-app-muted hover:text-app-heading'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Import Songs / Setlists</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 text-xs">
          {tab === 'export' ? (
            <div className="space-y-4">
              {/* Format selection */}
              <div>
                <label className="block text-app-muted font-mono text-[11px] mb-2 uppercase">
                  Select Android Export Schema:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setExportFormat('song')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 cursor-pointer transition-all ${
                      exportFormat === 'song'
                        ? 'border-app-action bg-app-base text-app-heading ring-1 ring-app-action'
                        : 'border-app-border bg-app-base/50 text-app-muted hover:border-app-border'
                    }`}
                  >
                    <Music className="w-4 h-4 text-app-action shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-xs text-app-heading">Native SongEntity</div>
                      <div className="text-[11px] text-app-muted mt-0.5">
                        Single song Room entity (.json)
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat('setlist')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 cursor-pointer transition-all ${
                      exportFormat === 'setlist'
                        ? 'border-app-accent bg-app-base text-app-heading ring-1 ring-app-accent'
                        : 'border-app-border bg-app-base/50 text-app-muted hover:border-app-border'
                    }`}
                  >
                    <ListMusic className="w-4 h-4 text-app-accent shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-xs text-app-heading">GTAR Setlist</div>
                      <div className="text-[11px] text-app-muted mt-0.5">
                        GTAR_SETLIST v1 share (.json)
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat('backup')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 cursor-pointer transition-all ${
                      exportFormat === 'backup'
                        ? 'border-app-link bg-app-base text-app-heading ring-1 ring-app-link'
                        : 'border-app-border bg-app-base/50 text-app-muted hover:border-app-border'
                    }`}
                  >
                    <CloudUpload className="w-4 h-4 text-app-link shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-xs text-app-heading">Export Backup</div>
                      <div className="text-[11px] text-app-muted mt-0.5">
                        Full GTAR v1.0.45 backup (.json)
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {(exportFormat === 'setlist' || exportFormat === 'backup') && (
                <div>
                  <label className="block text-app-muted font-mono text-[11px] mb-1 uppercase">
                    Setlist Name:
                  </label>
                  <input
                    type="text"
                    value={setlistName}
                    onChange={(e) => setSetlistName(e.target.value)}
                    placeholder="Enter setlist name"
                    className="w-full px-3 py-2 rounded-lg bg-app-base border border-app-border text-app-heading focus:outline-none focus:border-app-accent"
                  />
                </div>
              )}

              {/* JSON Preview Box */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-app-muted font-mono text-[11px] uppercase">
                    Generated JSON Payload:
                  </span>
                  <span className="text-app-muted font-mono text-[10px]">
                    {exportPayloadString.length} bytes
                  </span>
                </div>
                <textarea
                  readOnly
                  value={exportPayloadString}
                  rows={8}
                  className="w-full p-3 rounded-xl bg-app-base border border-app-border text-app-action font-mono text-xs focus:outline-none resize-none selection:bg-app-action/20"
                />
              </div>

              {/* Export Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-4 py-2.5 rounded-xl border border-app-border bg-app-base text-app-text hover:border-app-action hover:text-app-action font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied to Clipboard' : 'Copy JSON'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-5 py-2.5 rounded-xl bg-app-button hover:bg-app-button/90 text-app-button-text font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-app-accent/20"
                >
                  <Download className="w-4 h-4" />
                  <span>Download .json File</span>
                </button>
              </div>
            </div>
          ) : (
            /* Import Tab */
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-app-muted font-mono text-[11px] uppercase">
                    Paste JSON or Upload File:
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-app-action hover:underline flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload .json File</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
                <textarea
                  value={importJsonText}
                  onChange={(e) => {
                    setImportJsonText(e.target.value)
                    parseJsonData(e.target.value)
                  }}
                  placeholder="Paste GTAR Setlist JSON, SongEntity JSON, or Backup JSON here..."
                  rows={6}
                  className="w-full p-3 rounded-xl bg-app-base border border-app-border text-app-heading font-mono text-xs focus:outline-none focus:border-app-action resize-none"
                />
              </div>

              {importError && (
                <div className="p-3 rounded-xl bg-[#DC6E67]/10 border border-[#DC6E67]/40 text-status-error flex items-center gap-2 font-mono">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {detectedSongs.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-app-muted font-mono text-[11px] uppercase">
                      Detected Songs ({detectedSongs.length}):
                    </span>
                    {detectedSongs.length > 1 && onImportAllSongs && (
                      <button
                        type="button"
                        onClick={() => {
                          onImportAllSongs(
                            detectedSongs.map((s) => ({
                              ...s,
                              title: s.title,
                              artist: s.artist || '',
                              key: s.key || '',
                              rawContent: s.content,
                            }))
                          )
                          onClose()
                        }}
                        className="text-xs text-app-action hover:underline flex items-center gap-1 cursor-pointer font-medium"
                      >
                        <ListMusic className="w-3.5 h-3.5" />
                        <span>Import All Songs ({detectedSongs.length})</span>
                      </button>
                    )}
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {detectedSongs.map((s, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-app-base border border-app-border flex items-center justify-between hover:border-app-action transition-colors"
                      >
                        <div>
                          <div className="font-bold text-app-heading">{s.title}</div>
                          <div className="text-[11px] text-app-muted mt-0.5 flex items-center gap-2">
                            {s.artist && <span>{s.artist}</span>}
                            {s.key && <span className="text-app-accent font-mono">Key: {s.key}</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectSongToLoad(s)}
                          className="px-3 py-1.5 rounded-lg bg-app-action text-app-on-action font-bold text-xs hover:bg-app-action transition-colors cursor-pointer"
                        >
                          Load into Editor
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
