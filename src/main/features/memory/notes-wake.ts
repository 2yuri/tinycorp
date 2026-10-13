import {
  alignDown,
  BYTES_PER_TOKEN,
  decompose,
  estimateTokens,
  halves,
  NOTES_LEAF,
  NOTES_VERBATIM_SHARE,
  type Note,
  type NoteRange,
  type NotesWake,
  rangeLabel,
  rangeSize,
  type WakeItem,
} from '../../../shared/memory/notes'
import { assertNever } from '../../../shared/platform/assert-never'

/**
 * The wake: what a Session reads of its Employee's notes when it starts, inside a budget that does
 * not grow with the log (T193, after OptMem — see `NOTICE`).
 *
 * The shape of it, newest last, because that is the order the prompt reads:
 *
 * ```
 * #0–1023    summary          ← one line for a thousand notes
 * #1024–1535 summary
 * #1536–1663 summary
 * #1664–1671 the eight notes themselves
 * #1672…     the last fifty notes, word for word
 * ```
 *
 * The older half is {@link decompose}d into aligned blocks, which is the binary counter: covering
 * a million notes takes as many blocks as a million takes bits. That is the whole trick — the
 * budget buys a fixed number of lines, and each line covers twice as much as the one before it.
 *
 * Nothing here reads a file. The log and the tree arrive as three functions, so the planner is
 * tested against arrays and the million-note case is the only test that needs a disk.
 */

/**
 * What every item costs on top of its own text: the range, the separator and the newline the
 * prompt puts around it. Charged so that what {@link renderWake} writes stays inside the budget
 * the plan was made against, rather than inside it plus twenty prefixes.
 */
const ITEM_OVERHEAD = 32

/** What the planner asks of the log and the tree. Neither is asked for more than it must give. */
export interface WakeSource {
  total: number
  /** The notes of `[lo, hi)`. */
  notes(lo: number, hi: number): Note[]
  /** That exact range's summary, or null. */
  summary(range: NoteRange): { text: string; at: string } | null
  /** Whether that exact range is summarised, without reading the summary. */
  has(range: NoteRange): boolean
  /** Whether any summary at all sits inside the range, which is when descending into it can pay. */
  holdsInside(range: NoteRange): boolean
}

export interface WakeOptions {
  /** The Company's `Read at session start`, in tokens. */
  budget: number
  /** How much of it the most recent notes get word for word. */
  verbatimShare?: number
}

export function planWake(source: WakeSource, { budget, verbatimShare = NOTES_VERBATIM_SHARE }: WakeOptions): NotesWake {
  if (source.total === 0 || budget <= 0) return { items: [], total: source.total, tokens: 0, budget, due: null }

  const bytes = budget * BYTES_PER_TOKEN
  const recent = verbatim(source, Math.floor(bytes * verbatimShare))
  // The word-for-word window ends on a leaf boundary, so every block behind it is one a summary
  // can cover. It costs at most seven extra notes read in full and it keeps the tree whole.
  const edge = alignDown(recent.from)
  const notes = edge === recent.from ? recent.notes : source.notes(edge, source.total)
  const blocks = decompose(edge)

  const older: WakeItem[] = []
  let left = bytes - cost(notes.map(noteItem))
  for (const block of blocks) left = cover(source, block, left, older)

  const items = [...older.reverse(), ...notes.map(noteItem)]
  return {
    items,
    total: source.total,
    tokens: estimateTokens(Buffer.byteLength(renderWake(items), 'utf8')),
    budget,
    due: dueSummary(source),
  }
}

/**
 * The wake as the instructions carry it: one line per item, oldest first.
 *
 * A summary and a gap both say which notes they stand for, because an Employee that wants a note
 * back asks for it by range — and a gap says so out loud rather than letting the history look as
 * though it began where the reading did.
 */
export function renderWake(items: WakeItem[]): string {
  return items
    .map((item) => {
      switch (item.kind) {
        case 'note':
          return `#${item.note.id} ${item.note.by === 'boss' ? '(from the boss) ' : ''}${item.note.text}`
        case 'summary':
          return `${rangeLabel(item.range)} ${item.text}`
        case 'gap':
          return `${rangeLabel(item.range)} ${rangeSize(item.range)} notes, not summarised yet — \`zoom\` to read them`
        default:
          return assertNever(item, 'wake item')
      }
    })
    .join('\n')
}

