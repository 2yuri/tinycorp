import { existsSync } from 'node:fs'
import { createGitRunner, type GitRunner } from '../../platform'

/**
 * The git a sub-session's own worktree needs (T163), kept apart from `GitService` the way restore
 * points are: nothing about PRs and forges has to know a sub-session exists. A sub-session's
 * branch is never pushed — what reaches a remote is still the parent's ticket branch.
 */
export interface SubSessionGit {
  /**
   * Checks out a new `branch` at `path`, starting at what the parent's worktree has committed now —
   * the parent's branch as it stands locally, never `origin`'s copy of it. Answers that commit.
   */
  add(request: { parentPath: string; path: string; branch: string }): { base: string }
  /** Whether `branch` is already a branch of the repo the parent's worktree belongs to. */
  hasBranch(parentPath: string, branch: string): boolean
  /**
   * What the worktree changed since `base`: the commits on top of it, whether anything is
   * uncommitted, and how many files the two touch together. Null when `path` is not a worktree.
   */
  changes(request: { path: string; base: string }): WorktreeChanges | null
  /**
   * Removes the worktree at `path`. Its branch stays when it holds commits `parentBranch` does not,
   * so nothing the sub-session committed is lost before the parent merges it; otherwise the branch
   * goes too. Answers whether the branch stayed. What is already gone is skipped.
   */
  remove(request: { parentPath: string; path: string; branch: string; parentBranch: string }): { branchKept: boolean }
}

export interface WorktreeChanges {
  commits: number
  dirty: boolean
  files: number
}

/** Whether a worktree changed anything at all. */
export function changedAnything(changes: WorktreeChanges | null): boolean {
  return changes !== null && (changes.commits > 0 || changes.dirty)
}

export function createSubSessionGit({ git = createGitRunner() }: { git?: GitRunner } = {}): SubSessionGit {
  // Every path git prints comes back in this process's spelling: what a worktree list answers is a
  // path the app compares against its own (T259).
  const run = (cwd: string, args: string[]): string => git.text(cwd, args, { mapPaths: true }).trim()
  const attempt = (cwd: string, args: string[]): string | null =>
    git.tryText(cwd, args, { mapPaths: true })?.trim() ?? null
  const lines = (text: string | null) => (text ? text.split('\n').filter(Boolean) : [])

  return {
    add({ parentPath, path, branch }) {
      const base = run(parentPath, ['rev-parse', 'HEAD'])
      run(parentPath, ['worktree', 'add', '-b', branch, path, base])
      return { base }
    },

    hasBranch(parentPath, branch) {
      return attempt(parentPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null
    },

    changes({ path, base }) {
      if (!existsSync(path) || attempt(path, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null
      const commits = Number(attempt(path, ['rev-list', '--count', `${base}..HEAD`]) ?? 0)
      const status = lines(attempt(path, ['status', '--porcelain', '--untracked-files=all']))
      const files = new Set([
        ...lines(attempt(path, ['diff', '--name-only', base])),
        ...status.filter((line) => line.startsWith('??')).map((line) => line.slice(3)),
      ])
      return { commits, dirty: status.length > 0, files: files.size }
    },

    remove({ parentPath, path, branch, parentBranch }) {
      if (existsSync(path)) attempt(parentPath, ['worktree', 'remove', '--force', path])
      attempt(parentPath, ['worktree', 'prune'])
      const exists = attempt(parentPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null
      if (!exists) return { branchKept: false }
      const ahead = Number(attempt(parentPath, ['rev-list', '--count', `${parentBranch}..${branch}`]) ?? 1)
      if (ahead > 0) return { branchKept: true }
      attempt(parentPath, ['branch', '-D', branch])
      return { branchKept: false }
    },
  }
}
