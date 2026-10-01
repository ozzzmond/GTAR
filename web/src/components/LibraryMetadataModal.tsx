import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  XCircle,
  ExternalLink,
  Check,
  Loader2,
} from 'lucide-react'
import type { ActiveSongState } from '../types/gtar'
import {
  fetchSongMetadataFromProvider,
  type MetadataMatchStatus,
  type SongMetadataReviewItem,
} from '../utils/songMetadata'

interface LibraryMetadataModalProps {
  isOpen: boolean
  onClose: () => void
  songs: ActiveSongState[]
  preselectedSongIds?: Set<string | number>
  onApplyUpdates: (updates: Array<{ id: string | number; changes: Partial<ActiveSongState> }>) => void
}

export const LibraryMetadataModal: React.FC<LibraryMetadataModalProps> = ({
  isOpen,
  onClose,
  songs,
  preselectedSongIds,
  onApplyUpdates,
}) => {
  const [items, setItems] = useState<SongMetadataReviewItem[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 })
  const [filterStatus, setFilterStatus] = useState<'ALL' | MetadataMatchStatus>('ALL')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const scanAbortRef = useRef(false)

  // Initialize or reset review items when modal opens
  useEffect(() => {
    if (isOpen) {
      scanAbortRef.current = false
      const targetSongs = preselectedSongIds && preselectedSongIds.size > 0
        ? songs.filter((s) => s.id !== undefined && preselectedSongIds.has(s.id))
        : songs

      const initial: SongMetadataReviewItem[] = targetSongs.map((s) => ({
        songId: s.id,
        storedTitle: s.title,
        storedArtist: s.artist || '',
        currentChartKey: s.key || '',
        currentOriginalKey: s.originalKey || '',
        currentBpm: s.bpm || '',
        currentYear: s.year || '',
        status: 'REVIEW',
        candidates: [],
        selectedCandidateIndex: 0,
        selectedFields: {
          title: false,
          artist: false,
          originalKey: true,
          bpm: true,
          year: true,
        },
        isSelected: false,
      }))

      setItems(initial)
      setIsScanning(false)
      setScanProgress({ current: 0, total: targetSongs.length })
      setShowConfirmModal(false)
    }
  }, [isOpen, songs, preselectedSongIds])

  if (!isOpen) return null

  // Manual on-demand scan action
  const handleStartScan = async () => {
    if (items.length === 0 || isScanning) return
    setIsScanning(true)
    scanAbortRef.current = false
    setScanProgress({ current: 0, total: items.length })

    const updated = [...items]

    for (let i = 0; i < updated.length; i++) {
      if (scanAbortRef.current) break

      const item = updated[i]
      setScanProgress({ current: i + 1, total: updated.length })

      try {
        const res = await fetchSongMetadataFromProvider(item.storedTitle, item.storedArtist)
        if (res.success) {
          item.candidates = res.candidates
          item.status = res.status
          item.selectedCandidateIndex = 0
          item.error = undefined
          // Auto-select songs that have a confident match
          if (res.status === 'MATCH' && res.candidates.length > 0) {
            item.isSelected = true
          }
        } else {
          item.status = res.status
          item.candidates = []
          item.error = res.error
        }
      } catch (err: unknown) {
        item.status = 'ERROR'
        item.candidates = []
        item.error = err instanceof Error ? err.message : 'Lookup failed'
      }

      setItems([...updated])
      // Polite delay between requests to avoid rate limits
      await new Promise((r) => setTimeout(r, 200))
    }

    setIsScanning(false)
  }

  const handleStopScan = () => {
    scanAbortRef.current = true
    setIsScanning(false)
  }

  const toggleSelectAll = (select: boolean) => {
    setItems((prev) =>
      prev.map((item) => {
        if (select && item.candidates.length > 0 && item.status !== 'ERROR') {
          return { ...item, isSelected: true }
        }
        if (!select) {
          return { ...item, isSelected: false }
        }
        return item
      })
    )
  }

  const toggleItemSelection = (index: number) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], isSelected: !next[index].isSelected }
      return next
    })
  }

  const toggleFieldSelection = (index: number, field: keyof SongMetadataReviewItem['selectedFields']) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        selectedFields: {
          ...next[index].selectedFields,
          [field]: !next[index].selectedFields[field],
        },
      }
      return next
    })
  }

  const selectCandidateForSong = (itemIndex: number, candidateIndex: number) => {
    setItems((prev) => {
      const next = [...prev]
      next[itemIndex] = {
        ...next[itemIndex],
        selectedCandidateIndex: candidateIndex,
      }
      return next
    })
  }

  // Selected songs count for updating
  const selectedCount = items.filter((i) => i.isSelected && i.candidates.length > 0).length

  // Apply updates handler
  const handleConfirmApply = () => {
    const changesToApply: Array<{ id: string | number; changes: Partial<ActiveSongState> }> = []

    for (const item of items) {
      if (!item.isSelected || item.candidates.length === 0 || item.songId === undefined) continue
      const cand = item.candidates[item.selectedCandidateIndex]
      if (!cand) continue

      const changes: Partial<ActiveSongState> = {}

      if (item.selectedFields.title && cand.title && cand.title.trim()) {
        changes.title = cand.title.trim()
      }
      if (item.selectedFields.artist && cand.artist && cand.artist.trim()) {
        changes.artist = cand.artist.trim()
      }
      if (item.selectedFields.originalKey && cand.originalKey && cand.originalKey.trim()) {
        changes.originalKey = cand.originalKey.trim()
      }
      if (item.selectedFields.bpm && cand.bpm && cand.bpm.trim()) {
        changes.bpm = cand.bpm.trim()
      }
      if (item.selectedFields.year && cand.year && cand.year.trim()) {
        changes.year = cand.year.trim()
      }

      if (Object.keys(changes).length > 0) {
        changesToApply.push({ id: item.songId, changes })
      }
    }

    if (changesToApply.length > 0) {
      onApplyUpdates(changesToApply)
    }

    setShowConfirmModal(false)
    onClose()
  }

  const filteredItems = useMemo(() => {
    if (filterStatus === 'ALL') return items
    return items.filter((i) => i.status === filterStatus)
  }, [items, filterStatus])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-[#073642] border border-[#1A4A55] shadow-2xl flex flex-col overflow-hidden text-[#EEE8D5]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#1A4A55] flex items-center justify-between bg-[#002B36]/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#2AA198]/20 border border-[#2AA198]/40 flex items-center justify-center text-[#2AA198]">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#FDF6E3]">Song Metadata Lookup &amp; Review</h2>
              <div className="text-[11px] text-[#93A1A1] flex items-center gap-1.5 font-mono">
                <span>Original Keys, BPM, &amp; Release Years</span>
                <span>•</span>
                <span>Powered by</span>
                <a
                  href="https://getsongbpm.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#2AA198] hover:underline inline-flex items-center gap-0.5"
                  title="Visit GetSongBPM.com"
                >
                  GetSongBPM <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#002B36] transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-3 border-b border-[#1A4A55] bg-[#002B36]/40 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2">
            {!isScanning ? (
              <button
                type="button"
                data-testid="start-metadata-scan-btn"
                onClick={handleStartScan}
                className="px-3.5 py-1.5 rounded-lg bg-[#2AA198] hover:bg-[#2AA198]/90 text-[#002B36] font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{items.some((i) => i.candidates.length > 0) ? 'Re-Scan Metadata' : `Scan Library (${items.length})`}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopScan}
                className="px-3.5 py-1.5 rounded-lg bg-[#DC6E67] hover:bg-[#DC6E67]/90 text-white font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Stop Scan ({scanProgress.current}/{scanProgress.total})</span>
              </button>
            )}

            <div className="h-4 w-[1px] bg-[#1A4A55] mx-1" />

            {/* Filter Pills */}
            <div className="flex items-center gap-1 bg-[#002B36] p-0.5 rounded-lg border border-[#1A4A55]">
              {(['ALL', 'MATCH', 'REVIEW', 'NO_MATCH', 'ERROR'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilterStatus(st)}
                  className={`px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                    filterStatus === st
                      ? 'bg-[#2AA198] text-[#002B36] font-bold'
                      : 'text-[#93A1A1] hover:text-[#FDF6E3]'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st === 'NO_MATCH' ? 'No Match' : st}
                </button>
              ))}
            </div>
          </div>

          {/* Selection helpers */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggleSelectAll(true)}
              className="text-[11px] text-[#2AA198] hover:underline cursor-pointer font-mono"
            >
              Select Matches
            </button>
            <span className="text-[#93A1A1]">•</span>
            <button
              type="button"
              onClick={() => toggleSelectAll(false)}
              className="text-[11px] text-[#93A1A1] hover:text-[#FDF6E3] cursor-pointer font-mono"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Scan Progress Bar */}
        {isScanning && (
          <div className="w-full bg-[#002B36] h-1 shrink-0 overflow-hidden">
            <div
              className="bg-[#2AA198] h-full transition-all duration-200"
              style={{ width: `${(scanProgress.current / Math.max(1, scanProgress.total)) * 100}%` }}
            />
          </div>
        )}

        {/* Song List & Comparison Table */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-[#93A1A1] text-xs font-mono">
              No songs found matching status: {filterStatus}
            </div>
          ) : (
            filteredItems.map((item, originalIndex) => {
              const actualIndex = items.findIndex((i) => i.songId === item.songId)
              const cand = item.candidates[item.selectedCandidateIndex]

              return (
                <div
                  key={String(item.songId || originalIndex)}
                  className={`p-3.5 rounded-xl border transition-all ${
                    item.isSelected
                      ? 'border-[#2AA198] bg-[#002B36]/70 shadow-sm'
                      : 'border-[#1A4A55] bg-[#002B36]/30 hover:border-[#1A4A55]/90'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={item.isSelected}
                        disabled={item.candidates.length === 0}
                        onChange={() => toggleItemSelection(actualIndex)}
                        className="mt-1 rounded border-[#1A4A55] text-[#2AA198] focus:ring-0 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                      <div>
                        <div className="font-bold text-sm text-[#FDF6E3] flex items-center gap-2">
                          <span>{item.storedTitle}</span>
                          {item.storedArtist && (
                            <span className="text-xs text-[#93A1A1] font-normal">by {item.storedArtist}</span>
                          )}
                        </div>

                        {/* Current vs Found Metadata Badges */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-mono">
                          <span className="text-[10px] uppercase tracking-wider text-[#93A1A1]">Current:</span>
                          <span className="px-1.5 py-0.5 rounded bg-[#073642] text-[#B58900] border border-[#1A4A55]">
                            Chart Key: {item.currentChartKey || 'None'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#073642] text-[#2AA198] border border-[#1A4A55]">
                            Orig Key: {item.currentOriginalKey || '-'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#073642] text-[#CB4B16] border border-[#1A4A55]">
                            BPM: {item.currentBpm || '-'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#073642] text-[#93A1A1] border border-[#1A4A55]">
                            Year: {item.currentYear || '-'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      {item.status === 'MATCH' && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> MATCH
                        </span>
                      )}
                      {item.status === 'REVIEW' && item.candidates.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-mono font-bold flex items-center gap-1">
                          <HelpCircle className="w-3 h-3" /> REVIEW
                        </span>
                      )}
                      {item.status === 'NO_MATCH' && (
                        <span className="px-2 py-0.5 rounded-full bg-zinc-600/20 text-zinc-400 border border-zinc-600/30 text-[10px] font-mono font-bold flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> NO MATCH
                        </span>
                      )}
                      {item.status === 'ERROR' && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-mono font-bold flex items-center gap-1" title={item.error}>
                          <AlertCircle className="w-3 h-3" /> ERROR
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Candidate selection & Field level toggles */}
                  {cand && (
                    <div className="mt-3 pt-2.5 border-t border-[#1A4A55]/60 bg-[#073642]/50 p-2.5 rounded-lg text-xs">
                      {/* Candidate selector if multiple candidates exist */}
                      {item.candidates.length > 1 && (
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[11px] font-mono text-[#93A1A1]">Candidate:</span>
                          <select
                            value={item.selectedCandidateIndex}
                            onChange={(e) => selectCandidateForSong(actualIndex, parseInt(e.target.value, 10))}
                            className="bg-[#002B36] border border-[#1A4A55] text-xs font-mono text-[#FDF6E3] rounded px-2 py-1 outline-none"
                          >
                            {item.candidates.map((c, idx) => (
                              <option key={c.id || idx} value={idx}>
                                {c.title} — {c.artist} ({c.confidence} confidence)
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-[11px] font-mono text-[#2AA198] font-bold">Found:</span>

                          {/* Field checkboxes */}
                          {cand.originalKey && (
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={item.selectedFields.originalKey}
                                onChange={() => toggleFieldSelection(actualIndex, 'originalKey')}
                                className="rounded border-[#1A4A55] text-[#2AA198] focus:ring-0"
                              />
                              <span className="text-[#FDF6E3] font-mono">
                                Orig Key: <strong className="text-[#2AA198]">{cand.originalKey}</strong>
                              </span>
                            </label>
                          )}

                          {cand.bpm && (
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={item.selectedFields.bpm}
                                onChange={() => toggleFieldSelection(actualIndex, 'bpm')}
                                className="rounded border-[#1A4A55] text-[#2AA198] focus:ring-0"
                              />
                              <span className="text-[#FDF6E3] font-mono">
                                BPM: <strong className="text-[#CB4B16]">{cand.bpm}</strong>
                              </span>
                            </label>
                          )}

                          {cand.year && (
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={item.selectedFields.year}
                                onChange={() => toggleFieldSelection(actualIndex, 'year')}
                                className="rounded border-[#1A4A55] text-[#2AA198] focus:ring-0"
                              />
                              <span className="text-[#FDF6E3] font-mono">
                                Year: <strong className="text-[#93A1A1]">{cand.year}</strong>
                              </span>
                            </label>
                          )}

                          {cand.artist && cand.artist.toLowerCase() !== item.storedArtist.toLowerCase() && (
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={item.selectedFields.artist}
                                onChange={() => toggleFieldSelection(actualIndex, 'artist')}
                                className="rounded border-[#1A4A55] text-[#2AA198] focus:ring-0"
                              />
                              <span className="text-[#93A1A1] font-mono">Artist: {cand.artist}</span>
                            </label>
                          )}
                        </div>

                        {cand.sourceUrl && (
                          <a
                            href={cand.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-[#93A1A1] hover:text-[#2AA198] flex items-center gap-1"
                          >
                            <span>GetSongBPM Entry</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {item.error && (
                    <div className="mt-2 text-[11px] font-mono text-[#DC6E67] bg-[#DC6E67]/10 p-2 rounded border border-[#DC6E67]/30">
                      {item.error}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1A4A55] bg-[#002B36] flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs font-mono text-[#93A1A1]">
            <span className="font-bold text-[#FDF6E3]">{selectedCount}</span> songs selected for update
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[#1A4A55] text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#073642] text-xs font-mono cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="apply-metadata-updates-btn"
              disabled={selectedCount === 0}
              onClick={() => setShowConfirmModal(true)}
              className="px-4 py-1.5 rounded-lg bg-[#2AA198] hover:bg-[#2AA198]/90 text-[#002B36] font-bold text-xs cursor-pointer transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Review &amp; Apply ({selectedCount})
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal — EXACT ONE-STEP CONFIRMATION */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-[#073642] border border-[#1A4A55] p-5 shadow-2xl flex flex-col gap-4 text-xs">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#2AA198]/20 border border-[#2AA198]/40 flex items-center justify-center text-[#2AA198] shrink-0">
                <Check className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#FDF6E3]">Apply Metadata Updates</h3>
                <p className="text-[11px] text-[#93A1A1]">
                  Apply selected updates to {selectedCount} {selectedCount === 1 ? 'song' : 'songs'}?
                </p>
              </div>
            </div>

            <div className="bg-[#002B36] p-3 rounded-xl border border-[#1A4A55] space-y-2 text-[#EEE8D5] text-[11px] leading-relaxed">
              <p>• Only your selected metadata fields (Original Key, BPM, Release Year) will be updated.</p>
              <p className="text-[#2AA198] font-bold">
                • Chord content, Chart Key, and Stage Transpose are NOT changed.
              </p>
              <p className="text-[#93A1A1]">• These updates apply directly to your local songbook.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3] font-mono cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-apply-metadata-btn"
                onClick={handleConfirmApply}
                className="px-4 py-1.5 rounded-lg bg-[#2AA198] hover:bg-[#2AA198]/90 text-[#002B36] font-bold cursor-pointer transition-colors shadow-sm"
              >
                Apply Updates
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
