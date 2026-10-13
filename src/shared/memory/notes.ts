/**
 * An Employee's own notes, as both processes name them (T193).
 *
 * The notes are an **append-only log with a fixed-size wake**: one line per note, never edited and
 * never deleted, and a tree of summaries over aligned power-of-two ranges so that a session start
 * can read the whole history inside a budget that does not grow. The idea is OptMem's
 * (github.com/VictorTaelin/OptMem) — see `NOTICE` and `docs/company-memory.md`.
 *
 * Nothing here does IO: these are the shapes, the range arithmetic and the two numbers the wake is
 * measured against. The log and the tree are in `main/features/memory`.
 */

/** The most one note may hold. A note is a line, and a line the boss can read at a glance. */
export const NOTE_MAX_BYTES = 280

/**
 * The smallest range a summary covers. Below it the wake reads the raw notes, which is cheaper
 * than a summary of eight lines and is what makes the bottom of the tree worth nothing to write.
 */
export const NOTES_LEAF = 8

/** What the boss may set `Read at session start` to, in tokens, and what a new Company gets. */
export const NOTES_BUDGETS = [2_000, 4_000, 8_000] as const
export const NOTES_BUDGET_DEFAULT = 4_000

/**
 * The share of the budget the most recent notes get word for word. The rest pays for the
 * summaries going back, which are few — the decomposition below is logarithmic in the log's
 * length, so the older half of a million notes costs about twenty lines.
 */
export const NOTES_VERBATIM_SHARE = 0.6

/** Bytes per token, as every estimate in this app makes it. Nothing here counts a real token. */
export const BYTES_PER_TOKEN = 4

/** Who wrote a note. The Employee writes its own; the boss can add one, and the drawer badges it. */
export type NoteAuthor = 'employee' | 'boss'

/** One note. `id` is its position in the log, which is what makes the log's length the next id. */
export interface Note {
  id: number
  /** ISO, as the line holds it. */
  at: string
  by: NoteAuthor
  text: string
}

/** A half-open range of note ids, `[lo, hi)`. Every range a summary covers is {@link aligned}. */
export interface NoteRange {
  lo: number
  hi: number
}

/** One summary in the tree: what a range of notes came to, and when it was written. */
export interface NoteSummary {
  range: NoteRange
  text: string
  at: string
}

/**
 * One thing the wake reads. A `summary` stands for its range; a `gap` is a range nobody has
 * summarised yet and that would not fit word for word, named so the Employee can zoom into it
 * rather than be left believing the history starts where the reading does.
 */
export type WakeItem =
  | { kind: 'note'; note: Note }
  | { kind: 'summary'; range: NoteRange; text: string; at: string }
  | { kind: 'gap'; range: NoteRange }

/** What a session start reads of an Employee's notes, and what it cost. */
export interface NotesWake {
  /** Newest last, the way the prompt reads them: the summaries first, then the notes themselves. */
  items: WakeItem[]
  /** Notes in the log. */
  total: number
  /** The estimate this wake spends, and the Company's budget, both in tokens. */
  tokens: number
  budget: number
  /** The next summary the Employee owes, or null when the tree is complete. */
  due: NoteRange | null
}

/**
 * What a Session is told about its own notes at spawn: the wake, already one line per item, and
 * what it cost against the Company's budget.
 */
export interface NotesBrief {
  /** The wake as the instructions carry it, oldest first. Empty for an Employee with no notes. */
  text: string
  total: number
  tokens: number
  budget: number
  /** The summary the Employee owes next, which its instructions ask it to write. */
  due: NoteRange | null
}

/** The drawer's Memory tab, in one read (frame `x40RJd`). */
export interface NotesView {
  /** `Recent · word for word`, newest first. */
  recent: Note[]
  /** `Earlier · summarised`, newest range first. A node with no text is one nobody has written. */
  earlier: NotesNode[]
  /** The meter: what the wake spends of the budget, in tokens. */
  tokens: number
  budget: number
  /** The footer: `142 notes · 9 summaries · nothing ever deleted`. */
  notes: number
  summaries: number
  due: NoteRange | null
}

/** One range as the drawer draws it, whether or not anybody has summarised it yet. */
export interface NotesNode {
  range: NoteRange
  /** The summary, or null for a range nobody has written yet. */
  text: string | null
  /** When it was written, or null. */
  at: string | null
  /** The day of the oldest note in the range and of the newest, for `Sep 14–20`. */
  from: string | null
  to: string | null
}

