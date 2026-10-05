import React from 'react'
import {
  X,
  Music,
  RotateCcw
} from 'lucide-react'
import { transposeKey, formatTransposeOffset, formatEnharmonicKey } from '../utils/chordTransposer'

interface KeyPickerModalProps {
  isOpen: boolean
  onClose: () => void
  originalKey: string
  currentOffset: number
  onSelectOffset: (offset: number) => void
  onReset: () => void
}

export const KeyPickerModal: React.FC<KeyPickerModalProps> = ({
  isOpen,
  onClose,
  originalKey,
  currentOffset,
  onSelectOffset,
  onReset,
}) => {
  if (!isOpen) return null

  const baseKey = originalKey || 'C'
  const effectiveTransposedKey = transposeKey(baseKey, currentOffset)

  // Offsets list matching Android SongViewerScreen (-6 to +6)
  const offsets = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-[#1A4A55] bg-[#073642] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#1A4A55] flex items-center justify-between bg-[#002B36]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#073642] border border-[#B58900]/40 flex items-center justify-center text-[#B58900]">
              <Music className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#FDF6E3]">Transpose Key</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#073642] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Key Status Card */}
        <div className="p-5 border-b border-[#1A4A55] bg-[#002B36]/60 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-[10px] font-mono text-[#93A1A1] uppercase tracking-wider block">
                Original Key
              </span>
              <span className="text-xl font-black text-[#FDF6E3] font-mono">
                {baseKey}
              </span>
            </div>

            <div className="text-[#2AA198] font-mono font-bold text-base">→</div>

            <div>
              <span className="text-[10px] font-mono text-[#2AA198] uppercase tracking-wider block">
                Transposed Key
              </span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-[#B58900] font-mono">
                  {formatEnharmonicKey(effectiveTransposedKey)}
                </span>
                {currentOffset !== 0 && (
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[#B58900]/20 text-[#B58900] border border-[#B58900]/40">
                    {formatTransposeOffset(currentOffset)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick Reset to Original Key Button */}
          {currentOffset !== 0 && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#DC6E67]/50 bg-[#002B36] text-[#DC6E67] hover:bg-[#DC6E67]/20 text-xs font-bold transition-all cursor-pointer shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset (0)</span>
            </button>
          )}
        </div>

        {/* Semitone Shift Selector Grid (-6 to +6) */}
        <div className="p-5 overflow-y-auto flex-1">
          <label className="block text-[#93A1A1] font-mono text-[11px] uppercase mb-3">
            Select Transpose Key:
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {offsets.map((offset) => {
              const targetKey = transposeKey(baseKey, offset)
              const isSelected = offset === currentOffset
              const offsetLabel = formatTransposeOffset(offset)

              return (
                <button
                  key={offset}
                  type="button"
                  onClick={() => {
                    onSelectOffset(offset)
                    onClose()
                  }}
                  className={`px-3 py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#B58900] bg-[#002B36] text-[#FDF6E3] ring-1 ring-[#B58900] shadow-md'
                      : 'border-[#1A4A55] bg-[#002B36]/50 text-[#93A1A1] hover:border-[#2AA198] hover:text-[#FDF6E3]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-10 py-1 text-center rounded text-xs font-mono font-bold ${
                        isSelected
                          ? 'bg-[#B58900] text-[#002B36]'
                          : 'bg-[#073642] text-[#93A1A1]'
                      }`}
                    >
                      {offsetLabel}
                    </span>
                    <div>
                      <span className="font-bold text-sm font-mono text-[#FDF6E3]">{formatEnharmonicKey(targetKey)}</span>
                      {offset === 0 && (
                        <span className="ml-1.5 text-[10px] text-[#2AA198] font-mono uppercase">
                          (Original)
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-[#002B36] border-t border-[#1A4A55] flex items-center justify-end text-xs font-mono text-[#93A1A1]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#073642] text-[#FDF6E3] hover:bg-[#1A4A55] font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
