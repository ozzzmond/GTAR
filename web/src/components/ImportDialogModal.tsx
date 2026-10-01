import React, { useRef, useState } from 'react'
import { FolderOpen, FileText, FolderUp, X, Check, AlertCircle, Search } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { parseGtarSong, detectSongKey } from '../utils/songParser'
import { extractDirectives } from '../utils/chordSheetParser'
import { parseBackupJson } from '../utils/jsonBackup'

interface ImportDialogModalProps {
  isOpen: boolean
  onClose: () => void
  onImportSong: (song: Partial<ActiveSongState>) => void
  onImportAllSongs: (songs: Array<Partial<ActiveSongState>>) => void
  onImportSingleSetlist?: (setlist: WebSetlist, songs: ActiveSongState[]) => void
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void
  onOpenMetadataReviewModal?: () => void
  existingSongs?: ActiveSongState[]
}

export const ImportDialogModal: React.FC<ImportDialogModalProps> = ({
  isOpen,
  onClose,
  onImportSong,
  onImportAllSongs,
  onImportSingleSetlist,
  onSmartMerge,
  onOpenMetadataReviewModal,
  existingSongs = [],
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  )

  if (!isOpen) return null

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message })
    setTimeout(() => {
      setFeedback(null)
      if (type === 'success') {
        onClose()
      }
    }, 1800)
  }

  // Parse a text or loose json file content into song state
  const parseFileContent = (filename: string, content: string): Partial<ActiveSongState> | null => {
    const trimmed = content.trim()
    if (!trimmed) return null

    if (filename.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        // Under no circumstances should raw backup JSON be parsed as a song!
        if (parsed.metadata?.appName === 'GTAR' || parsed.app === 'GTAR' || Array.isArray(parsed.songs) || parsed.exportType === 'SINGLE_SETLIST') {
          return null
        }

        if (parsed.title || parsed.rawContent) {
          const rawContent = parsed.rawContent || parsed.content || ''
          return {
            title: parsed.title || filename.replace(/\.[^/.]+$/, ''),
            artist: parsed.artist || '',
            key: parsed.key || detectSongKey(rawContent),
            capo: parsed.capo || '',
            bpm: parsed.bpm || '120',
            rawContent,
            format: parsed.format || 'CHORD_PRO',
            transposeOffset: parsed.transposeOffset || 0,
          }
        }
      } catch {
        // Fall back to text parsing if JSON parse fails
      }
    }

    // Treat as ChordPro / text chords
    const directives = extractDirectives(content)
    const baseTitle = directives.title || filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
    const parsedSong = parseGtarSong(content, 0)

    return {
      title: baseTitle,
      artist: directives.artist || parsedSong.artist || '',
      key: directives.key || parsedSong.key || detectSongKey(content),
      capo: directives.capo || parsedSong.capo || 'No Capo',
      bpm: directives.bpm || parsedSong.bpm || '120',
      rawContent: content,
      format: parsedSong.format || 'CHORD_PRO',
      transposeOffset: 0,
    }
  }

  // Handle single file import (.txt, .chordpro, .json)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      // 1. First check if it's a valid GTAR JSON file (single setlist, backup package, or song list)
      if (file.name.toLowerCase().endsWith('.json')) {
        try {
          const parsed = parseBackupJson(text, { mode: 'merge', existingSongs })
          if (parsed.isValid) {
            // A. Single Setlist package (.json)
            if (parsed.isSingleSetlist && parsed.setlists.length > 0) {
              if (onImportSingleSetlist) {
                onImportSingleSetlist(parsed.setlists[0], parsed.songs as ActiveSongState[])
              } else if (onSmartMerge) {
                onSmartMerge(parsed.songs, parsed.setlists)
              } else {
                onImportAllSongs(parsed.songs)
              }
              showFeedback('success', `Imported setlist "${parsed.singleSetlistName || parsed.setlists[0].name}" (${parsed.songs.length} tracks)!`)
              return
            }

            // B. Multi-setlist backup / song package (.json)
            if (parsed.setlists.length > 0) {
              if (onSmartMerge) {
                onSmartMerge(parsed.songs, parsed.setlists)
                showFeedback('success', `Imported ${parsed.songs.length} songs and ${parsed.setlists.length} setlists!`)
                return
              }
            }

            // C. Multi-song list (.json)
            if (parsed.songs.length > 1) {
              onImportAllSongs(parsed.songs)
              showFeedback('success', `Imported ${parsed.songs.length} songs from song package!`)
              return
            }

            // D. Single song (.json)
            if (parsed.songs.length === 1) {
              onImportSong(parsed.songs[0])
              showFeedback('success', `Successfully imported "${parsed.songs[0].title}"!`)
              return
            }
          }
        } catch {
          // Fall through to loose file content parsing
        }
      }

      // 2. Loose song file content (.txt, .chordpro, loose JSON)
      const song = parseFileContent(file.name, text)
      if (song) {
        onImportSong(song)
        showFeedback('success', `Successfully imported "${song.title}"!`)
      } else {
        showFeedback('error', 'Could not read valid song content or setlist from file.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showFeedback('error', `Failed to read file: ${msg}`)
    }

    if (e.target) e.target.value = ''
  }

  // Handle folder batch import
  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const validExtensions = ['.txt', '.chordpro', '.chopro', '.pro', '.chordtxt', '.crd', '.tab', '.json']
    const importedList: Array<Partial<ActiveSongState>> = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const lower = file.name.toLowerCase()
      const isValidExt = validExtensions.some((ext) => lower.endsWith(ext))
      if (!isValidExt) continue

      try {
        const text = await file.text()
        const song = parseFileContent(file.name, text)
        if (song && song.rawContent) {
          importedList.push(song)
        }
      } catch {
        // skip failed files
      }
    }

    if (importedList.length > 0) {
      onImportAllSongs(importedList)
      showFeedback('success', `Batch imported ${importedList.length} songs from folder!`)
    } else {
      showFeedback('error', 'No valid chord charts or song files found in folder.')
    }

    if (e.target) e.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-[#073642] border border-[#1A4A55] shadow-2xl overflow-hidden flex flex-col">
        {/* Hidden inputs for native file and directory pickers */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.chordpro,.chopro,.pro,.chordtxt,.crd,.tab,.json,text/*,application/json"
          onChange={handleFileChange}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-ignore
          webkitdirectory="true"
          directory="true"
          multiple
          onChange={handleFolderChange}
          className="hidden"
        />

        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1A4A55] flex items-center justify-between bg-[#002B36]/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2AA198]/20 border border-[#2AA198]/30 flex items-center justify-center text-[#2AA198]">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#FDF6E3]">Import Songs &amp; Setlists</h2>
              <p className="text-xs text-[#93A1A1]">Import chord charts, songs, or exported setlists</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#002B36] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-[#93A1A1] leading-relaxed">
            Choose an import method for your songs, chord charts, or setlists:
          </p>

          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-[#2AA198]/15 border-[#2AA198]/40 text-[#2AA198]'
                  : 'bg-[#DC6E67]/15 border-[#DC6E67]/40 text-[#DC6E67]'
              }`}
            >
              {feedback.type === 'success' ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Option 1: Import File */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full text-left p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#2AA198] hover:bg-[#094352]/30 transition-all flex items-center gap-3.5 group cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-[#073642] flex items-center justify-center text-[#2AA198] group-hover:scale-105 transition-transform">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#2AA198] transition-colors">
                Import File (.txt, .chordpro, .json)
              </div>
              <div className="text-[11px] text-[#93A1A1] mt-0.5 leading-snug">
                Select single song, chord sheet, or exported setlist JSON
              </div>
            </div>
          </button>

          {/* Option 2: Import Folder (Batch) */}
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="w-full text-left p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#2AA198] hover:bg-[#094352]/30 transition-all flex items-center gap-3.5 group cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-[#073642] flex items-center justify-center text-[#2AA198] group-hover:scale-105 transition-transform">
              <FolderUp className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#2AA198] transition-colors">
                Import Folder (Batch)
              </div>
              <div className="text-[11px] text-[#93A1A1] mt-0.5 leading-snug">
                Select folder to batch import all chord charts and songs
              </div>
            </div>
          </button>

          {/* Option 3: Review & Update Metadata (GetSongBPM) */}
          {onOpenMetadataReviewModal && (
            <button
              type="button"
              data-testid="import-dialog-open-metadata-btn"
              onClick={() => {
                onClose()
                onOpenMetadataReviewModal()
              }}
              className="w-full text-left p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#2AA198] hover:bg-[#094352]/30 transition-all flex items-center gap-3.5 group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-[#073642] flex items-center justify-center text-[#2AA198] group-hover:scale-105 transition-transform">
                <Search className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#2AA198] transition-colors">
                  Check &amp; Update Song Metadata (GetSongBPM)
                </div>
                <div className="text-[11px] text-[#93A1A1] mt-0.5 leading-snug">
                  Look up and selectively update Original Keys, BPM, and Release Years
                </div>
              </div>
            </button>
          )}

          <div className="p-3 rounded-xl bg-[#002B36]/50 border border-[#1A4A55]/60 text-[11px] text-[#93A1A1] leading-relaxed">
            <span className="font-semibold text-[#859900]">Looking for Full Library Backup / Restore?</span> Use the profile menu (<span className="text-[#FDF6E3] font-medium">Backup &amp; Restore</span>) to export or restore complete app settings, themes, and full library snapshots.
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#1A4A55] bg-[#002B36]/30 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#002B36] border border-[#1A4A55] text-xs font-semibold text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
