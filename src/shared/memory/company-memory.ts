/**
 * The Company memory (T175): a markdown wiki in the Company folder that every Employee reads and
 * writes through MCP, on any Provider, and that the boss reads and edits in the Memory screen.
 *
 * The files are the source of truth. Everything here is a view over them — the index, the counts,
 * the cold mark, the contradictions — and nothing in it is written by a model.
 */

/** What a page is. The kind is a folder under `memory/company/`, so it is also where the file lives. */
export const MEMORY_KINDS = ['decision', 'convention', 'gotcha', 'architecture', 'glossary', 'handoff'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  decision: 'Decision',
  convention: 'Convention',
  gotcha: 'Gotcha',
  architecture: 'Architecture',
  glossary: 'Glossary',
  handoff: 'Handoff',
}

/** The filter chips over the list, in the frame's order and plural, e.g. `Decisions 11`. */
export const MEMORY_KIND_PLURAL: Record<MemoryKind, string> = {
  decision: 'Decisions',
  convention: 'Conventions',
  gotcha: 'Gotchas',
  architecture: 'Architecture',
  glossary: 'Glossary',
  handoff: 'Handoffs',
}

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)
}

/**
 * Where a page came from, as one string so the front matter stays scalars and lists of scalars:
 * `ticket:TC-142`, `pr:billing-api#88`, `review:TC-142 thread 7`, `commit:9f2c1ab`, `test:pnpm test`.
 */
export type MemorySourceKind = 'ticket' | 'pr' | 'review' | 'commit' | 'test' | 'note'

export interface MemorySource {
  kind: MemorySourceKind
  /** What follows the colon, as written. */
  ref: string
}

const SOURCE_KINDS: MemorySourceKind[] = ['ticket', 'pr', 'review', 'commit', 'test', 'note']

/** `ticket:TC-142` → `{ kind: 'ticket', ref: 'TC-142' }`; anything else is a `note`. */
export function parseSource(value: string): MemorySource {
  const at = value.indexOf(':')
  const head = at === -1 ? '' : value.slice(0, at)
  if (at === -1 || !SOURCE_KINDS.includes(head as MemorySourceKind)) return { kind: 'note', ref: value.trim() }
  return { kind: head as MemorySourceKind, ref: value.slice(at + 1).trim() }
}

export function formatSource(source: MemorySource): string {
  return `${source.kind}:${source.ref}`
}

/** How a source reads on the page's front-matter row. */
export function sourceLabel(source: MemorySource): string {
  if (source.kind === 'pr') return `PR ${source.ref.startsWith('#') ? source.ref : `#${source.ref}`}`
  if (source.kind === 'review') return 'review thread'
  if (source.kind === 'commit') return source.ref.slice(0, 7)
  if (source.kind === 'test') return `test ${source.ref}`
  return source.ref
}

/** Where a Handoff stands (frame `I44S1a`a). A page that is not a Handoff has none. */
export type HandoffState = 'open' | 'claimed' | 'done'

export const HANDOFF_STATE_LABEL: Record<HandoffState, string> = {
  open: 'open',
  claimed: 'claimed',
  done: 'done',
}

/** One page of the Company memory, as the index holds it and the screen draws it. */
export interface MemoryPage {
  /** The file name without `.md`; unique within its kind, and how every tool names the page. */
  slug: string
  kind: MemoryKind
  title: string
  /** Repo ids or names the page is about; empty when it is about none. */
  repos: string[]
  sources: MemorySource[]
  /** Slugs of the pages this one links to. */
  links: string[]
  /** The markdown under the front matter, as written. */
  body: string
  /** Who wrote it last — an Employee's name or the boss's. */
  updatedBy: string
  createdAt: string
  updatedAt: string
  pinned: boolean
  archived: boolean
  /** A Handoff's state and who claimed it; null on every other kind. */
  handoff: { state: HandoffState; claimedBy: string | null; claimedAt: string | null } | null
}

/** A page as a row of the list: everything but its body. */
export interface MemoryPageSummary extends Omit<MemoryPage, 'body'> {
  /** When the page was last read, searched or written; null when nothing has used it yet. */
  lastUsedAt: string | null
  /** How many uses it had in the last seven days, as the `used N times this week` chip counts. */
  usesThisWeek: number
  /** True when nothing has used it for the Company's cold threshold. */
  cold: boolean
  /** Set when the heuristic pairs it with another page; the banner names that one. */
  contradiction: MemoryContradiction | null
}

/**
 * Two pages the term heuristic disagrees on. It is terms, never a model: the same key written with
 * two different values, on two pages of the same kind that share a repo.
 */
export interface MemoryContradiction {
  /** The other page. */
  slug: string
  title: string
  /** The key both pages write, e.g. `DEFAULT_CURRENCY`. */
  term: string
  /** What each says it is, this page first. */
  values: [string, string]
}

/** How the boss explains the banner; the UI shows it so nobody takes it for a judgement. */
export const CONTRADICTION_EXPLANATION = 'Found by overlapping terms, not by a model — you decide.'

/** The list's sort, as the frame's three buttons name it. */
export const MEMORY_SORTS = ['used', 'new', 'cold'] as const
export type MemorySort = (typeof MEMORY_SORTS)[number]

export const MEMORY_SORT_LABEL: Record<MemorySort, string> = {
  used: 'Recently used',
  new: 'New',
  cold: 'Cold',
}

/** What the boss asks the list for. */
export interface MemoryQuery {
  /** Full text over titles and bodies; empty matches everything. */
  search?: string
  kind?: MemoryKind
  repo?: string
  sort?: MemorySort
  /** Archived pages are left out unless this is true. */
  archived?: boolean
  limit?: number
}

