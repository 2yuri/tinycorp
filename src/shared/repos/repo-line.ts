/**
 * A ticket's repos as one line: `banking, core-banking-usd, payment, … +107` (T285). A ticket can
 * touch every repo a Company has, and a row of a hundred chips is taller than the window; the line
 * names the first few, counts the rest, and `all` is the whole list for a hover.
 */

/** How many names the line spells out before it counts the rest. */
export const REPO_LINE_SHOWN = 3

export interface RepoLine {
  /** The names spelled out, joined; ends in `, …` when some are counted instead. */
  text: string
  /** How many repos the line counts rather than names. */
  more: number
  /** Every name, joined, for a title. */
  all: string
}

export function repoLine(names: readonly string[], shown = REPO_LINE_SHOWN): RepoLine {
  const more = Math.max(0, names.length - shown)
  const spelled = names.slice(0, shown).join(', ')
  return { text: more > 0 ? `${spelled}, …` : spelled, more, all: names.join(', ') }
}

/** The line as plain text: `a, b, c, … +107`. */
export function repoLineText(names: readonly string[], shown = REPO_LINE_SHOWN): string {
  const line = repoLine(names, shown)
  return line.more > 0 ? `${line.text} +${line.more}` : line.text
}
