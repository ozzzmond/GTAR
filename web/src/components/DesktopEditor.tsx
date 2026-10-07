import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  Music,
  Activity,
  Type,
  User,
  Tag,
  Save,
  FileEdit,
  ClipboardPaste,
  Copy,
  Trash2,
  ArrowLeft,
  SlidersHorizontal,
  X,
  Calendar,
  Clock,
  SquareCode,
  Check,
  MoreHorizontal,
  FilePlus,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { DropdownPortal } from './DropdownPortal'
import { SongLineRenderer } from './SongLineRenderer'
import { parseGtarSong, standardizeChordProBrackets, detectSongKey } from '../utils/songParser'
import { TextHistory, indentText, type TextEdit } from '../utils/editorText'
import { normalizeMusicalKey, canonicalSongKey } from '../utils/musicalKey'
import { parseChordProDirectives, syncCanonicalDirectives, type CanonicalMetadata } from '../utils/chordProMetadata'
import { transposeCanonicalSong } from '../utils/chartKeyAlignment'
import { lookupSongMetadata, type SongMetadataResult } from '../utils/songMetadataClient'
import { generateUUID } from '../utils/uuid'
import type { ActiveSongState } from '../types/gtar'

export function createBlankCanonicalSong(): ActiveSongState {
  return {
    id: generateUUID(),
    title: 'New Song',
    artist: '',
    key: 'G',
    capo: 'No Capo',
    bpm: '120',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: `{title: New Song}\n{artist: }\n{key: G}\n{tempo: 120}\n\n[Intro]\n\n[Verse 1]\n\n[Chorus]\n`,
  }
}

interface DesktopEditorProps {
  song: ActiveSongState
  onUpdateSong: (updated: Partial<ActiveSongState>) => boolean | void
  onSaveSong?: (updated: ActiveSongState) => boolean | void
  onClose?: () => void
  navigationGuardRef?: React.RefObject<((next: () => void) => void) | null>
  transposeOffset: number
  onNewSong?: () => void
}

const QUICK_GENRE_TAGS = ['Worship', 'OPM', 'Acoustic', 'Rock', 'Slow Rock', 'Encore']
const QUICK_SECTIONS = ['[Intro]', '[Verse 1]', '[Chorus]', '[Bridge]', '[Solo]', '[Outro]', '[Tab]']

