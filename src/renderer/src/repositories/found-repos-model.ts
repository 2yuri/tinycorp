import type { FoundKind, FoundRepo, FoundReposWalk } from '../../../shared/repos/found-repos'
import type { Repo, RepoInspection } from '../../../shared/repos/repo'

// `useFoundRepos` fills this shape from the engine; `knownFoundRepos` fills it from what it is given.

/** One checkout the walk found, as its row shows it. */
export interface FoundRow {
  path: string
  /** The checkout's own folder name. */
  name: string
  /** Where it sits below the picked folder: `payments/checkout-api`, or `core/` at the top. */
  where: string
  kind: FoundKind
  /** The group folder it belongs to; empty for a top-level row and for the picked folder itself. */
  group: string
  /** Whether it can be ticked: a repo of its own that this Company does not already have. */
  offered: boolean
  /** Already one of the Company's repos. */
  added: boolean
  /** Why it is not offered — `worktree of subscriptions · not offered` — or null when it is. */
  note: string | null
  /** The `origin` as it is shown, once the inspector has read the row; null until then. */
  remote: string | null
  /** The default branch, once the inspector has read the row; null until then. */
  branch: string | null
}

/** A group folder: everything the walk found below one folder of the picked one. */
export interface FoundGroup {
  /** Its folder name, which is what a row's `group` holds. */
  key: string
  /** `payments/`. */
  label: string
  rows: FoundRow[]
  /** The repos in it, which is the badge; worktrees and submodules are shown but never counted. */
  count: number
  offered: number
  selected: number
  /** What its checkbox shows. */
  checked: 'none' | 'some' | 'all'
  /** `2 of 67 selected`, `All 19 selected`, or empty when there is nothing in it to tick. */
  line: string
}

/** The picked folder's repos as the tree draws them. */
export interface FoundTree {
  /** The picked folder itself, when it is a checkout too: its own row, above everything. */
  self: FoundRow | null
  top: FoundRow[]
  groups: FoundGroup[]
}

/** What the header, the toolbar and the footer count. */
export interface FoundCounts {
  /** Repos, the picked folder included when it is one. */
  repos: number
  /** Worktrees and submodules: shown, never offered. */
  worktrees: number
  emptyFolders: number
  /** Repos this Company already has. */
  added: number
  /** Repos that can be ticked. */
  offered: number
  selected: number
}

/** Everything the picker draws, and everything it can do. */
export interface FoundRepos {
  /** The folder being walked, or null when none has been picked. */
  folder: string | null
  /** The walk is still running. */
  scanning: boolean
  /** Where the walk is, below the picked folder. */
  at: string
  /** How many checkouts it has found so far, streamed rows included. */
  total: number
  rows: FoundRow[]
  tree: FoundTree
  counts: FoundCounts
  /** The whole walk, once it has ended. */
  walk: FoundReposWalk | null
  error: string | null
  selected: ReadonlySet<string>
  /** The paths of the repos to add, in the order the tree shows them. */
  chosen: string[]
  filter: string
  setFilter(filter: string): void
  /** Ticks or unticks a row, or a whole group: the ones that are not on offer are left alone. */
  toggle(rows: readonly FoundRow[], on: boolean): void
  selectAll(): void
  clear(): void
  /** Stop: the walk keeps what it found. */
  stop(): void
  /** The rows the boss can see: they are the ones asked of the inspector, and first. */
  seen(paths: readonly string[]): void
}

/**
 * Every checkout the walk found, as rows. A worktree or a submodule is shown so the boss can see
 * why it is not on offer — adding one would attach the same history a second time — and a repo the
 * Company already has keeps its place, marked, so the tree matches the folder on disk.
 */
export function foundRows(
  found: readonly FoundRepo[],
  repos: readonly Repo[],
  inspections: Readonly<Record<string, RepoInspection | undefined>> = {},
): FoundRow[] {
  const already = new Set(repos.map((repo) => repo.path))
  return [...found]
    .sort((a, b) => a.relative.localeCompare(b.relative))
    .map((one) => {
      const added = already.has(one.path)
      const segments = one.relative === '' ? [] : one.relative.split('/')
      const inspection = inspections[one.path]
      return {
        path: one.path,
        name: segments.at(-1) ?? folderName(one.path),
        where: segments.length === 1 ? `${one.relative}/` : one.relative,
        kind: one.kind,
        group: segments.length > 1 ? segments[0]! : '',
        offered: one.kind === 'repo' && !added,
        added,
        note: one.kind === 'repo' ? null : `${one.kind} of ${one.parent ?? 'another repo'} · not offered`,
        remote: inspection?.remote ?? null,
        branch: inspection?.defaultBranch ?? null,
      }
    })
}

/**
 * The rows as a tree: the picked folder's own repo, the repos directly inside it, then one node per
 * group folder. A filter matches a row's name or its path, and a group whose rows all fail is gone.
 */
export function foundTree(rows: readonly FoundRow[], selected: ReadonlySet<string>, filter = ''): FoundTree {
  const wanted = matching(rows, filter)
  const groups = new Map<string, FoundRow[]>()
  for (const row of wanted) {
    if (row.group === '') continue
    const rows = groups.get(row.group) ?? []
    rows.push(row)
    groups.set(row.group, rows)
  }
  return {
    self: wanted.find((row) => row.where === '' && row.group === '') ?? null,
    top: wanted.filter((row) => row.group === '' && row.where !== ''),
    // Biggest folder first, as the frame draws it: it is the one worth opening, and the one that
    // would otherwise be scrolled past in a folder with a dozen of them.
    groups: [...groups]
      .map(([key, rows]) => group(key, rows, selected))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  }
}

