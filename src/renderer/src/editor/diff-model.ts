/**
 * Everything decided *about* the diff editor, in plain data (T243).
 *
 * Monaco cannot run in jsdom, so nothing here imports it — the same split `monaco-model.ts` makes
 * for the file editor. Which way the diff is laid out, where that choice is kept, what the little
 * `3 / 12` says, and which line a thread hangs under all live here, where a unit test reads them.
 */

/** `split` draws the two sides beside each other; `inline` draws one column, as a patch reads. */
export type DiffLayout = 'split' | 'inline'

export const DIFF_LAYOUTS: readonly DiffLayout[] = ['split', 'inline']

/** Where the boss's choice is kept, so the next diff they open is laid out the way they left it. */
export const DIFF_LAYOUT_KEY = 'tinycorp.diff.layout'

/**
 * How much room the diff needs before side by side is worth reading (T244).
 *
 * Two columns of a 1512px window with the file list and the conversation panel both open is about
 * 560px of diff, which is 250px a side: every line wraps or is cut off, and a comment thread under
 * one of them reads a word per line. Monaco's own `renderSideBySideInlineBreakpoint` is 900 for the
 * same reason; this is that number, applied where the boss can still see what was chosen for them.
 */
export const SPLIT_MIN_WIDTH = 900

/** The boss's own choice, or null while they have never made one and the width decides. */
export function readDiffLayout(stored: string | null | undefined): DiffLayout | null {
  return DIFF_LAYOUTS.find((layout) => layout === stored) ?? null
}

/**
 * Which way a diff this wide is laid out: what the boss chose, if they ever chose, and otherwise
 * inline in a pane too narrow for two columns.
 *
 * A width of zero is a diff nothing has measured yet — a mocked editor in a test, the tick before
 * the first layout — and answers `split`, the wide default, rather than flashing one and then the
 * other.
 */
export function layoutFor(width: number, chosen: DiffLayout | null): DiffLayout {
  if (chosen !== null) return chosen
  return width > 0 && width < SPLIT_MIN_WIDTH ? 'inline' : 'split'
}

/**
 * `3 / 12`, and nothing at all until the editor has said how many changes there are — which is
 * also what a file whose two sides are the same says. A count of zero beside a `+1 −0` in the same
 * header would be a second, wrong answer to the same question.
 */
export function changesLabel(current: number, total: number): string {
  if (total === 0) return ''
  return `${Math.min(Math.max(current, 1), total)} / ${total}`
}

/** Where `next` and `previous` land, wrapping at both ends the way Monaco's own commands do. */
export function stepChange(current: number, total: number, direction: 1 | -1): number {
  if (total === 0) return 0
  const next = current + direction
  if (next < 1) return total
  if (next > total) return 1
  return next
}

/**
 * Which side of the diff a line number belongs to.
 *
 * A comment, a review thread and a security finding all name a line of the *head* file, because
 * that is what a forge accepts. A line only the base has — a removed line — has no head number at
 * all, so nothing ever hangs under one.
 */
export type DiffSide = 'original' | 'modified'

/** What hangs under a line of the diff: a comment thread, a review thread, a finding's card. */
export interface DiffOverlay {
  /**
   * Stable for as long as the thing it draws is the same one. A zone is torn down and rebuilt when
   * its id changes, so a reply arriving must not change it — only the line or the file may.
   */
  id: string
  /** The line of the head file it hangs under. */
  line: number
  side?: DiffSide
}

/** A mark in the gutter and the overview ruler: a line somebody has said something about. */
export interface DiffMark {
  line: number
  side?: DiffSide
  /** `comment` is a thread, `finding` is a security finding still open (T241). */
  kind: 'comment' | 'finding'
}

/** The overlays of one side, in line order — which is the order the zones are made in. */
export function overlaysOn<T extends DiffOverlay>(overlays: readonly T[], side: DiffSide): T[] {
  return overlays.filter((one) => (one.side ?? 'modified') === side).sort((a, b) => a.line - b.line)
}

/** The lines of one side that carry a mark of each kind, deduplicated. */
export function marksOn(marks: readonly DiffMark[], side: DiffSide, kind: DiffMark['kind']): number[] {
  const lines = marks.filter((one) => (one.side ?? 'modified') === side && one.kind === kind).map((one) => one.line)
  return [...new Set(lines)].sort((a, b) => a - b)
}