/** The footer's counts: `42 pages · 2 cold · 2 possible contradictions`. */
export interface MemoryCounts {
  /** Live pages, archived ones left out. */
  pages: number
  /** How many pages each kind holds, for the filter chips. */
  byKind: Record<MemoryKind, number>
  cold: number
  contradictions: number
  archived: number
}

export function emptyCounts(): MemoryCounts {
  return {
    pages: 0,
    byKind: { decision: 0, convention: 0, gotcha: 0, architecture: 0, glossary: 0, handoff: 0 },
    cold: 0,
    contradictions: 0,
    archived: 0,
  }
}

/** Where the pages are, as the footer names the place: the folder under the Company's own. */
export const MEMORY_FOLDER_NAME = 'memory/company'

/**
 * `42 pages · 2 cold · 2 possible contradictions`, leaving out what is zero.
 *
 * A Company that has written nothing yet says so with the folder, as frame `SlxSy` does: `0 pages`
 * on its own reads as a count that failed, and the boss's next question is where the pages would
 * be if there were any.
 */
export function countsLine(counts: MemoryCounts): string {
  if (counts.pages === 0 && counts.archived === 0) {
    return `0 pages · ${MEMORY_FOLDER_NAME} is an empty git repo`
  }
  const parts = [`${counts.pages} ${counts.pages === 1 ? 'page' : 'pages'}`]
  if (counts.cold > 0) parts.push(`${counts.cold} cold`)
  if (counts.contradictions > 0) {
    parts.push(`${counts.contradictions} possible contradiction${counts.contradictions === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

/** One commit of a page's file, as History lists it. */
export interface MemoryRevision {
  commit: string
  /** Who git says wrote it. */
  author: string
  at: string
  subject: string
}

/** How long a page may go unused before it is marked cold, in days. */
export const DEFAULT_COLD_DAYS = 30

/** How many pages a Session's bounded brief names, most used and pinned first. */
export const BRIEF_PAGES = 12

/** The longest a page's body may be, so no single page can fill a Session's context. */
export const MEMORY_PAGE_MAX_CHARS = 16_000

/**
 * The slug a title gets: lowercase, words joined by `-`, nothing else. Empty titles are refused by
 * the store, so this never has to answer for one.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * The folder a kind's pages sit in: `decisions`, `gotchas`, `architecture`, `glossary`.
 *
 * The store writes the files there and the path bar names it, so both read it from here. Adding an
 * `s` to the kind was close enough for four of the six and wrote `architectures` for the other two.
 */
export function memoryKindFolder(kind: MemoryKind): string {
  return MEMORY_KIND_PLURAL[kind].toLowerCase()
}

/** `memory / decisions / locale-handling-in-billing.md`, as the path bar writes it. */
export function pagePath(page: Pick<MemoryPage, 'kind' | 'slug' | 'archived'>): string {
  const folder = page.archived ? 'archive' : memoryKindFolder(page.kind)
  return `memory / ${folder} / ${page.slug}.md`
}

/** `12m ago`, `3h ago`, `yesterday`, `2d ago`, `41d ago` — what a row's right-hand column says. */
export function whenLabel(at: string | null, now: number): string {
  if (!at) return 'never used'
  const minutes = Math.floor((now - Date.parse(at)) / 60_000)
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

/** The row's second line: `from TC-142 review`, `by Orion`, `claimed by Vega on Codex`. */
export function rowSource(page: MemoryPageSummary): string {
  if (page.kind === 'handoff') {
    // State first: a Handoff that closed with its ticket says so, whoever had claimed it.
    if (page.handoff?.state === 'done') return 'closed with the ticket'
    if (page.handoff?.claimedBy) return `claimed by ${page.handoff.claimedBy}`
    return 'waiting for a desk'
  }
  const ticket = page.sources.find((source) => source.kind === 'ticket')
  const review = page.sources.some((source) => source.kind === 'review')
  const test = page.sources.some((source) => source.kind === 'test' || source.kind === 'commit')
  if (ticket) return `from ${ticket.ref}${review ? ' review' : test ? ' test failure' : ' plan'}`
  return `by ${page.updatedBy}`
}

/** `used 14 times this week`, or null when nothing read it this week. */
export function usesChip(page: Pick<MemoryPageSummary, 'usesThisWeek'>): string | null {
  if (page.usesThisWeek <= 0) return null
  return `used ${page.usesThisWeek} time${page.usesThisWeek === 1 ? '' : 's'} this week`
}

/** What `memory_write` takes, and what the boss's editor saves. */
export interface MemoryWrite {
  kind: MemoryKind
  title: string
  body: string
  sources?: string[]
  repos?: string[]
  /** `append` adds the body under the existing one instead of replacing it. */
  mode?: 'replace' | 'append'
}

/** What a capture wrote for one ticket, for the single Activity line it earns. */
export interface MemoryCaptureResult {
  /** `TC-142`. */
  ticket: string
  /** The pages it created or appended to, in the order it wrote them. */
  pages: { slug: string; title: string; kind: MemoryKind; created: boolean }[]
  /** Where each page came from, in the words the Activity line uses. */
  from: string[]
}

/** `3 pages updated from TC-142`, the one line a closed ticket earns (frame `I44S1a`c). */
export function captureSummary(result: MemoryCaptureResult): string {
  const n = result.pages.length
  return `${n} page${n === 1 ? '' : 's'} updated from ${result.ticket}`
}

/** `from the plan, review threads and testing`, the quieter second line. */
export function captureDetail(result: MemoryCaptureResult): string | null {
  if (result.from.length === 0) return null
  const list =
    result.from.length === 1
      ? result.from[0]!
      : `${result.from.slice(0, -1).join(', ')} and ${result.from[result.from.length - 1]}`
  return `from ${list}`
}
