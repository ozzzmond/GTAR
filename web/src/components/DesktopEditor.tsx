import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  Music,
  Hash,
  Activity,
  Type,
  User,
  Tag,
  Save,
  FileEdit,
  Library,
  Bookmark,
  ClipboardPaste,
  Copy,
  Trash2,
  ArrowLeft,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { parseGtarSong, standardizeChordProBrackets } from '../utils/songParser'
import { SongLineRenderer } from './SongLineRenderer'
import type { ActiveSongState } from '../types/gtar'

interface DesktopEditorProps {
  song: ActiveSongState
  onUpdateSong: (updated: Partial<ActiveSongState>) => void
  onSaveSong?: (updated: ActiveSongState) => void
  onClose?: () => void
  transposeOffset: number
}

const QUICK_GENRE_TAGS = ['Worship', 'OPM', 'Acoustic', 'Rock', 'Slow Rock', 'Encore']
const QUICK_SECTIONS = ['[Intro]', '[Verse 1]', '[Chorus]', '[Bridge]', '[Solo]', '[Outro]', '[Tab]']

export const DesktopEditor: React.FC<DesktopEditorProps> = ({
  song,
  onUpdateSong,
  onSaveSong,
  onClose,
  transposeOffset,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Local editor state initialized from active song
  const [localTitle, setLocalTitle] = useState(song.title || '')
  const [localArtist, setLocalArtist] = useState(song.artist || '')
  const [localKey, setLocalKey] = useState(song.key || '')
  const [localCapo, setLocalCapo] = useState(song.capo || '')
  const [localBpm, setLocalBpm] = useState(song.bpm || '')
  const [localTags, setLocalTags] = useState(song.tags || '')
  const [localRawContent, setLocalRawContent] = useState(() =>
    standardizeChordProBrackets(song.rawContent || '')
  )

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [isSaved, setIsSaved] = useState(true)
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false)

  // Reset local state when active song changes
  useEffect(() => {
    setLocalTitle(song.title || '')
    setLocalArtist(song.artist || '')
    setLocalKey(song.key || '')
    setLocalCapo(song.capo || '')
    setLocalBpm(song.bpm || '')
    setLocalTags(song.tags || '')
    setLocalRawContent(standardizeChordProBrackets(song.rawContent || ''))
    setIsSaved(true)
  }, [song.id, song.title])

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Real-time live stage preview parsing
  const parsedSong = useMemo(() => {
    return parseGtarSong(localRawContent, transposeOffset)
  }, [localRawContent, transposeOffset])

  // Handle saving changes
  const handleSave = () => {
    const standardized = standardizeChordProBrackets(localRawContent)
    const updatedSong: ActiveSongState = {
      ...song,
      title: localTitle.trim() || 'Untitled Song',
      artist: localArtist.trim(),
      key: localKey.trim(),
      capo: localCapo.trim(),
      bpm: localBpm.trim(),
      tags: localTags.trim(),
      rawContent: standardized,
      format: 'CHORD_PRO',
      transposeOffset: song.transposeOffset || 0,
    }

    if (onSaveSong) {
      onSaveSong(updatedSong)
    } else {
      onUpdateSong(updatedSong)
    }

    setIsSaved(true)
    showToast('Songbook saved!')
  }

  // Toggle quick genre tag chip
  const handleToggleTag = (tag: string) => {
    setIsSaved(false)
    const currentTags = localTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const isSelected = currentTags.some((t) => t.toLowerCase() === tag.toLowerCase())
    let nextTags: string[]

    if (isSelected) {
      nextTags = currentTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
    } else {
      nextTags = [...currentTags, tag]
    }

    setLocalTags(nextTags.join(', '))
  }

  // Raw text change handler (eliminates erratic angle brackets on the fly)
  const handleRawContentChange = (newText: string) => {
    setIsSaved(false)
    // Automatically sanitize angle bracket chords <C> -> [C]
    const cleaned = standardizeChordProBrackets(newText)
    setLocalRawContent(cleaned)
    // Synchronize to parent for auto-save redundancy
    onUpdateSong({ rawContent: cleaned })
  }

  // Helper 1: Mark Selection / Word as Chord [Chords] (matching Android PreSaveSongReviewDialog)
  const markSelectionAsChord = () => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = localRawContent

    if (start !== end) {
      // User has selected text
      const selected = text.substring(start, end).trim()
      const wrapped =
        selected.startsWith('[') && selected.endsWith(']') ? selected : `[${selected}]`
      const newText = text.substring(0, start) + wrapped + text.substring(end)
      handleRawContentChange(newText)

      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start, start + wrapped.length)
      }, 10)
    } else {
      // Cursor is at a single position: find word boundary or insert []
      if (text.length === 0) {
        handleRawContentChange('[]')
        setTimeout(() => {
          textarea.focus()
          textarea.setSelectionRange(1, 1)
        }, 10)
        return
      }

      let wStart = start
      while (wStart > 0 && !/\s/.test(text[wStart - 1]) && !'[]\n'.includes(text[wStart - 1])) {
        wStart--
      }
      let wEnd = start
      while (wEnd < text.length && !/\s/.test(text[wEnd]) && !'[]\n'.includes(text[wEnd])) {
        wEnd++
      }

      if (wStart < wEnd) {
        const word = text.substring(wStart, wEnd)
        const wrapped = word.startsWith('[') && word.endsWith(']') ? word : `[${word}]`
        const newText = text.substring(0, wStart) + wrapped + text.substring(wEnd)
        handleRawContentChange(newText)

        setTimeout(() => {
          textarea.focus()
          textarea.setSelectionRange(wStart + wrapped.length, wStart + wrapped.length)
        }, 10)
      } else {
        const newText = text.substring(0, start) + '[]' + text.substring(start)
        handleRawContentChange(newText)

        setTimeout(() => {
          textarea.focus()
          textarea.setSelectionRange(start + 1, start + 1)
        }, 10)
      }
    }
  }

  // Helper 2: Mark Selection / Line as Section Header [Section] (matching Android)
  const markSelectionAsSection = () => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = localRawContent

    if (start !== end) {
      const selected = text.substring(start, end).trim()
      const wrapped =
        selected.startsWith('[') && selected.endsWith(']') ? selected : `[${selected}]`
      const newText = text.substring(0, start) + wrapped + text.substring(end)
      handleRawContentChange(newText)

      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start, start + wrapped.length)
      }, 10)
    } else {
      // Find line boundaries
      const lineStart =
        text.lastIndexOf('\n', Math.max(0, start - 1)) === -1
          ? 0
          : text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const lineEnd = text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start)
      const lineContent = text.substring(lineStart, lineEnd).trim()

      if (lineContent.length > 0 && !lineContent.startsWith('[') && !lineContent.endsWith(']')) {
        const wrapped = `[${lineContent}]`
        const newText = text.substring(0, lineStart) + wrapped + text.substring(lineEnd)
        handleRawContentChange(newText)

        setTimeout(() => {
          textarea.focus()
          textarea.setSelectionRange(lineStart, lineStart + wrapped.length)
        }, 10)
      } else {
        const placeholder = '[Section]'
        const prefix = start > 0 && !text.substring(0, start).endsWith('\n') ? '\n' : ''
        const suffix = !text.substring(start).startsWith('\n') ? '\n' : ''
        const inserted = `${prefix}${placeholder}${suffix}`
        const newText = text.substring(0, start) + inserted + text.substring(start)
        handleRawContentChange(newText)

        setTimeout(() => {
          textarea.focus()
          const selStart = start + prefix.length + 1
          const selEnd = selStart + 7 // "Section"
          textarea.setSelectionRange(selStart, selEnd)
        }, 10)
      }
    }
  }

  // Helper 3: Paste from clipboard
  const handlePasteClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText()
      if (!clipText) return

      const sanitized = standardizeChordProBrackets(clipText)
      const textarea = textareaRef.current
      if (!textarea) {
        handleRawContentChange(sanitized)
        return
      }

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const text = localRawContent
      const updated = text.substring(0, start) + sanitized + text.substring(end)
      handleRawContentChange(updated)

      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + sanitized.length, start + sanitized.length)
      }, 10)
      showToast('Pasted and standardized ChordPro notation')
    } catch {
      showToast('Clipboard access denied. Please use Ctrl+V / Cmd+V.')
    }
  }

  // Helper 4: Copy All
  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(localRawContent)
      setCopyFeedback(true)
      showToast('Copied raw ChordPro text to clipboard')
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch {
      showToast('Failed to copy to clipboard')
    }
  }

  // Helper 5: Clear
  const handleClear = () => {
    if (localRawContent.length > 0) {
      if (window.confirm('Clear the entire chord and lyric sheet?')) {
        handleRawContentChange('')
        showToast('Editor cleared')
      }
    }
  }

  // Quick insert section snippet
  const insertTextAtCursor = (insertText: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = localRawContent
    const before = text.substring(0, start)
    const after = text.substring(end)

    const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n'
    const suffix = after.startsWith('\n') || after.length === 0 ? '\n' : '\n'
    const updated = `${before}${prefix}${insertText}${suffix}${after}`

    handleRawContentChange(updated)

    setTimeout(() => {
      textarea.focus()
      const newCursorPos = start + prefix.length + insertText.length + suffix.length
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 10)
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-[#002B36]">
      {/* =================================================================== */}
      {/* 1. TOP BAR: Compact Header & Save Icon Action                       */}
      {/* =================================================================== */}
      <div className="border-b border-[#1A4A55] bg-[#073642] px-3 py-1.5 sm:px-4 sm:py-2 flex items-center justify-between gap-2 sm:gap-3 select-none shrink-0 shadow-sm">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 sm:p-1.5 rounded-lg bg-[#002B36] border border-[#1A4A55] text-[#93A1A1] hover:text-[#FDF6E3] hover:border-[#2AA198] transition-colors cursor-pointer shrink-0"
              title="Return to Stage View"
            >
              <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-[#002B36] border border-[#2AA198]/40 flex items-center justify-center text-[#2AA198] shrink-0">
              <FileEdit className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs sm:text-sm text-[#FDF6E3] tracking-wide">
                  Editor
                </span>
                {!isSaved ? (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Unsaved
                  </span>
                ) : (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-[#2AA198]/20 text-[#2AA198] border border-[#2AA198]/30">
                    Saved
                  </span>
                )}
              </div>
              <span className="text-[10px] sm:text-[11px] text-[#93A1A1] font-mono truncate max-w-[180px] sm:max-w-[400px]">
                {localTitle || 'Untitled Song'} {localArtist ? `• ${localArtist}` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Compact Save Action Button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSave}
            className="p-1.5 sm:p-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center"
            title="Save changes"
            aria-label="Save changes"
          >
            <Save className="w-4 h-4 text-black stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 2. SUB-HEADER: Title, Artist & Collapsible Metadata Drawer/Modal    */}
      {/* =================================================================== */}
      <div className="border-b border-[#1A4A55] bg-[#073642]/80 px-3 py-2 sm:px-4 sm:py-2.5 flex items-center gap-2 text-xs shrink-0">
        {/* Song Title */}
        <div className="flex-[1.8] min-w-[130px] flex items-center gap-2 bg-[#002B36] px-2.5 py-1.5 rounded-lg border border-[#1A4A55] focus-within:border-[#2AA198] transition-colors">
          <Type className="w-3.5 h-3.5 text-[#2AA198] shrink-0" />
          <input
            type="text"
            value={localTitle}
            onChange={(e) => {
              setIsSaved(false)
              setLocalTitle(e.target.value)
              onUpdateSong({ title: e.target.value })
            }}
            placeholder="Song Title *"
            className="w-full bg-transparent text-[#FDF6E3] font-semibold focus:outline-none placeholder-[#93A1A1]/60 text-xs sm:text-sm"
          />
        </div>

        {/* Artist */}
        <div className="flex-[1.4] min-w-[110px] flex items-center gap-2 bg-[#002B36] px-2.5 py-1.5 rounded-lg border border-[#1A4A55] focus-within:border-[#2AA198] transition-colors">
          <User className="w-3.5 h-3.5 text-[#93A1A1] shrink-0" />
          <input
            type="text"
            value={localArtist}
            onChange={(e) => {
              setIsSaved(false)
              setLocalArtist(e.target.value)
              onUpdateSong({ artist: e.target.value })
            }}
            placeholder="Artist / Band"
            className="w-full bg-transparent text-[#EEE8D5] focus:outline-none placeholder-[#93A1A1]/60 text-xs"
          />
        </div>

        {/* Compact Metadata / Settings Icon Trigger */}
        <button
          type="button"
          onClick={() => setIsMetadataModalOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#002B36] border border-[#1A4A55] hover:border-[#2AA198] text-[#93A1A1] hover:text-[#FDF6E3] font-mono text-xs transition-colors cursor-pointer shrink-0"
          title="Song Details & Metadata (Key, Capo, BPM, Tags)"
          aria-label="Song Details & Metadata"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#2AA198]" />
          <span className="hidden sm:inline">Details</span>
          {(localKey || localCapo || localBpm) ? (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#2AA198]/20 text-[#2AA198] border border-[#2AA198]/30 max-w-[120px] truncate">
              {[localKey && `Key: ${localKey}`, localCapo && `Capo: ${localCapo}`, localBpm && `${localBpm} BPM`].filter(Boolean).join(' • ')}
            </span>
          ) : null}
        </button>
      </div>

      {/* =================================================================== */}
      {/* 3. MAIN SPLIT PANE: Raw ChordPro Editor (Left) & Live Stage (Right) */}
      {/* =================================================================== */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* ----------------------------------------------------------------- */}
        {/* LEFT PANE: Raw ChordPro Editor                                    */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r border-[#1A4A55] bg-[#002B36] h-1/2 md:h-full overflow-hidden">
          {/* Action Editing Toolbar: [Chords], [Section], Paste, Copy All, Clear */}
          <div className="px-3 py-2 bg-[#073642] border-b border-[#1A4A55] flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 select-none">
            {/* Left: Helper Tools matching Android PreSaveSongReviewDialog */}
            <div className="flex items-center gap-1 bg-[#002B36] p-1 rounded-lg border border-[#1A4A55]">
              <button
                type="button"
                onClick={markSelectionAsChord}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#073642] hover:bg-amber-500/20 text-[#B58900] hover:text-amber-300 font-mono text-[11px] font-bold transition-colors cursor-pointer"
                title="Wrap selection or word in [Chord] brackets"
              >
                <Library className="w-3 h-3" />
                <span>[Chords]</span>
              </button>

              <button
                type="button"
                onClick={markSelectionAsSection}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#073642] hover:bg-[#8B5CF6]/20 text-[#8B5CF6] hover:text-purple-300 font-mono text-[11px] font-bold transition-colors cursor-pointer"
                title="Wrap selection or line in [Section] header"
              >
                <Bookmark className="w-3 h-3" />
                <span>[Section]</span>
              </button>

              <div className="w-[1px] h-4 bg-[#1A4A55] mx-0.5" />

              <button
                type="button"
                onClick={handlePasteClipboard}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#073642] hover:bg-[#2AA198]/20 text-[#2AA198] hover:text-[#35B8AD] font-mono text-[11px] font-bold transition-colors cursor-pointer"
                title="Paste from clipboard and standardize ChordPro format"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>Paste</span>
              </button>

              <button
                type="button"
                onClick={handleCopyAll}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#073642] hover:bg-[#002B36] text-[#EEE8D5] hover:text-[#FDF6E3] font-mono text-[11px] transition-colors cursor-pointer"
                title="Copy entire sheet to clipboard"
              >
                <Copy className="w-3 h-3" />
                <span>{copyFeedback ? 'Copied!' : 'Copy All'}</span>
              </button>

              <button
                type="button"
                onClick={handleClear}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#073642] hover:bg-red-500/20 text-red-400 hover:text-red-300 font-mono text-[11px] transition-colors cursor-pointer"
                title="Clear all text in editor"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            </div>
          </div>

          {/* Quick Section Snippets Bar */}
          <div className="px-3 py-1.5 bg-[#073642]/50 border-b border-[#1A4A55]/60 flex items-center gap-1.5 overflow-x-auto text-xs shrink-0 select-none">
            <span className="text-[10px] font-mono text-[#93A1A1] mr-1 uppercase">Insert:</span>
            {QUICK_SECTIONS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => insertTextAtCursor(tag)}
                className="px-2 py-0.5 rounded bg-[#002B36] border border-[#1A4A55] text-[#FDF6E3] hover:border-[#8B5CF6] hover:text-[#8B5CF6] font-mono text-[11px] transition-colors cursor-pointer"
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Textarea: Standard ChordPro Notation */}
          <div className="flex-1 relative flex overflow-hidden">
            <textarea
              ref={textareaRef}
              value={localRawContent}
              onChange={(e) => handleRawContentChange(e.target.value)}
              placeholder="Enter ChordPro lyrics with [G] chords (e.g. When the [A]night has come) or standalone chord progressions..."
              spellCheck={false}
              className="w-full h-full p-4 bg-[#002B36] text-[#FDF6E3] font-mono text-sm leading-relaxed focus:outline-none resize-none selection:bg-[#2AA198]/30 selection:text-[#FDF6E3] overflow-y-auto"
            />
          </div>

        </div>

        {/* ----------------------------------------------------------------- */}
        {/* RIGHT PANE: Live Real-time Stage Preview Sync                     */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex-1 flex flex-col bg-[#002B36] h-1/2 md:h-full overflow-hidden">
          {/* Formatted Song Rendering */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-[#002B36] select-text">
            {/* Song Preview Header */}
            <div className="mb-4 sm:mb-6 pb-3 sm:pb-4 border-b border-[#1A4A55]/50">
              <h1 className="text-2xl font-bold text-[#FDF6E3] tracking-tight mb-1">
                {localTitle || parsedSong.title || 'Untitled Song'}
              </h1>
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-[#93A1A1] font-mono">
                {(localArtist || parsedSong.artist) && (
                  <span className="text-[#2AA198] font-semibold">
                    {localArtist || parsedSong.artist}
                  </span>
                )}
                {(localKey || parsedSong.key) && (
                  <span className="px-2 py-0.5 rounded bg-[#073642] border border-[#1A4A55] text-[#B58900] font-bold">
                    Key: {localKey || parsedSong.key}
                  </span>
                )}
                {(localCapo || parsedSong.capo) && (
                  <span className="px-2 py-0.5 rounded bg-[#073642] border border-[#1A4A55] text-[#EEE8D5]">
                    Capo: {localCapo || parsedSong.capo}
                  </span>
                )}
                {(localBpm || parsedSong.bpm) && (
                  <span className="px-2 py-0.5 rounded bg-[#073642] border border-[#1A4A55] text-[#CB4B16]">
                    {localBpm || parsedSong.bpm} BPM
                  </span>
                )}
                {localTags && (
                  <div className="flex items-center gap-1">
                    {localTags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .map((t, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px]"
                        >
                          {t}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* High-Contrast Structured Rendering (Chords cleanly above lyrics with zero brackets) */}
            <SongLineRenderer lines={parsedSong.lines} fontSizePx={16} />
          </div>

        </div>
      </div>

      {/* Song Metadata & Settings Modal */}
      {isMetadataModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#073642] border border-[#1A4A55] rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-xs select-none">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#1A4A55] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#002B36] border border-[#2AA198]/40 flex items-center justify-center text-[#2AA198]">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <span className="font-bold text-sm text-[#FDF6E3]">Song Details & Metadata</span>
              </div>
              <button
                type="button"
                onClick={() => setIsMetadataModalOpen(false)}
                className="p-1 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#002B36] transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inputs: Key, Capo, BPM */}
            <div className="grid grid-cols-3 gap-2.5">
              {/* Key */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-[#93A1A1] flex items-center gap-1">
                  <Music className="w-3 h-3 text-[#B58900]" />
                  <span>Key</span>
                </label>
                <div className="flex items-center bg-[#002B36] px-2 py-1.5 rounded-lg border border-[#1A4A55] focus-within:border-[#B58900] transition-colors">
                  <input
                    type="text"
                    value={localKey}
                    onChange={(e) => {
                      setIsSaved(false)
                      setLocalKey(e.target.value)
                      onUpdateSong({ key: e.target.value })
                    }}
                    placeholder="e.g. G"
                    className="w-full bg-transparent text-[#B58900] font-bold font-mono focus:outline-none text-center uppercase text-xs"
                  />
                </div>
              </div>

              {/* Capo */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-[#93A1A1] flex items-center gap-1">
                  <Hash className="w-3 h-3 text-[#2AA198]" />
                  <span>Capo</span>
                </label>
                <div className="flex items-center bg-[#002B36] px-2 py-1.5 rounded-lg border border-[#1A4A55] focus-within:border-[#2AA198] transition-colors">
                  <input
                    type="text"
                    value={localCapo}
                    onChange={(e) => {
                      setIsSaved(false)
                      setLocalCapo(e.target.value)
                      onUpdateSong({ capo: e.target.value })
                    }}
                    placeholder="e.g. 2"
                    className="w-full bg-transparent text-[#EEE8D5] font-mono focus:outline-none text-center text-xs"
                  />
                </div>
              </div>

              {/* BPM */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-[#93A1A1] flex items-center gap-1">
                  <Activity className="w-3 h-3 text-[#CB4B16]" />
                  <span>BPM</span>
                </label>
                <div className="flex items-center bg-[#002B36] px-2 py-1.5 rounded-lg border border-[#1A4A55] focus-within:border-[#CB4B16] transition-colors">
                  <input
                    type="text"
                    value={localBpm}
                    onChange={(e) => {
                      setIsSaved(false)
                      setLocalBpm(e.target.value)
                      onUpdateSong({ bpm: e.target.value })
                    }}
                    placeholder="120"
                    className="w-full bg-transparent text-[#CB4B16] font-mono focus:outline-none text-center text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Tags Input */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-mono text-[#93A1A1] flex items-center gap-1">
                <Tag className="w-3 h-3 text-amber-400" />
                <span>Tags</span>
              </label>
              <div className="flex items-center gap-2 bg-[#002B36] px-2.5 py-1.5 rounded-lg border border-[#1A4A55] focus-within:border-amber-500/60 transition-colors">
                <input
                  type="text"
                  value={localTags}
                  onChange={(e) => {
                    setIsSaved(false)
                    setLocalTags(e.target.value)
                    onUpdateSong({ tags: e.target.value })
                  }}
                  placeholder="Tags (e.g. Worship, OPM, Acoustic)"
                  className="w-full bg-transparent text-[#EEE8D5] font-mono text-xs focus:outline-none placeholder-[#93A1A1]/60"
                />
              </div>
            </div>

            {/* Quick Tag Suggestion Chips */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-mono text-[#93A1A1] uppercase tracking-wider">
                Quick Tags:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_GENRE_TAGS.map((tag) => {
                  const isSelected = localTags
                    .split(',')
                    .map((t) => t.trim().toLowerCase())
                    .includes(tag.toLowerCase())

                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleToggleTag(tag)}
                      className={`px-2.5 py-1 rounded-md border text-xs font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                          : 'bg-[#002B36] text-[#93A1A1] border-[#1A4A55] hover:text-[#FDF6E3] hover:border-[#2AA198]/60'
                      }`}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Done Button */}
            <div className="pt-2 border-t border-[#1A4A55] flex justify-end">
              <button
                type="button"
                onClick={() => setIsMetadataModalOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-[#2AA198] hover:bg-[#2AA198]/80 text-[#002B36] font-bold text-xs transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local Toast Notification Popup */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#002B36] border border-[#2AA198] text-[#FDF6E3] px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-medium animate-fade-in">
          <div className="w-2 h-2 rounded-full bg-[#2AA198] animate-ping" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  )
}
