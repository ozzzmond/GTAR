export interface TextEdit { text: string; start: number; end: number }

// Two spaces keep indentation compatible with the existing monospaced song format.
export function indentText(text: string, start: number, end: number, unindent = false): TextEdit {
  if (start === end && !unindent) {
    return { text: text.slice(0, start) + '  ' + text.slice(end), start: start + 2, end: start + 2 }
  }
  const first = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end
  const newline = text.indexOf('\n', last)
  const limit = newline < 0 ? text.length : newline
  let position = first
  let nextStart = start, nextEnd = end
  const lines = text.slice(first, limit).split('\n').map(line => {
    const removed = unindent ? (line.match(/^(?: {1,2}|\t)/)?.[0].length ?? 0) : 0
    const delta = unindent ? -removed : 2
    if (position <= start) nextStart += unindent ? -Math.min(removed, start - position) : delta
    if (position < end || start === end) nextEnd += unindent ? -Math.min(removed, end - position) : delta
    position += line.length + 1
    return unindent ? line.slice(removed) : '  ' + line
  })
  return { text: text.slice(0, first) + lines.join('\n') + text.slice(limit), start: nextStart, end: nextEnd }
}

export class TextHistory {
  private past: TextEdit[] = []
  private future: TextEdit[] = []
  private limit: number
  constructor(limit = 100) { this.limit = limit }
  record(previous: TextEdit, next: TextEdit) {
    if (previous.text === next.text) return
    this.past.push(previous)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }
  undo(current: TextEdit): TextEdit | undefined {
    const previous = this.past.pop()
    if (previous) this.future.push(current)
    return previous
  }
  redo(current: TextEdit): TextEdit | undefined {
    const next = this.future.pop()
    if (next) this.past.push(current)
    return next
  }
}
