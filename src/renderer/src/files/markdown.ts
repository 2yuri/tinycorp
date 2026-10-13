/**
 * Markdown as the viewer draws it: blocks and inline spans, never HTML. The Files view renders
 * these as React elements, so nothing a repo holds can inject markup into the app.
 */

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; language: string | null; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; head: string[]; align: Align[]; rows: string[][] }
  | { kind: 'rule' }

/** What a table's delimiter row asks of its column; `null` is the author leaving it alone. */
export type Align = 'left' | 'center' | 'right' | null

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'emphasis'; text: string }
  | { kind: 'link'; text: string; href: string }

/** The document as blocks, in the order it wrote them. */
export function markdownBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = source.split('\n')
  let index = 0

  const paragraph: string[] = []
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    paragraph.length = 0
  }

  while (index < lines.length) {
    const line = lines[index]!
    const fence = /^\s*```(\S*)\s*$/.exec(line)
    if (fence) {
      flush()
      const text: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index]!)) text.push(lines[index++]!)
      index += 1
      blocks.push({ kind: 'code', language: fence[1] || null, text: text.join('\n') })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() })
      index += 1
      continue
    }
    const table = tableAt(lines, index)
    if (table) {
      flush()
      blocks.push(table.block)
      index = table.next
      continue
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      flush()
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flush()
      const text: string[] = [quote[1]!]
      index += 1
      while (index < lines.length && /^>\s?/.test(lines[index]!)) text.push(lines[index++]!.replace(/^>\s?/, ''))
      blocks.push({ kind: 'quote', text: text.join(' ').trim() })
      continue
    }
    const item = listItem(line)
    if (item) {
      flush()
      const items: string[] = []
      const ordered = item.ordered
      while (index < lines.length) {
        const next = listItem(lines[index]!)
        if (!next || next.ordered !== ordered) break
        items.push(next.text)
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    if (line.trim() === '') {
      flush()
      index += 1
      continue
    }
    paragraph.push(line.trim())
    index += 1
  }
  flush()
  return blocks
}

/**
 * A table, from its header row and the `|---|---|` under it. The delimiter row is what says a
 * line of pipes is a table and not a sentence with a pipe in it, so a header without one falls
 * through to a paragraph, as it did before there were tables at all.
 */
function tableAt(lines: string[], start: number): { block: MarkdownBlock; next: number } | null {
  const head = tableCells(lines[start])
  if (head === null) return null
  const align = delimiterRow(lines[start + 1])
  if (align === null || align.length !== head.length) return null
  const rows: string[][] = []
  let index = start + 2
  for (let cells = tableCells(lines[index]); cells !== null; cells = tableCells(lines[index])) {
    // A short row is padded and a long one is cut, so every row has the header's columns.
    rows.push(Array.from({ length: head.length }, (_, column) => cells[column] ?? ''))
    index += 1
  }
  return { block: { kind: 'table', head, align, rows }, next: index }
}

/** The cells of one row, or `null` for a line that is not one. `\|` stays a pipe in the cell. */
function tableCells(line: string | undefined): string[] | null {
  if (line === undefined || !line.includes('|') || line.trim() === '') return null
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

function delimiterRow(line: string | undefined): Align[] | null {
  const cells = tableCells(line)
  if (cells === null || cells.length === 0 || !cells.every((cell) => /^:?-+:?$/.test(cell))) return null
  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return left ? 'left' : null
  })
}

function listItem(line: string): { ordered: boolean; text: string } | null {
  const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
  if (bullet) return { ordered: false, text: bullet[1]! }
  const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
  return numbered ? { ordered: true, text: numbered[1]! } : null
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/

/** One line of Markdown as its spans: code, bold, italic, links and the text between them. */
export function inlineSpans(text: string): Inline[] {
  const spans: Inline[] = []
  let rest = text
  for (let found = INLINE.exec(rest); found; found = INLINE.exec(rest)) {
    const before = rest.slice(0, found.index)
    if (before) spans.push({ kind: 'text', text: before })
    spans.push(spanOf(found[0]!))
    rest = rest.slice(found.index + found[0]!.length)
  }
  if (rest) spans.push({ kind: 'text', text: rest })
  return spans
}

function spanOf(token: string): Inline {
  if (token.startsWith('`')) return { kind: 'code', text: token.slice(1, -1) }
  if (token.startsWith('**') || token.startsWith('__')) return { kind: 'strong', text: token.slice(2, -2) }
  if (token.startsWith('[')) {
    const [, text, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!
    return { kind: 'link', text: text!, href: href! }
  }
  return { kind: 'emphasis', text: token.slice(1, -1) }
}
