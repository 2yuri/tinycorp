/**
 * The Changes tab of the Files view (T160): what `git status` says, per place, and the actions the
 * boss takes on it — stage, unstage, discard, commit, push.
 *
 * In TinyCorp there is no such thing as *the* working tree: a ticket gets a worktree per repo and
 * an Employee holds it, so a change is always somebody's, for something. The grouping is not
 * invented here — it *is* the `FilePlace` the change is in. The words are the design's
 * (`design/screens/LFdty.png`).
 */

import { shortcut } from '../app/shortcuts'
import type { DiffFile, FileSides } from '../review/review-diff'
import type { FilePlace } from './files'

/** What git says happened to a path, on one side of the index. */
export type ChangeMark = 'added' | 'modified' | 'removed' | 'renamed'

/** The letter a changed file carries at the end of its row. */
export const CHANGE_MARKS: Record<ChangeMark, string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
}

/** One changed file of one place, with the index and the working tree kept apart. */
export interface ChangedFile {
  /** Relative to the place's root, `/`-separated. Where a rename ended up. */
  path: string
  /** Where a renamed file came from; null otherwise. */
  previousPath: string | null
  /** What the index holds against HEAD; null when nothing of this file is staged. */
  staged: ChangeMark | null
  /** What the working tree holds against the index; null when the tree matches the index. */
  unstaged: ChangeMark | null
  /** True while git reports the file in conflict: it is neither staged nor discarded from here. */
  conflicted: boolean
}

/** One place's `git status`, as the Changes tab reads it. */
export interface PlaceChanges {
  placeId: string
  files: ChangedFile[]
  /** The branch the place is on right now, which the repo's own `FilePlace` does not carry. */
  branch: string
  /** Commits the branch has that its upstream does not; 0 when it has no upstream. */
  ahead: number
  /** Whether the branch has an upstream at all: without one, Push publishes it. */
  upstream: boolean
  /** True when the place has more changed files than the reader lists. */
  truncated: boolean
}

/** A place with nothing changed in it is not a group; it is simply not there. */
export interface ChangeGroup {
  place: FilePlace
  /** `Ada Lorne` for a worktree its holder is known for, else the repo's own name. */
  name: string
  /** `TC-142`; null for the Company's own repo. */
  ticketKey: string | null
  /** `web-app · ticket-tc-142-usage-chart`, the mono line under the name. */
  where: string
  changes: PlaceChanges
}

/** The one mark a row shows: what the tree has, else what the index does. */
export function markOf(file: ChangedFile): ChangeMark {
  return file.unstaged ?? file.staged ?? 'modified'
}

/** Whether any of this file is in the index — what Commit would take. */
export function isStaged(file: ChangedFile): boolean {
  return file.staged !== null
}

/** How many of a place's files the next commit would carry. */
export function stagedCount(files: readonly ChangedFile[]): number {
  return files.filter(isStaged).length
}

/**
 * The groups the Changes tab draws, in the order the Files view lists its places — an Employee's
 * worktree first, the Company's own repos last. A place with nothing changed is left out, and so
 * is one whose folder has gone: a worktree that was removed is not an error.
 */
export function changeGroups(places: readonly FilePlace[], changes: readonly PlaceChanges[]): ChangeGroup[] {
  return places.flatMap((place): ChangeGroup[] => {
    const found = changes.find((one) => one.placeId === place.id)
    if (!found || found.files.length === 0) return []
    const branch = found.branch || place.branch || ''
    return [
      {
        place,
        name: place.ticketId === null ? place.repoName : (place.holderName ?? place.repoName),
        ticketKey: place.ticketKey,
        where: [place.repoName, branch].filter(Boolean).join(' · '),
        changes: found,
      },
    ]
  })
}

/** The count on the tab: changed **files** across every place, so it matches the rows below it. */
export function changedCount(groups: readonly ChangeGroup[]): number {
  return groups.reduce((total, group) => total + group.changes.files.length, 0)
}

/** What the commit box says it would take: `Commit 2 staged`. */
export function commitLabel(staged: number): string {
  return `Commit ${staged} staged`
}

/** The commit box's own placeholder, as the design writes it, in the platform's keys (T166). */
export function commitPlaceholder(platform: string): string {
  return `Message (${shortcut(platform, '↵')} to commit)`
}

/** What Push says: the branch, and whether it has ever been published. */
export function pushLabel(changes: Pick<PlaceChanges, 'ahead' | 'upstream'>): string {
  if (!changes.upstream) return 'Publish'
  return changes.ahead === 0 ? 'Push' : `Push ${changes.ahead}`
}

/**
 * Whether a place has anything for its commit box to do. Nothing staged and nothing to push means
 * no box at all: the design draws one only under the group that has something waiting.
 */
export function hasCommitBox(changes: PlaceChanges): boolean {
  return stagedCount(changes.files) > 0 || changes.ahead > 0 || !changes.upstream
}

/**
 * One changed file as the diff pane reads it (T243): the row the head draws, and the two sides
 * Monaco is given. The hunks are gone — the editor works the diff out itself.
 */
export interface ChangedFileDiff {
  file: DiffFile
  sides: FileSides
}

/** The foot under a diff of a worktree, where a comment reaches whoever holds the ticket. */
export const CHANGES_FOOTER = 'Read only. Comment on a line to send it to whoever holds the ticket.'

/** The foot for the Company's own repo, which has no ticket and so nobody to comment to. */
export const CHANGES_FOOTER_REPO = 'Read only. This is the Company’s own repo: there is no ticket to comment on.'

/** What the Changes tab says when the whole Company is clean. */
export const NOTHING_CHANGED = 'Nothing changed yet'

/** What the diff pane says with no changed file picked. */
export const NO_CHANGE_PICKED = 'Pick a changed file to read its diff.'

/** What stands where the path goes while nothing is picked, as `No file open` does for the tree. */
export const NO_CHANGE_OPEN = 'No change open'

/** What a file with no diff to show says instead of one. */
export function noDiffReason(file: { binary: boolean }): string {
  return file.binary
    ? 'This file is binary; there is nothing to show.'
    : 'Git has no text for this change; there is nothing to show.'
}

/** A conflicted file is not staged or discarded from here: git is mid-merge and says so. */
export const CONFLICTED_NOTE = 'In conflict — resolve it in the worktree before staging it.'

/**
 * What the boss is asked before a discard, which is the only action here that loses uncommitted
 * work. It names the files, because a discard cannot be read back off a list of one count.
 */
export function discardQuestion(paths: readonly string[]): string {
  if (paths.length === 1) return `Discard the changes in ${paths[0]}?`
  return `Discard the changes in ${paths.length} files?`
}

/** What a discard costs, said differently where a restore point can undo it and where it cannot. */
export function discardWarning(restorable: boolean): string {
  return restorable
    ? 'The uncommitted work in it goes. A restore point is taken first, so this ticket can be put back.'
    : 'The uncommitted work in it goes, and this place keeps no restore points: nothing can bring it back.'
}
