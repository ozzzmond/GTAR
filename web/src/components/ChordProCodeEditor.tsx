import React, { useState, useMemo, useRef, useLayoutEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  CheckSquare,
  FoldVertical,
  UnfoldVertical,
} from 'lucide-react'
import {
  parseChordProSections,
  type ChordProSection,
} from '../utils/chordProSections'
import { indentText } from '../utils/editorText'

export interface ChordProCodeEditorProps {
  rawContent: string
  onChange: (newContent: string) => void
  onSelectRange: (start: number, end: number) => void
  onShowToast: (message: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onBeforeInput?: (e: React.FormEvent<HTMLTextAreaElement>) => void
  onSelect?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void
}

export const ChordProCodeEditor: React.FC<ChordProCodeEditorProps> = ({
  rawContent,
  onChange,
  onSelectRange,
  onShowToast,
  onKeyDown,
  onBeforeInput,
  onSelect,
}) => {
  const [foldedSectionIds, setFoldedSectionIds] = useState<Set<string>>(new Set())
  const [copiedSectionId, setCopiedSectionId] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const activeSelectionRef = useRef<{
    selectionStart: number
    selectionEnd: number
  } | null>(null)

  const parsedSections = useMemo(() => parseChordProSections(rawContent), [rawContent])

  useLayoutEffect(() => {
    if (!activeSelectionRef.current) return
    const { selectionStart, selectionEnd } = activeSelectionRef.current
    // Section IDs are positional: edits can split/merge sections. Resolve the
    // document position against the newly parsed source, including EOF.
    const section = parsedSections.sections.find((s, index) =>
      selectionStart >= s.startChar &&
      (selectionStart < s.endChar || index === parsedSections.sections.length - 1))
    if (!section) {
      activeSelectionRef.current = null
      return
    }
    if (foldedSectionIds.has(section.id)) {
      setFoldedSectionIds((prev) => {
        const next = new Set(prev)
        next.delete(section.id)
        return next
      })
      return
    }
    activeSelectionRef.current = null
    const textarea = textareaRefs.current[section.id]
    if (textarea) {
      textarea.focus()
      textarea.setSelectionRange(selectionStart - section.startChar,
        Math.min(selectionEnd, section.endChar) - section.startChar)
    }
  }, [parsedSections.sections, foldedSectionIds])

  const toggleFold = (sectionId: string) => {
    setFoldedSectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  const foldAll = () => {
    const musicalSectionIds = parsedSections.sections
      .filter((s) => s.type === 'section')
      .map((s) => s.id)
    setFoldedSectionIds(new Set(musicalSectionIds))
    onShowToast('Collapsed all musical sections')
  }

  const unfoldAll = () => {
    setFoldedSectionIds(new Set())
    onShowToast('Expanded all musical sections')
  }

  const handleCopySection = async (section: ChordProSection, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await navigator.clipboard.writeText(section.fullText)
      setCopiedSectionId(section.id)
      setTimeout(() => setCopiedSectionId(null), 2000)
      onShowToast(`Copied [${section.cleanLabel}] section to clipboard`)
    } catch {
      onShowToast('Failed to copy section to clipboard')
    }
  }

  const handleSelectSection = (section: ChordProSection, e?: React.MouseEvent) => {
    e?.stopPropagation()
    activeSelectionRef.current = {
      selectionStart: section.startChar,
      selectionEnd: section.endChar,
    }
    setFoldedSectionIds((prev) => {
      const next = new Set(prev)
      next.delete(section.id)
      return next
    })
    setSelectedSectionId(section.id)
    onSelectRange(section.startChar, section.endChar)
    onShowToast(`Selected entire [${section.cleanLabel}] section`)
  }

  const handleSectionTextChange = (sectionId: string, newText: string, textarea?: HTMLTextAreaElement) => {
    const section = parsedSections.sections.find((s) => s.id === sectionId)
    if (textarea && section && document.activeElement === textarea) {
      activeSelectionRef.current = {
        selectionStart: section.startChar + textarea.selectionStart,
        selectionEnd: section.startChar + textarea.selectionEnd,
      }
    }
    const updatedParts = parsedSections.sections.map((s) => {
      if (s.id === sectionId) {
        return newText
      }
      return s.fullText
    })
    const reconstructed = updatedParts.join('')
    onChange(reconstructed)
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-app-base" data-testid="chordpro-code-editor">
      {/* Code Editor Sub-Toolbar */}
      <div className="px-3 py-1.5 bg-app-surface/60 border-b border-app-border flex items-center justify-between text-xs shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-app-muted">
            {parsedSections.sections.filter((s) => s.type === 'section').length}{' '}
            {parsedSections.sections.filter((s) => s.type === 'section').length === 1 ? 'section' : 'sections'}
          </span>
          {foldedSectionIds.size > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-app-action/10 text-app-action font-mono font-medium">
              {foldedSectionIds.size} folded
            </span>
          )}
        </div>

        {parsedSections.hasSections && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="fold-all-sections-button"
              onClick={foldAll}
              className="flex items-center gap-1 px-2 py-1 rounded bg-app-base hover:bg-app-surface border border-app-border text-app-text hover:text-app-heading transition-colors cursor-pointer text-[11px] font-medium"
              aria-label="Collapse all sections"
            >
              <FoldVertical className="w-3 h-3 text-app-muted" />
              <span className="hidden sm:inline">Fold All</span>
            </button>
            <button
              type="button"
              data-testid="unfold-all-sections-button"
              onClick={unfoldAll}
              className="flex items-center gap-1 px-2 py-1 rounded bg-app-base hover:bg-app-surface border border-app-border text-app-text hover:text-app-heading transition-colors cursor-pointer text-[11px] font-medium"
              aria-label="Expand all sections"
            >
              <UnfoldVertical className="w-3 h-3 text-app-muted" />
              <span className="hidden sm:inline">Unfold All</span>
            </button>
          </div>
        )}
      </div>