/** What the zoom control opens a node into: its two halves, or the notes themselves. */
export interface NotesZoom {
  range: NoteRange
  /** Set when the range is down to raw notes; `nodes` is then empty. */
  notes: Note[]
  nodes: NotesNode[]
}

/** What `recall` and the drawer's search answer: the matches, and how many there were in all. */
export interface NotesSearch {
  matches: Note[]
  /** Matches in the whole log, which can be more than `matches` holds. */
  total: number
  /** True when `matches` was cut to the limit. */
  truncated: boolean
  /** True when the walk stopped before the end of the log: there may be older matches. */
  partial: boolean
}

/** The tail of the log exactly as it is on disk, for `Raw log`. */
export interface NotesRaw {
  /** The lines, oldest first. */
  text: string
  /** Notes in the log; more than the lines above when the tail was cut. */
  total: number
  truncated: boolean
}

/** Tokens a piece of text is estimated to cost. Bytes ÷ 4, the same estimate the Tokens tab uses. */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_TOKEN)
}

export function rangeSize(range: NoteRange): number {
  return range.hi - range.lo
}

/** `#96–111`, as the drawer and the tools write a range. Inclusive, because a person reads it. */
export function rangeLabel(range: NoteRange): string {
  return `#${range.lo}–${range.hi - 1}`
}

/** Whether a range is one a summary may cover: a power of two, and starting on its own multiple. */
export function aligned(range: NoteRange): boolean {
  const size = rangeSize(range)
  if (!Number.isSafeInteger(range.lo) || !Number.isSafeInteger(range.hi) || range.lo < 0) return false
  if (size < NOTES_LEAF || (size & (size - 1)) !== 0) return false
  return range.lo % size === 0
}

/**
 * The two halves of an aligned range, oldest first, or none for a range already at the leaf. A
 * pair rather than an array, so a caller that has checked the length needs no `!` to read them.
 */
export function halves(range: NoteRange): [NoteRange, NoteRange] | [] {
  const size = rangeSize(range)
  if (size <= NOTES_LEAF) return []
  const middle = range.lo + size / 2
  return [
    { lo: range.lo, hi: middle },
    { lo: middle, hi: range.hi },
  ]
}

/**
 * `[0, end)` as aligned blocks, newest first and growing as they go back.
 *
 * This is the binary counter: the largest aligned block that ends where the cursor is, again and
 * again. It is why the wake is a fixed size — covering a million notes takes as many blocks as a
 * million takes bits, and each one costs a summary.
 */
export function decompose(end: number): NoteRange[] {
  const blocks: NoteRange[] = []
  let cursor = alignDown(end)
  while (cursor > 0) {
    // The lowest set bit is the largest power of two the cursor is a multiple of, which is the
    // largest block that can both end here and start on its own multiple.
    const size = cursor & -cursor
    blocks.push({ lo: cursor - size, hi: cursor })
    cursor -= size
  }
  return blocks
}

/** The largest multiple of {@link NOTES_LEAF} at or below `count`. */
export function alignDown(count: number): number {
  return count - (count % NOTES_LEAF)
}

/** The same range, as the key the tree files it under: `96-112`. */
export function rangeKey(range: NoteRange): string {
  return `${range.lo}-${range.hi}`
}

/** A range back from its key, or null when the text is not one — a stray file in `tree/`. */
export function parseRangeKey(key: string): NoteRange | null {
  const match = /^(\d+)-(\d+)$/.exec(key)
  if (!match) return null
  const range = { lo: Number(match[1]), hi: Number(match[2]) }
  return aligned(range) ? range : null
}

/**
 * A range as an Employee or the boss may type it: `96-111`, `#96-111`, `96..111` or `96–111`, all
 * inclusive of both ends, which is how {@link rangeLabel} writes one. Null when it is not a range.
 *
 * Inclusive in, half-open out: a tool that answered `[96, 111)` to somebody who typed `96-111`
 * would quietly drop a note, and the whole point of this log is that nothing is dropped.
 */
export function parseRange(text: string): NoteRange | null {
  const match = /^#?\s*(\d+)\s*(?:-|–|—|\.\.)\s*(\d+)$/.exec(text.trim())
  if (!match) return null
  const lo = Number(match[1])
  const hi = Number(match[2]) + 1
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi <= lo) return null
  return { lo, hi }
}