/** The newest notes that fit in `allowance`, oldest first, and the id the oldest of them has. */
function verbatim(source: WakeSource, allowance: number): { notes: Note[]; from: number } {
  const step = 64
  let from = source.total
  let notes: Note[] = []
  let spent = 0
  while (from > 0) {
    const batch = source.notes(Math.max(0, from - step), from)
    if (batch.length === 0) break
    let taken = 0
    for (let at = batch.length - 1; at >= 0; at--) {
      const note = batch[at]
      if (!note) break
      const next = spent + cost([noteItem(note)])
      // At least one note word for word, whatever the budget: a Session told nothing at all about
      // the last thing it did is worse than one that is a few hundred bytes over.
      if (next > allowance && (notes.length > 0 || taken > 0)) {
        return { notes: [...batch.slice(at + 1), ...notes], from: from - taken }
      }
      spent = next
      taken++
    }
    notes = [...batch, ...notes]
    from -= batch.length
  }
  return { notes, from: 0 }
}

/**
 * One block of the older half, as whatever it can honestly be inside `left` bytes.
 *
 * A summary if there is one that fits. A range at the leaf, read outright. Otherwise its two
 * halves, newest first — but only where the tree holds something inside, because descending a
 * block nobody has ever summarised would walk to the bottom of the log and spend the whole budget
 * on eight notes from the middle of last month.
 *
 * What is left over is a `gap`: the range, named, with nothing read from it. That is the honest
 * answer and it is a reachable one — `zoom` opens it, so no note is ever out of reach.
 */
function cover(source: WakeSource, range: NoteRange, left: number, into: WakeItem[]): number {
  const gap = (): number => {
    const item: WakeItem = { kind: 'gap', range }
    into.push(item)
    return left - cost([item])
  }

  const summary = source.summary(range)
  if (summary) {
    const item: WakeItem = { kind: 'summary', range, text: summary.text, at: summary.at }
    if (cost([item]) > left) return gap()
    into.push(item)
    return left - cost([item])
  }
  if (left <= 0) return gap()

  const children = halves(range)
  if (children.length === 0) {
    const items = source.notes(range.lo, range.hi).map(noteItem)
    if (cost(items) > left) return gap()
    into.push(...items)
    return left - cost(items)
  }
  if (!source.holdsInside(range)) return gap()

  const [older, newer] = children
  let rest = cover(source, newer, left, into)
  rest = cover(source, older, rest, into)
  return rest
}

/**
 * The summary the Employee owes next, or null when the tree is complete.
 *
 * Over the whole log rather than over the part outside the word-for-word window, because a note
 * read in full today is one the wake summarises next week: building the rung while the notes are
 * still fresh is the cheap time to do it, and it makes `due` the same answer whatever the budget.
 *
 * Newest block first, and inside a block the oldest missing rung, because a parent is written from
 * its two halves: `#0–7` and `#8–15` before `#0–15`. One at a time on purpose — the `note` result
 * names it, and a list of four hundred is a list nobody starts.
 */
export function dueSummary(source: WakeSource): NoteRange | null {
  for (const block of decompose(alignDown(source.total))) {
    const due = missing(source, block)
    if (due) return due
  }
  return null
}

function missing(source: WakeSource, range: NoteRange): NoteRange | null {
  if (source.has(range)) return null
  if (rangeSize(range) <= NOTES_LEAF) return range
  // Nothing at all is written under here — a fresh log, or a range the boss restored. The oldest
  // leaf is the first rung of the ladder, and finding it costs no walk.
  if (!source.holdsInside(range)) return { lo: range.lo, hi: range.lo + NOTES_LEAF }
  const children = halves(range)
  if (children.length === 0) return range
  const [older, newer] = children
  return missing(source, older) ?? missing(source, newer) ?? range
}

function noteItem(note: Note): WakeItem {
  return { kind: 'note', note }
}

/** What these items cost the budget: their own bytes, plus the line the prompt wraps each one in. */
function cost(items: WakeItem[]): number {
  return items.reduce((total, item) => total + Buffer.byteLength(renderWake([item]), 'utf8') + ITEM_OVERHEAD, 0)
}
