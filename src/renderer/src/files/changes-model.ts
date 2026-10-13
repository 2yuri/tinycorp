import {
  type ChangedFile,
  type ChangeGroup,
  type ChangeMark,
  isStaged,
  markOf,
  stagedCount,
} from '../../../shared/files/file-changes'
import { nameOf } from './files-model'

/** Which half of the Files sidebar is showing: the tree, or what git says changed (T160). */
export type SidebarTab = 'files' | 'changes'

/** One row of a group: a changed file, and what can be done to it. */
export interface ChangeRow {
  path: string
  /** `usage-chart.tsx` — the name alone, as the design draws it. */
  name: string
  /** `src/renderer` — the folder it is in, or empty at the root of the place. */
  dir: string
  mark: ChangeMark
  /** True when any of it is in the index, so Commit would take it. */
  staged: boolean
  /** True when git is mid-merge on it: it is neither staged nor discarded from here. */
  conflicted: boolean
  /** Where a rename came from, for what the discard question names. */
  previousPath: string | null
}

export function changeRows(files: readonly ChangedFile[]): ChangeRow[] {
  return files.map((file) => ({
    path: file.path,
    name: nameOf(file.path),
    dir: file.path.slice(0, Math.max(file.path.lastIndexOf('/'), 0)),
    mark: markOf(file),
    staged: isStaged(file),
    conflicted: file.conflicted,
    previousPath: file.previousPath,
  }))
}

/** How many of a group's files the next commit in it would carry. */
export function groupStaged(group: ChangeGroup): number {
  return stagedCount(group.changes.files)
}

/**
 * Which change the diff pane is showing: the place it is in and the path in it. A place that
 * stops having that file — it was committed, or discarded — drops the choice rather than showing
 * a diff of nothing.
 */
export interface ChangePick {
  placeId: string
  path: string
}

/** The pick again, or null when the groups no longer hold it. */
export function stillThere(pick: ChangePick | null, groups: readonly ChangeGroup[]): ChangePick | null {
  if (pick === null) return null
  const group = groups.find((one) => one.place.id === pick.placeId)
  return group?.changes.files.some((file) => file.path === pick.path) ? pick : null
}

/** Every group open, minus the ones the boss folded away. */
export function isOpen(collapsed: ReadonlySet<string>, placeId: string): boolean {
  return !collapsed.has(placeId)
}

export function toggleGroup(collapsed: ReadonlySet<string>, placeId: string): Set<string> {
  const next = new Set(collapsed)
  if (next.has(placeId)) next.delete(placeId)
  else next.add(placeId)
  return next
}

/** `⌘↵` in the commit box, which is how the design says a commit is sent. */
export function isCommitKey(event: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}