      {/* Sections List Container */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2 select-text">
        {parsedSections.sections.map((section) => {
          const isFolded = foldedSectionIds.has(section.id)
          const isSelected = selectedSectionId === section.id
          const isCopied = copiedSectionId === section.id
          const isMusicalSection = section.type === 'section'

          return (
            <div
              key={section.id}
              data-testid={`chordpro-section-${section.id}`}
              className={`rounded-lg border transition-all ${
                isSelected
                  ? 'border-app-action/60 bg-app-surface/90 ring-1 ring-app-action/40 shadow-sm'
                  : 'border-app-border/70 bg-app-surface/40 hover:border-app-border'
              }`}
            >
              {/* Section Header Bar */}
              <div
                className={`px-2.5 py-1.5 flex items-center justify-between gap-2 border-b transition-colors select-none ${
                  isFolded ? 'border-transparent' : 'border-app-border/40 bg-app-surface/70'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {/* Fold / Unfold Control */}
                  {isMusicalSection ? (
                    <button
                      type="button"
                      data-testid={`fold-btn-${section.id}`}
                      onClick={() => toggleFold(section.id)}
                      className="p-1 rounded text-app-muted hover:text-app-action hover:bg-app-base transition-colors cursor-pointer shrink-0 min-h-[28px] min-w-[28px] flex items-center justify-center"
                      aria-label={isFolded ? `Expand section ${section.cleanLabel}` : `Collapse section ${section.cleanLabel}`}
                      aria-expanded={!isFolded}
                    >
                      {isFolded ? (
                        <ChevronRight className="w-3.5 h-3.5 text-app-action shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-app-muted hover:text-app-action shrink-0" />
                      )}
                    </button>
                  ) : (
                    <div className="w-7 h-7 shrink-0" />
                  )}

                  {/* Section Title Label */}
                  <span
                    className={`font-mono text-xs font-bold truncate ${
                      isMusicalSection ? 'text-app-action' : 'text-app-muted'
                    }`}
                  >
                    {isMusicalSection ? `[${section.cleanLabel}]` : section.cleanLabel}
                  </span>

                  {/* Line count badge */}
                  <span className="text-[10px] text-app-muted/70 font-mono hidden sm:inline">
                    {section.fullLines.length} {section.fullLines.length === 1 ? 'line' : 'lines'}
                  </span>
                </div>

                {/* Section Actions: Select & Copy */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    data-testid={`select-section-${section.id}`}
                    onClick={(e) => handleSelectSection(section, e)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-app-base hover:bg-app-surface border border-app-border text-[10px] font-semibold text-app-text hover:text-app-heading transition-colors cursor-pointer min-h-[28px]"
                    aria-label={`Select entire section ${section.cleanLabel}`}
                  >
                    <CheckSquare className="w-3 h-3 text-app-action" />
                    <span className="hidden sm:inline">Select</span>
                  </button>

                  <button
                    type="button"
                    data-testid={`copy-section-${section.id}`}
                    onClick={(e) => handleCopySection(section, e)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-app-base hover:bg-app-surface border border-app-border text-[10px] font-semibold text-app-text hover:text-app-heading transition-colors cursor-pointer min-h-[28px]"
                    aria-label={`Copy section ${section.cleanLabel}`}
                  >
                    {isCopied ? (
                      <Check className="w-3 h-3 text-status-success" />
                    ) : (
                      <Copy className="w-3 h-3 text-app-muted" />
                    )}
                    <span className="hidden sm:inline">{isCopied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Section Body */}
              {isFolded ? (
                /* Collapsed Visual Placeholder */
                <div
                  role="button"
                  tabIndex={0}
                  data-testid={`collapsed-placeholder-${section.id}`}
                  aria-label={`Expand section ${section.cleanLabel}`}
                  onClick={() => toggleFold(section.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleFold(section.id)
                    }
                  }}
                  className="cursor-pointer mx-2 my-1.5 px-3 py-2 rounded-md bg-app-base/70 hover:bg-app-surface border border-dashed border-app-border hover:border-app-action/50 transition-colors flex items-center justify-between text-xs font-mono text-app-muted select-none group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-app-action font-bold">···</span>
                    <span className="font-semibold text-app-heading/80">
                      [{section.cleanLabel}] folded
                    </span>
                    <span className="text-[11px] text-app-muted">
                      ({section.fullLines.length} {section.fullLines.length === 1 ? 'line' : 'lines'} hidden)
                    </span>
                  </div>
                  <span className="text-[10px] text-app-muted group-hover:text-app-action font-sans transition-colors">
                    Click or press Enter to expand
                  </span>
                </div>
              ) : (
                /* Expanded Section Text Editor */
                <div className="p-2 bg-app-base rounded-b-lg">
                  <textarea
                    ref={(el) => {
                      textareaRefs.current[section.id] = el
                    }}
                    data-testid={`section-textarea-${section.id}`}
                    aria-label={`Content of section ${section.cleanLabel}`}
                    value={section.fullText}
                    onChange={(e) => handleSectionTextChange(section.id, e.target.value, e.currentTarget)}
                    onBeforeInput={onBeforeInput}
                    onSelect={(e) => {
                      const target = e.currentTarget
                      onSelectRange(section.startChar + target.selectionStart, section.startChar + target.selectionEnd)
                      onSelect?.(e)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                        e.preventDefault()
                        const textarea = e.currentTarget
                        const indented = indentText(textarea.value, textarea.selectionStart, textarea.selectionEnd, e.shiftKey)
                        handleSectionTextChange(section.id, indented.text, textarea)
                        activeSelectionRef.current = {
                          selectionStart: section.startChar + indented.start,
                          selectionEnd: section.startChar + indented.end,
                        }
                        return
                      }
                      onKeyDown?.(e)
                    }}
                    rows={Math.max(2, section.fullLines.length)}
                    spellCheck={false}
                    className="w-full bg-transparent text-app-heading font-mono text-sm leading-relaxed focus:outline-none resize-y selection:bg-app-action/30 selection:text-app-heading p-1"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