function group(key: string, rows: FoundRow[], selected: ReadonlySet<string>): FoundGroup {
  const offered = rows.filter((row) => row.offered)
  const ticked = offered.filter((row) => selected.has(row.path)).length
  return {
    key,
    label: `${key}/`,
    rows,
    count: rows.filter((row) => row.kind === 'repo').length,
    offered: offered.length,
    selected: ticked,
    checked: ticked === 0 ? 'none' : ticked === offered.length ? 'all' : 'some',
    line:
      offered.length === 0
        ? ''
        : ticked === offered.length
          ? `All ${offered.length} selected`
          : `${ticked} of ${offered.length} selected`,
  }
}

/** Matches the checkout's name or its path below the picked folder, however it is typed. */
function matching(rows: readonly FoundRow[], filter: string): FoundRow[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter((row) => `${row.name} ${row.where}`.toLowerCase().includes(needle))
}

export function foundCounts(
  rows: readonly FoundRow[],
  walk: Pick<FoundReposWalk, 'emptyFolders'> | null,
  selected: ReadonlySet<string>,
): FoundCounts {
  const offered = rows.filter((row) => row.offered)
  return {
    repos: rows.filter((row) => row.kind === 'repo').length,
    worktrees: rows.filter((row) => row.kind !== 'repo').length,
    emptyFolders: walk?.emptyFolders ?? 0,
    added: rows.filter((row) => row.added).length,
    offered: offered.length,
    selected: offered.filter((row) => selected.has(row.path)).length,
  }
}

/** `110 repositories found in this folder · 6 worktrees and 1 empty folder skipped`. */
export function foundSummary(counts: FoundCounts): string {
  const skipped = [plural(counts.worktrees, 'worktree'), plural(counts.emptyFolders, 'empty folder')].filter(Boolean)
  const found = `${plural(counts.repos, 'repository', 'repositories') || 'No repositories'} found in this folder`
  return skipped.length === 0 ? found : `${found} · ${skipped.join(' and ')} skipped`
}

/** `Scanning… 84 found`, the line that stands in for the summary until the walk ends. */
export function scanningLine(total: number): string {
  return `Scanning… ${total} found`
}

/** `23 selected of 109 new`, or what there is to say when nothing is new. */
export function selectionLine(counts: FoundCounts): string {
  if (counts.offered === 0) {
    return counts.added > 0 ? 'Every repository here is already added' : ''
  }
  return `${counts.selected} selected of ${counts.offered} new`
}

/** `Add 23 repositories`. */
export function addLabel(selected: number): string {
  return selected === 0 ? 'Add repositories' : `Add ${plural(selected, 'repository', 'repositories')}`
}

/** `+ 4 more worktrees · 62 more repositories`, for the rows a collapsed group is not drawing. */
export function moreLine(hidden: readonly FoundRow[]): string {
  const worktrees = hidden.filter((row) => row.kind !== 'repo').length
  const repos = hidden.length - worktrees
  const parts = [plural(worktrees, 'more worktree'), plural(repos, 'more repository', 'more repositories')]
  return parts.filter(Boolean).join(' · ')
}

/** The rows a Select all ticks: every repo on offer, in or out of a group. */
export function everyOffered(rows: readonly FoundRow[]): Set<string> {
  return new Set(rows.filter((row) => row.offered).map((row) => row.path))
}

/** `selected` with every offered row of `rows` ticked, or none of them. */
export function withRows(selected: ReadonlySet<string>, rows: readonly FoundRow[], on: boolean): Set<string> {
  const next = new Set(selected)
  for (const row of rows) {
    if (!row.offered) continue
    if (on) next.add(row.path)
    else next.delete(row.path)
  }
  return next
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 0 ? '' : `${count.toLocaleString()} ${count === 1 ? one : many}`
}

function folderName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? path
  )
}

/**
 * A picker over checkouts that are already known, with nothing walked and nothing read: what a
 * capture harness and a test hand the picker in place of {@link useFoundRepos}. Everything it does
 * — ticking, filtering, Stop — is whatever the caller passes in `patch`.
 */
export function knownFoundRepos(
  folder: string,
  found: readonly FoundRepo[],
  repos: readonly Repo[],
  patch: Partial<FoundRepos> & { selected?: ReadonlySet<string>; inspections?: Record<string, RepoInspection> } = {},
): FoundRepos {
  const selected = patch.selected ?? new Set<string>()
  const rows = foundRows(found, repos, patch.inspections ?? {})
  const filter = patch.filter ?? ''
  return {
    folder,
    scanning: false,
    at: '',
    total: found.length,
    rows,
    tree: foundTree(rows, selected, filter),
    counts: foundCounts(rows, patch.walk ?? null, selected),
    walk: patch.walk ?? null,
    error: null,
    selected,
    chosen: rows.filter((row) => row.offered && selected.has(row.path)).map((row) => row.path),
    filter,
    setFilter: () => {},
    toggle: () => {},
    selectAll: () => {},
    clear: () => {},
    stop: () => {},
    seen: () => {},
    ...patch,
  }
}
