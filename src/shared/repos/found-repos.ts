/**
 * What picking a folder of repos finds (T168). A boss keeps dozens of checkouts in nested folders;
 * the walk reads them all, streams them out as it goes, and offers the ones that can be added.
 */

/** What a checkout found by the walk is. Only a `repo` can be added. */
export type FoundKind =
  /** A checkout of its own: a `.git` folder. */
  | 'repo'
  /** A `git worktree` checkout: a `.git` file pointing into `…/worktrees/…`. Shown, never offered. */
  | 'worktree'
  /** A submodule: a `.git` file pointing into `…/modules/…`. Shown under its parent, never offered. */
  | 'submodule'

/** One checkout the walk found, before anything asked git about it. */
export interface FoundRepo {
  /** Absolute path of the checkout. */
  path: string
  /** Its path below the picked folder, with `/` separators; empty when it *is* the picked folder. */
  relative: string
  kind: FoundKind
  /** For a worktree or a submodule, the repo it belongs to, as its folder name; else null. */
  parent: string | null
}

/** Why the walk stopped. */
export type WalkStop =
  /** It read everything within its depth. */
  | 'done'
  /** Stop, or the modal closing. */
  | 'cancelled'
  /** It ran past its time box and reported what it had. */
  | 'timed-out'

/** What a whole walk found. */
export interface FoundReposWalk {
  /** The picked folder, absolute. */
  folder: string
  found: FoundRepo[]
  stopped: WalkStop
  /** Folders directly below the picked one that hold no checkout at all. */
  emptyFolders: number
}

/**
 * One push from a running walk. Events of a walk that is no longer the current one are ignored by
 * their `scan` id, so a walk cancelled by a change of folder cannot write over its replacement.
 */
export interface FoundReposEvent {
  /** The walk this came from. */
  scan: string
  /** The checkouts found since the last event, in the order the walk found them. */
  found: FoundRepo[]
  /** How many have been found so far, all events counted. */
  total: number
  /** The folder the walk is reading, below the picked one; empty once it has ended. */
  at: string
  /** The whole walk, once it has ended; null while it runs. */
  walk: FoundReposWalk | null
  /** Why the walk could not run at all; null otherwise. */
  error: string | null
}

/** How far below the picked folder the walk looks. */
export const WALK_DEPTH = 5

/** About how long a walk may run before it reports what it has and says it stopped. */
export const WALK_BUDGET_MS = 15_000

/** How many checkouts the inspector reads at once, so 110 repos never fork 330 gits. */
export const INSPECT_CAP = 5

/**
 * The folder whose repos are offered without being asked for: the one beside the Company's first
 * repo, or the Company's own folder while it has none. The setup wizard and `nearbyRepos` both read
 * it from here, so the wizard's tree and the engine's answer are never about different folders.
 */
export function folderOfInterest(companyFolder: string, firstRepoPath: string | null): string {
  if (!firstRepoPath) return companyFolder
  const parent = firstRepoPath.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')
  return parent || companyFolder
}