export const DesktopEditor: React.FC<DesktopEditorProps> = ({
  song,
  onUpdateSong,
  onSaveSong,
  onClose,
  transposeOffset,
  navigationGuardRef,
  onNewSong,
}) => {
  const [editingSong, setEditingSong] = useState<ActiveSongState>(song)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [insertAnchor, setInsertAnchor] = useState<HTMLButtonElement | null>(null)
  const [insertOpen, setInsertOpen] = useState(false)

  // Local editor state initialized from active song
  const [localTitle, setLocalTitle] = useState(song.title || '')
  const [localArtist, setLocalArtist] = useState(song.artist || '')
  const [localKey, setLocalKey] = useState(canonicalSongKey(song.key || ''))
  const [localOriginalKey, setLocalOriginalKey] = useState(song.originalKey ? canonicalSongKey(song.originalKey) : '')
  const [localBpm, setLocalBpm] = useState(song.bpm || '')
  const [localTime, setLocalTime] = useState(song.time || '')
  const [localYear, setLocalYear] = useState(song.year || '')
  const [localTags, setLocalTags] = useState(song.tags || '')
  const [localRawContent, setLocalRawContent] = useState(() =>
    standardizeChordProBrackets(song.rawContent || '')
  )

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const fields = (value: ActiveSongState) => ({
    title: value.title || '',
    artist: value.artist || '',
    key: value.key || '',
    originalKey: value.originalKey || '',
    capo: value.capo || '',
    bpm: value.bpm || '',
    time: value.time || '',
    year: value.year || '',
    tags: value.tags || '',
    rawContent: value.rawContent || '',
  })
  const [persisted, setPersisted] = useState(() => fields(song))
  const history = useRef(new TextHistory())
  const selection = useRef({ start: 0, end: 0 })
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)

  const draft = {
    title: localTitle,
    artist: localArtist,
    key: localKey,
    originalKey: localOriginalKey,
    capo: editingSong.capo || '',
    bpm: localBpm,
    time: localTime,
    year: localYear,
    tags: localTags,
    rawContent: localRawContent,
  }
  const isSaved = Object.entries(draft).every(([key, value]) => persisted[key as keyof typeof persisted] === value)
  const displayKey = normalizeMusicalKey(localKey) ?? persisted.key
  const autosave = (updated: Partial<ActiveSongState>) => {
    const next = { ...updated }
    if (updated.rawContent === undefined) {
      const canonical: CanonicalMetadata = {}
      for (const field of ['title', 'artist', 'key', 'bpm', 'time', 'year'] as const) {
        if (updated[field] !== undefined) canonical[field] = updated[field]
      }
      if (Object.keys(canonical).length > 0) {
        const rawContent = syncCanonicalDirectives(localRawContent, canonical)
        next.rawContent = rawContent
        setLocalRawContent(rawContent)
      }
    }
    try {
      if (onUpdateSong(next) === true) setPersisted(previous => ({ ...previous, ...next }))
    } catch { showToast('Changes are not saved. Retry saving before leaving.') }
  }
  const requestNavigation = (next: () => void) => {
    if (isSaved) next()
    else setPendingNavigation(previous => previous ? () => { previous(); next() } : next)
  }
  useEffect(() => {
    if (navigationGuardRef) navigationGuardRef.current = requestNavigation
    return () => { if (navigationGuardRef) navigationGuardRef.current = null }
  })
  useEffect(() => {
    if (isSaved) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [isSaved])
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false)
  const [isLookingUpMetadata, setIsLookingUpMetadata] = useState(false)
  const [lookupResult, setLookupResult] = useState<SongMetadataResult | null>(null)
  const [lookupMessage, setLookupMessage] = useState<string | null>(null)

  const handleLookupMetadata = async () => {
    if (!localTitle.trim()) {
      showToast('Enter a song title first')
      return
    }
    setIsLookingUpMetadata(true)
    setLookupMessage(null)
    setLookupResult(null)
    try {
      const res = await lookupSongMetadata({
        title: localTitle.trim(),
        artist: localArtist.trim() || undefined,
        currentKey: localKey.trim() || undefined,
      })
      if (res.status === 'ok' && res.metadata) {
        setLookupResult(res.metadata)
      } else if (res.status === 'ambiguous' && res.metadata) {
        setLookupResult(res.metadata)
        setLookupMessage('Matched song identity; Original Key not verified')
      } else if (res.status === 'not_found') {
        setLookupMessage('No factual metadata match found')
      } else {
        setLookupMessage(res.error || 'Metadata lookup error')
      }
    } catch {
      setLookupMessage('Metadata service unavailable')
    } finally {
      setIsLookingUpMetadata(false)
    }
  }

  const handleApplyMetadataOnly = (meta: SongMetadataResult) => {
    if (meta.artist && !localArtist.trim()) {
      setLocalArtist(meta.artist)
      autosave({ artist: meta.artist })
    }
    if (meta.tempo && !localBpm.trim()) {
      const formatted = String(meta.tempo)
      setLocalBpm(formatted)
      autosave({ bpm: formatted })
    }
    if (meta.timeSignature && !localTime.trim()) {
      setLocalTime(meta.timeSignature)
      autosave({ time: meta.timeSignature })
    }
    if (meta.year && !localYear.trim()) {
      const y = String(meta.year)
      setLocalYear(y)
      autosave({ year: y })
    }
    if (meta.originalKey) {
      setLocalOriginalKey(meta.originalKey)
      autosave({ originalKey: meta.originalKey })
    }
    showToast('Song metadata updated')
  }

  const handleConfirmTransposeToOriginalKey = (targetOriginalKey: string) => {
    const validated = normalizeMusicalKey(targetOriginalKey)
    if (!validated) {
      showToast('Invalid Original Key')
      return
    }
    const currentKey = normalizeMusicalKey(localKey)
    if (!currentKey) {
      showToast('Set current key before transposing')
      return
    }

    if (currentKey === validated) {
      setLocalOriginalKey(validated)
      autosave({ originalKey: validated })
      showToast('Chart is already in Original Key')
      return
    }

    // Call deterministic transposition
    const transposed = transposeCanonicalSong(localRawContent, currentKey, validated)
    setLocalKey(transposed.key)
    setLocalOriginalKey(validated)
    setLocalRawContent(transposed.rawContent)

    autosave({
      key: transposed.key,
      originalKey: validated,
      rawContent: transposed.rawContent,
    })
    showToast(`Chart transposed from ${currentKey} to Original Key ${validated} (${transposed.semitones > 0 ? '+' : ''}${transposed.semitones} semitones)`)
  }

  // Reset local state when active song changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Switching song identity resets the draft and undo history together.
    setEditingSong(song)
    const parsedMeta = parseChordProDirectives(song.rawContent || '').metadata
    setLocalTitle(song.title || parsedMeta.title || '')
    setLocalArtist(song.artist || parsedMeta.artist || '')
    const initKey = canonicalSongKey(song.key || parsedMeta.key || '')
    setLocalKey(initKey)
    setLocalOriginalKey(song.originalKey ? canonicalSongKey(song.originalKey) : '')
    setLocalBpm(song.bpm || (parsedMeta.tempo ? String(parsedMeta.tempo) : ''))
    setLocalTime(song.time || parsedMeta.time || '')
    setLocalYear(song.year || (parsedMeta.year ? String(parsedMeta.year) : ''))
    setLocalTags(song.tags || '')
    setLocalRawContent(standardizeChordProBrackets(song.rawContent || ''))
    setPersisted(fields(song))
    history.current = new TextHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Same-ID updates must not erase the unsaved draft or undo history.
  }, [song.id])

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Real-time live stage preview parsing
  const parsedSong = useMemo(() => {
    return parseGtarSong(localRawContent, transposeOffset)
  }, [localRawContent, transposeOffset])

  // Handle new blank song action with unsaved changes protection
  const handleNewSong = () => {
    requestNavigation(() => {
      const blank = createBlankCanonicalSong()
      setEditingSong(blank)
      setLocalTitle(blank.title)
      setLocalArtist(blank.artist)
      const initKey = canonicalSongKey(blank.key || '')
      setLocalKey(initKey)
      setLocalOriginalKey('')
      setLocalBpm(blank.bpm || '')
      setLocalTime('')
      setLocalYear('')
      setLocalTags('')
      setLocalRawContent(blank.rawContent || '')
      setPersisted(fields(blank))
      history.current = new TextHistory()
      showToast('New blank song started')
      onNewSong?.()
    })
  }

  // Handle saving changes
  const handleSave = () => {
    const currentMeta = parseChordProDirectives(localRawContent).metadata
    const resolvedTitle = localTitle.trim() || currentMeta.title || 'Untitled Song'
    const resolvedArtist = localArtist.trim() || currentMeta.artist || ''
    const rawKey = localKey.trim() || currentMeta.key || detectSongKey(localRawContent)
    const effectiveKey = normalizeMusicalKey(rawKey)
    if (effectiveKey === null) { showToast('Enter a valid key, such as G, F#m or Bb.'); return false }

    const resolvedBpm = localBpm.trim() || (currentMeta.tempo ? String(currentMeta.tempo) : '')
    const resolvedTime = localTime.trim() || currentMeta.time || ''
    const resolvedYear = localYear.trim() || (currentMeta.year ? String(currentMeta.year) : '')

    // Synchronize canonical ChordPro directives in rawContent
    const canonicalMetadata: CanonicalMetadata = {
      title: resolvedTitle,
      artist: resolvedArtist,
      key: effectiveKey,
      tempo: resolvedBpm || undefined,
      time: resolvedTime || undefined,
      year: resolvedYear || undefined,
    }
    const syncedContent = syncCanonicalDirectives(localRawContent, canonicalMetadata)
    const standardized = standardizeChordProBrackets(syncedContent)

    const updatedSong: ActiveSongState = {
      ...editingSong,
      title: resolvedTitle,
      artist: resolvedArtist,
      key: effectiveKey,
      ...(localOriginalKey.trim() ? { originalKey: canonicalSongKey(localOriginalKey.trim()) } : { originalKey: undefined }),
      bpm: resolvedBpm,
      time: resolvedTime || undefined,
      ...(resolvedYear ? { year: resolvedYear } : { year: undefined }),
      tags: localTags.trim(),
      rawContent: standardized,
      format: 'CHORD_PRO',
      transposeOffset: editingSong.transposeOffset || 0,
    }

    try {
      const saved = onSaveSong ? onSaveSong(updatedSong) : onUpdateSong(updatedSong)
      if (saved !== true) { showToast('Changes are not saved. Retry saving before leaving.'); return false }
      setEditingSong(updatedSong)
      setLocalTitle(updatedSong.title)
      setLocalArtist(updatedSong.artist || '')
      setLocalKey(effectiveKey)
      setLocalOriginalKey(updatedSong.originalKey || '')
      setLocalBpm(updatedSong.bpm || '')
      setLocalTime(updatedSong.time || '')
      setLocalYear(updatedSong.year || '')
      setLocalTags(updatedSong.tags || '')
      setLocalRawContent(standardized)
      setPersisted(fields(updatedSong))
      showToast('Songbook saved!')
      return true
    } catch { showToast('Changes are not saved. Retry saving before leaving.'); return false }
  }

  const saveRef = useRef(handleSave)
  useEffect(() => {
    saveRef.current = handleSave
  })

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  // Toggle quick genre tag chip
  const handleToggleTag = (tag: string) => {
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

    const updatedTags = nextTags.join(', ')
    setLocalTags(updatedTags)
  }

  // Raw text change handler (eliminates erratic angle brackets on the fly)
  const handleRawContentChange = (newText: string, remember = true) => {
    const cleaned = standardizeChordProBrackets(newText)
    if (remember) history.current.record({ text: localRawContent, ...selection.current }, { text: cleaned, start: textareaRef.current?.selectionStart ?? 0, end: textareaRef.current?.selectionEnd ?? 0 })
    setLocalRawContent(cleaned)
    const metadata = parseChordProDirectives(cleaned).metadata
    const updated: Partial<ActiveSongState> = { rawContent: cleaned }
    if (metadata.artist !== undefined || parseChordProDirectives(localRawContent).metadata.artist !== undefined) {
      const artist = metadata.artist ?? ''
      setLocalArtist(artist)
      updated.artist = artist
    }
    if (metadata.title !== undefined) {
      setLocalTitle(metadata.title)
      updated.title = metadata.title
    }
    if (metadata.key !== undefined) {
      const normKey = canonicalSongKey(metadata.key)
      setLocalKey(normKey)
      updated.key = normKey
    }
    if (metadata.tempo !== undefined) {
      const t = String(metadata.tempo)
      setLocalBpm(t)
      updated.bpm = t
    }
    if (metadata.time !== undefined) {
      setLocalTime(metadata.time)
      updated.time = metadata.time
    }
    if (metadata.year !== undefined) {
      const y = String(metadata.year)
      setLocalYear(y)
      updated.year = y
    }
    autosave(updated)
  }

  // Insert or wrap text in [brackets] (QoL action)
  const handleInsertBrackets = () => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = localRawContent

    if (start !== end) {
      // Wrap selection in brackets
      const selected = text.substring(start, end)
      const wrapped = selected.startsWith('[') && selected.endsWith(']') ? selected : `[${selected}]`
      const newText = text.substring(0, start) + wrapped + text.substring(end)
      handleRawContentChange(newText)
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start, start + wrapped.length)
      }, 10)
    } else {
      // Insert [] and position caret between them
      const newText = text.substring(0, start) + '[]' + text.substring(start)
      handleRawContentChange(newText)
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + 1, start + 1)
      }, 10)
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

  // Helper 5: Select All
  const handleSelectAll = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(0, textarea.value.length)
  }

  // Helper 6: Clear
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

  const songInputs = (
    <div className="border-b border-app-border bg-app-surface/80 px-3 py-2 sm:px-4 sm:py-2.5 flex flex-row md:flex-col items-stretch gap-2 text-xs shrink-0">
      {/* Song Title */}
      <div className="flex-1 min-w-0 flex items-center gap-2 bg-app-base px-2.5 py-1.5 rounded-lg border border-app-border focus-within:border-app-action transition-colors">
        <Type className="w-3.5 h-3.5 text-app-action shrink-0" />
        <input
          type="text"
          value={localTitle}
          onChange={(e) => {
            setLocalTitle(e.target.value)
            autosave({ title: e.target.value })
          }}
          placeholder="Song Title *"
          className="w-full bg-transparent text-app-heading font-semibold focus:outline-none placeholder-app-muted/60 text-xs sm:text-sm"
        />
      </div>

      {/* Artist */}
      <div className="flex-1 min-w-0 flex items-center gap-2 bg-app-base px-2.5 py-1.5 rounded-lg border border-app-border focus-within:border-app-action transition-colors">
        <User className="w-3.5 h-3.5 text-app-muted shrink-0" />
        <input
          type="text"
          value={localArtist}
          onChange={(e) => {
            setLocalArtist(e.target.value)
            autosave({ artist: e.target.value })
          }}
          placeholder="Artist / Band"
          className="w-full bg-transparent text-app-text focus:outline-none placeholder-app-muted/60 text-xs"
        />
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-app-base">
      {pendingNavigation && (
        <div role="dialog" aria-modal="true" aria-label="Unsaved changes" className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-app-surface border border-app-border rounded-xl p-5 text-app-heading">
            <p>Save unsaved changes before leaving?</p>
            <div className="flex gap-4 mt-4">
              <button type="button" autoFocus onClick={() => { if (handleSave()) { setPendingNavigation(null); pendingNavigation() } }}>Save</button>
              <button type="button" onClick={() => {
                setLocalTitle(persisted.title)
                setLocalArtist(persisted.artist)
                setLocalKey(persisted.key)
                setLocalOriginalKey(persisted.originalKey)
                setLocalYear(persisted.year)
                setLocalTime(persisted.time)
                setLocalBpm(persisted.bpm)
                setLocalTags(persisted.tags)
                setLocalRawContent(persisted.rawContent)
                history.current = new TextHistory()
                setPendingNavigation(null)
                pendingNavigation()
              }}>Discard</button>
              <button type="button" onClick={() => setPendingNavigation(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Editor navigation and save status */}
      <div className="border-b border-app-border bg-app-surface px-3 py-1.5 sm:px-4 sm:py-2 flex items-center justify-between gap-2 sm:gap-3 select-none shrink-0 shadow-sm">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onClose && (
            <button
              type="button"
              onClick={() => requestNavigation(onClose)}
              className="p-1 sm:p-1.5 rounded-lg bg-app-base border border-app-border text-app-muted hover:text-app-heading hover:border-app-action transition-colors cursor-pointer shrink-0"
              title="Return to Stage View"
            >
              <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-app-base border border-app-action/40 flex items-center justify-center text-app-action shrink-0">
              <FileEdit className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs sm:text-sm text-app-heading tracking-wide">
                  Editor
                </span>
                {!isSaved ? (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-app-accent/20 text-app-accent border border-app-accent/30">
                    Unsaved
                  </span>
                ) : (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-app-action/20 text-app-action border border-app-action/30">
                    Saved
                  </span>
                )}
              </div>
              <span className="text-[10px] sm:text-[11px] text-app-muted font-mono truncate max-w-[180px] sm:max-w-[400px]">
                {localTitle || 'Untitled Song'} {localArtist ? `• ${localArtist}` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="md:hidden">{songInputs}</div>

      {/* 3. MAIN SPLIT PANE: Raw ChordPro Editor (Left) & Live Stage Preview (Right) */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* LEFT PANE: Raw ChordPro Editor */}
        <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r border-app-border bg-app-base h-1/2 md:h-full overflow-hidden">
          <div className="hidden md:block">{songInputs}</div>

          {/* Action Editing Toolbar */}
          <div className="px-3 py-2 bg-app-surface border-b border-app-border flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 select-none">
            <div className="flex flex-wrap items-center gap-1 bg-app-base p-1 rounded-lg border border-app-border">
              {/* [] Bracket Wrap/Insert Action */}
              <button
                type="button"
                onClick={handleInsertBrackets}
                className="flex items-center gap-1 px-2 py-1 rounded bg-app-surface hover:bg-app-action/20 text-app-action hover:text-app-action font-mono text-[11px] font-bold transition-colors cursor-pointer"
                title="Wrap selection in brackets or insert [] at caret"
                aria-label="Wrap selection or insert brackets []"
              >
                <SquareCode className="w-3.5 h-3.5" />
                <span>[]</span>
              </button>

              <button type="button" aria-label="Insert section" title="Insert section"
                aria-expanded={insertOpen} aria-haspopup="menu" onClick={event => { setInsertAnchor(event.currentTarget); setInsertOpen(open => !open) }}
                className="p-1.5 rounded bg-app-surface text-app-section cursor-pointer">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              <DropdownPortal anchorEl={insertAnchor} open={insertOpen} onClose={() => setInsertOpen(false)} align="left">
                <div role="menu" aria-label="Insert section" className="min-w-32 rounded-lg border border-app-border bg-app-surface p-1 shadow-xl"
                  onKeyDown={event => {
                    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
                    const index = items.indexOf(document.activeElement as HTMLButtonElement)
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                    items[next]?.focus()
                  }}>
                  {QUICK_SECTIONS.map((tag, index) => (
                    <button key={tag} role="menuitem" autoFocus={index === 0} type="button" className="block w-full text-left px-3 py-2 rounded hover:bg-app-base text-app-heading"
                      onClick={() => { insertTextAtCursor(tag); setInsertOpen(false) }}>
                      {tag.slice(1, -1)}
                    </button>
                  ))}
                </div>
              </DropdownPortal>

              {/* New Blank Song Action with Unsaved Changes Protection */}
              <button
                type="button"
                data-testid="editor-new-song-button"
                onClick={handleNewSong}
                className="p-1.5 rounded bg-app-surface hover:bg-app-accent/20 text-app-accent hover:text-app-accent transition-colors cursor-pointer"
                title="New Song (blank document)"
                aria-label="New Song"
              >
                <FilePlus className="w-3.5 h-3.5" />
              </button>

              <div className="w-[1px] h-4 bg-app-border mx-0.5" />

              {/* Icon-Only Clipboard & Edit Controls with Accessible Labels */}
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="p-1.5 rounded bg-app-surface hover:bg-app-action/20 text-app-action hover:text-app-action transition-colors cursor-pointer"
                title="Paste from clipboard"
                aria-label="Paste"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={handleCopyAll}
                className="p-1.5 rounded bg-app-surface hover:bg-app-base text-app-text hover:text-app-heading transition-colors cursor-pointer"
                title="Copy all content"
                aria-label="Copy"
              >
                {copyFeedback ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={handleSelectAll}
                className="p-1.5 rounded bg-app-surface hover:bg-app-base text-app-text hover:text-app-heading transition-colors cursor-pointer font-mono text-[10px] font-bold"
                title="Select all text"
                aria-label="Select All"
              >
                <span>ALL</span>
              </button>

              <button
                type="button"
                onClick={handleClear}
                className="p-1.5 rounded bg-app-surface hover:bg-red-500/20 text-status-error hover:text-status-error transition-colors cursor-pointer"
                title="Clear all text"
                aria-label="Clear"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setIsMetadataModalOpen(true)}
                title="Song Details & Metadata" aria-label="Song Details & Metadata"
                className="p-1.5 rounded bg-app-surface text-app-action hover:bg-app-action/20 cursor-pointer">
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              {/* Compact Save Action Button */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSave}
                  className="p-1.5 sm:p-2 rounded-lg bg-app-button hover:bg-app-button text-app-button-text shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center"
                  title="Save changes"
                  aria-label="Save changes"
                >
                  <Save className="w-4 h-4 text-app-button-text stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>

          {/* Textarea: Standard ChordPro Notation */}
          <div className="flex-1 relative flex overflow-hidden">
            <textarea
              ref={textareaRef}
              value={localRawContent}
              onChange={(e) => handleRawContentChange(e.target.value)}
              placeholder="Enter ChordPro lyrics with [G] chords (e.g. When the [A]night has come) or standalone chord progressions..."
              onBeforeInput={(e) => { selection.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd } }}
              onSelect={(e) => { selection.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd } }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                const textarea = e.currentTarget
                const current: TextEdit = { text: localRawContent, start: textarea.selectionStart, end: textarea.selectionEnd }
                selection.current = { start: current.start, end: current.end }
                let next: TextEdit | undefined
                if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
                  e.preventDefault()
                  handleSave()
                  return
                } else if ((e.ctrlKey || e.metaKey) && !e.altKey && ['z', 'y'].includes(e.key.toLowerCase())) {
                  e.preventDefault()
                  next = e.key.toLowerCase() === 'y' || e.shiftKey ? history.current.redo(current) : history.current.undo(current)
                  if (next) handleRawContentChange(next.text, false)
                } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  e.preventDefault()
                  next = indentText(current.text, current.start, current.end, e.shiftKey)
                  handleRawContentChange(next.text)
                }
                if (next) {
                  const edit = next
                  requestAnimationFrame(() => { textarea.setSelectionRange(edit.start, edit.end); selection.current = { start: edit.start, end: edit.end } })
                }
              }}
              spellCheck={false}
              className="w-full h-full p-4 bg-app-base text-app-heading font-mono text-sm leading-relaxed focus:outline-none resize-none selection:bg-app-action/30 selection:text-app-heading overflow-y-auto"
            />
          </div>
        </div>

        {/* RIGHT PANE: Live Real-time Stage Preview Sync */}
        <div className="flex-1 flex flex-col bg-app-base h-1/2 md:h-full overflow-hidden">
          <div className="flex-1 p-4 sm:p-6 md:pt-2.5 overflow-y-auto bg-app-base select-text">
            <div className="border-b border-app-border pb-3 mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-app-heading">
                  {localTitle || 'Untitled Song'}
                </h2>
                <div className="text-xs text-app-muted mt-0.5">
                  {localArtist || 'Unknown Artist'}
                  {displayKey ? ` • Original Key: ${displayKey}` : ''}
                  {localTime ? ` • ${localTime}` : ''}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-mono uppercase tracking-wider text-app-action px-2 py-0.5 rounded bg-app-surface border border-app-border">
                  Stage Preview
                </span>
              </div>
            </div>

            <div className="space-y-1 text-sm font-mono">
              <SongLineRenderer lines={parsedSong.lines} fontSizePx={14} />
            </div>
          </div>
        </div>
      </div>

      {/* Song Metadata & Details Modal */}
      {isMetadataModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-app-surface border border-app-border rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-xs select-none">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-app-border pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-app-base border border-app-action/40 flex items-center justify-center text-app-action">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <span className="font-bold text-sm text-app-heading">Song Details & Metadata</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleLookupMetadata}
                  disabled={isLookingUpMetadata || !localTitle.trim()}
                  className="px-2.5 py-1 rounded-lg bg-app-base border border-app-border hover:border-app-action text-app-action hover:text-app-heading flex items-center gap-1.5 font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Search factual song metadata (Original Key, Tempo, Year)"
                >
                  {isLookingUpMetadata ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>Lookup Metadata</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsMetadataModalOpen(false)}
                  className="p-1 rounded-lg text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Metadata Lookup Status / Results Card */}
            {(lookupResult || lookupMessage) && (
              <div className="p-3 rounded-xl bg-app-base border border-app-border flex flex-col gap-2">
                {lookupResult ? (
                  <>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-app-heading truncate max-w-[200px]">
                        {lookupResult.title} {lookupResult.artist ? `— ${lookupResult.artist}` : ''}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-app-surface text-app-muted border border-app-border font-mono">
                        {lookupResult.source} ({lookupResult.confidence})
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono py-1">
                      <div>
                        <span className="text-app-muted">Discovered Key: </span>
                        <span className="font-bold text-app-action">
                          {lookupResult.originalKey || 'Not verified'}
                        </span>
                      </div>
                      <div>
                        <span className="text-app-muted">Current Chart: </span>
                        <span className="font-bold text-app-text">{localKey || 'None'}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-app-border/60">
                      <button
                        type="button"
                        onClick={() => handleApplyMetadataOnly(lookupResult)}
                        className="px-2 py-1 rounded bg-app-surface hover:bg-app-border text-app-text font-medium text-[11px] transition-colors cursor-pointer"
                      >
                        Apply Metadata
                      </button>

                      {lookupResult.originalKey && (
                        normalizeMusicalKey(localKey) === normalizeMusicalKey(lookupResult.originalKey) ? (
                          <span className="text-[11px] text-app-accent font-semibold px-2 py-1">
                            Already Aligned ({lookupResult.originalKey})
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleConfirmTransposeToOriginalKey(lookupResult.originalKey)}
                            className="px-2.5 py-1 rounded bg-app-action hover:bg-app-action/80 text-app-on-action font-bold text-[11px] transition-colors cursor-pointer"
                          >
                            Transpose to Original Key ({lookupResult.originalKey})
                          </button>
                        )
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-app-muted italic text-center py-1">
                    {lookupMessage}
                  </div>
                )}
              </div>
            )}

            {/* Canonical Metadata Inputs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {/* Original Key (Sole Key Input) */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-app-muted flex items-center gap-1">
                  <Music className="w-3 h-3 text-app-action" />
                  <span>Original Key</span>
                </label>
                <div className="flex items-center bg-app-base px-2 py-1.5 rounded-lg border border-app-border focus-within:border-app-action transition-colors">
                  <input
                    type="text"
                    value={localKey}
                    onChange={(e) => {
                      const val = e.target.value
                      const canonical = normalizeMusicalKey(val)
                      if (canonical) {
                        setLocalKey(canonical)
                        autosave({ key: canonical })
                      } else {
                        setLocalKey(val)
                        if (val.trim() === '') {
                          autosave({ key: '' })
                        }
                      }
                    }}
                    placeholder="e.g. G"
                    className="w-full bg-transparent text-app-action font-bold font-mono focus:outline-none text-center text-xs"
                    title="Original Key of the song"
                  />
                </div>
              </div>

              {/* Tempo / BPM */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-app-muted flex items-center gap-1">
                  <Activity className="w-3 h-3 text-app-accent" />
                  <span>Tempo (BPM)</span>
                </label>
                <div className="flex items-center bg-app-base px-2 py-1.5 rounded-lg border border-app-border focus-within:border-app-accent transition-colors">
                  <input
                    type="text"
                    value={localBpm}
                    onChange={(e) => {
                      setLocalBpm(e.target.value)
                      autosave({ bpm: e.target.value })
                    }}
                    placeholder="120"
                    className="w-full bg-transparent text-app-accent font-mono focus:outline-none text-center text-xs"
                  />
                </div>
              </div>

              {/* Time Signature */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-app-muted flex items-center gap-1">
                  <Clock className="w-3 h-3 text-app-section" />
                  <span>Time</span>
                </label>
                <div className="flex items-center bg-app-base px-2 py-1.5 rounded-lg border border-app-border focus-within:border-app-section transition-colors">
                  <input
                    type="text"
                    value={localTime}
                    onChange={(e) => {
                      setLocalTime(e.target.value)
                      autosave({ time: e.target.value.trim() })
                    }}
                    placeholder="4/4"
                    className="w-full bg-transparent text-app-section font-mono focus:outline-none text-center text-xs"
                  />
                </div>
              </div>

              {/* Release Year */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-app-muted flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-app-section" />
                  <span>Release Year</span>
                </label>
                <div className="flex items-center bg-app-base px-2 py-1.5 rounded-lg border border-app-border focus-within:border-app-section transition-colors">
                  <input
                    type="text"
                    value={localYear}
                    onChange={(e) => {
                      setLocalYear(e.target.value)
                      autosave({ year: e.target.value.trim() })
                    }}
                    placeholder="e.g. 1979"
                    className="w-full bg-transparent text-app-section font-mono focus:outline-none text-center text-xs"
                  />
                </div>
              </div>


            </div>

            {/* Tags Input */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-mono text-app-muted flex items-center gap-1">
                <Tag className="w-3 h-3 text-app-accent" />
                <span>Tags</span>
              </label>
              <div className="flex items-center gap-2 bg-app-base px-2.5 py-1.5 rounded-lg border border-app-border focus-within:border-app-accent/60 transition-colors">
                <input
                  type="text"
                  value={localTags}
                  onChange={(e) => {
                    setLocalTags(e.target.value)
                    autosave({ tags: e.target.value })
                  }}
                  placeholder="Tags (e.g. Worship, OPM, Acoustic)"
                  className="w-full bg-transparent text-app-text font-mono text-xs focus:outline-none placeholder-app-muted/60"
                />
              </div>
            </div>

            {/* Quick Tag Suggestion Chips */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-mono text-app-muted uppercase tracking-wider">
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
                          ? 'bg-app-accent/20 text-app-accent border-app-accent/50 shadow-sm'
                          : 'bg-app-base text-app-muted border-app-border hover:text-app-heading hover:border-app-action/60'
                      }`}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Done Button */}
            <div className="pt-2 border-t border-app-border flex justify-end">
              <button
                type="button"
                onClick={() => setIsMetadataModalOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-app-action hover:bg-app-action/80 text-app-on-action font-bold text-xs transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local Toast Notification Popup */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-app-base border border-app-action text-app-heading px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-medium animate-fade-in">
          <div className="w-2 h-2 rounded-full bg-app-action animate-ping" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  )
}
