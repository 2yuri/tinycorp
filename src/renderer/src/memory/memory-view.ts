import {
  MEMORY_KIND_PLURAL,
  MEMORY_KINDS,
  MEMORY_SORT_LABEL,
  MEMORY_SORTS,
  type MemoryCounts,
  type MemoryKind,
  type MemoryPageSummary,
  type MemorySort,
} from '../../../shared/memory/company-memory'

/** One chip over the list: `All 42`, `Decisions 11` (frame `E40vSb`). */
export interface KindChip {
  key: 'all' | MemoryKind
  label: string
  count: number
  kind: MemoryKind | null
}

/**
 * What the reading pane says about each kind while a Company has no page at all (frame `SlxSy`):
 * what one is, and where it comes from. A `Record` rather than a list, so a kind added to
 * `MEMORY_KINDS` cannot compile without its line.
 */
export const KIND_EXPLAINED: Record<MemoryKind, { what: string; from: string }> = {
  decision: { what: 'A choice and why it was made.', from: 'from a plan or a review thread' },
  convention: { what: 'How this team does a thing, every time.', from: 'from review comments' },
  gotcha: { what: 'A trap someone already fell into.', from: 'from a failed test or check' },
  architecture: { what: 'What a service owns and where it stops.', from: 'from a plan' },
  glossary: { what: 'What a word means here.', from: 'written by you or an Employee' },
  handoff: { what: 'Where work stood when it changed hands.', from: 'when an Employee switches provider' },
}

/**
 * Those six as the pane lays them out, three rows of two — in the frame's own order, which pairs
 * each kind with the one it is most easily confused with rather than following the filter chips
 * above it. A kind missing from this list is a compile error, so the grid cannot lose one.
 */
const HOW_IT_FILLS_ORDER: readonly [MemoryKind, MemoryKind, MemoryKind, MemoryKind, MemoryKind, MemoryKind] = [
  'decision',
  'convention',
  'gotcha',
  'handoff',
  'architecture',
  'glossary',
]

export const HOW_IT_FILLS: { kind: MemoryKind; what: string; from: string }[] = HOW_IT_FILLS_ORDER.map((kind) => ({
  kind,
  ...KIND_EXPLAINED[kind],
}))

/** What the pane says over those six, in the frame's own words. */
export const HOW_IT_FILLS_TITLE = (companyName: string) => `What ${companyName} will remember`
export const HOW_IT_FILLS_BODY =
  'Nobody has to write it up. When a ticket closes, TinyCorp files what the work settled — without ' +
  'a model — and every Employee reads it before the next one.'

/** The line under the reading pane with nothing open and pages to open (frame `E40vSb`). */
export const PICK_A_PAGE = 'Pick a page to read it.'

/**
 * The chips, in the frame's order, with the counts the footer also gives. Every kind is shown even
 * at zero: the row of chips is what the Memory screen is, and a Company that has written no Gotcha
 * yet should still see that a Gotcha is a thing it can write.
 */
export function kindChips(counts: MemoryCounts): KindChip[] {
  return [
    { key: 'all', label: 'All', count: counts.pages, kind: null },
    ...MEMORY_KINDS.map((kind) => ({
      key: kind,
      label: MEMORY_KIND_PLURAL[kind],
      count: counts.byKind[kind],
      kind,
    })),
  ]
}

/** The three sort buttons, in the frame's order. */
export const SORT_BUTTONS: { key: MemorySort; label: string }[] = MEMORY_SORTS.map((key) => ({
  key,
  label: MEMORY_SORT_LABEL[key],
}))

/**
 * The header's subtitle: what this screen is, and how much of it there is. It says `kept in git`
 * because that is the promise the boss is being given — every edit is a commit with an author.
 *
 * A Company with nothing in it says `no pages yet` rather than `0 pages`, as frame `SlxSy` does:
 * the screen it is over is an invitation, not a report of zero.
 */
export function memorySubtitle(companyName: string, counts: MemoryCounts): string {
  const pages = counts.pages === 0 ? 'no pages yet' : `${counts.pages} ${counts.pages === 1 ? 'page' : 'pages'}`
  return `What ${companyName} knows. Every Employee reads and writes it through MCP, on any provider · ${pages}, kept in git.`
}

/** `History · 6`, or `History` before git has said anything about the page. */
export function historyLabel(revisions: number): string {
  return revisions > 0 ? `History · ${revisions}` : 'History'
}

/** The rows a search box narrows on its own, without going back to the engine on every keystroke. */
export function filterRows(rows: readonly MemoryPageSummary[], query: string): MemoryPageSummary[] {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return [...rows]
  return rows.filter(
    (row) =>
      row.title.toLowerCase().includes(wanted) ||
      row.slug.includes(wanted) ||
      row.repos.some((repo) => repo.toLowerCase().includes(wanted)) ||
      row.sources.some((source) => source.ref.toLowerCase().includes(wanted)),
  )
}

/** What the empty list says, which depends on why it is empty (frame `I44S1a`b). */
export function emptyList(counts: MemoryCounts, filtered: boolean): { title: string; body: string } {
  if (filtered || counts.pages > 0) {
    return { title: 'Nothing here', body: 'No page matches this search and these filters.' }
  }
  return {
    title: 'Nothing remembered yet',
    body:
      'Pages appear on their own when tickets close — the plan, review threads and failed tests become ' +
      'Decisions and Gotchas. Employees add more as they work.',
  }
}
