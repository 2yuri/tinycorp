import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createGitRunner, type GitRunner } from '../../platform'

/** What a ticket worktree is at right now. */
export interface WorktreeState {
  /** The commit HEAD points at. */
  commit: string
  /** That commit's subject line. */
  subject: string
  branch: string
  /** Whether anything is uncommitted: staged, unstaged or untracked. */
  dirty: boolean
}

/**
 * Where one restore point's uncommitted work is kept, relative to the Company's restore-point
 * folder. Empty when the worktree was clean.
 */
export interface CapturedWork {
  /** HEAD → the index: what was staged. Null when nothing was. */
  indexPatch: string | null
  /** The index → the working tree: what was not staged. Null when nothing was. */
  treePatch: string | null
  /** A copy of the untracked files, by folder name. Null when there were none. */
  untracked: string | null
}

export interface CaptureRequest {
  /** The worktree to read. */
  path: string
  /** The Company's restore-point folder; everything captured is written inside it. */
  folder: string
  /** The restore point's id, which names the files. */
  id: string
}

export interface RestoreRequest extends CaptureRequest {
  /** The commit to put the worktree back at. */
  commit: string
  work: CapturedWork
}

/**
 * The git a restore point needs, kept apart from `GitService` so nothing about worktrees and PRs
 * has to know about it.
 */
export interface RestoreGit {
  /** What the worktree is at, or null when `path` is not a git worktree. */
  state(path: string): WorktreeState | null
  /** Only the commit HEAD points at: one command, cheap enough to ask after every hook. */
  commitAt(path: string): string | null
  /** Writes the worktree's uncommitted work under `folder`, named after the restore point's id. */
  capture(request: CaptureRequest): CapturedWork
  /**
   * Puts the worktree back at `commit` with the captured work re-applied: the tree, the index and
   * the untracked files as they were. Rewrites no commit — the branch ref moves, the commits stay.
   */
  restore(request: RestoreRequest): void
  /** The subjects of the commits the worktree has on top of `commit`, newest first. */
  commitsSince(path: string, commit: string): string[]
  /** Forgets one restore point's captured work. What is already gone is skipped. */
  forget(request: { folder: string; work: CapturedWork }): void
}

export interface RestoreGitOptions {
  /** The one git (T259): a worktree inside a distro is read by the distro's own git. */
  git?: GitRunner
}

/** Restore points over the `git` command line. */
export function createRestoreGit({ git = createGitRunner() }: RestoreGitOptions = {}): RestoreGit {
  const run = (cwd: string, args: string[]): string => git.text(cwd, args, { maxBuffer: BUFFER })
  const tryRun = (cwd: string, args: string[]): string | null => git.tryText(cwd, args, { maxBuffer: BUFFER })

  /** The untracked files git would not ignore, as paths relative to the worktree. */
  function untrackedFiles(path: string): string[] {
    const listed = run(path, ['ls-files', '--others', '--exclude-standard', '-z'])
    return listed.split('\0').filter(Boolean)
  }

  return {
    commitAt(path) {
      if (!existsSync(path)) return null
      return tryRun(path, ['rev-parse', 'HEAD'])?.trim() || null
    },

    state(path) {
      if (!existsSync(path)) return null
      const commit = tryRun(path, ['rev-parse', 'HEAD'])?.trim()
      if (!commit) return null
      return {
        commit,
        subject: tryRun(path, ['log', '-1', '--format=%s'])?.trim() ?? '',
        branch: tryRun(path, ['branch', '--show-current'])?.trim() ?? '',
        dirty: (tryRun(path, ['status', '--porcelain'])?.trim() ?? '') !== '',
      }
    },

    capture({ path, folder, id }) {
      const indexPatch = run(path, ['diff', '--cached', '--binary'])
      const treePatch = run(path, ['diff', '--binary'])
      const untracked = untrackedFiles(path)
      const work: CapturedWork = {
        indexPatch: indexPatch === '' ? null : `${id}.index.patch`,
        treePatch: treePatch === '' ? null : `${id}.tree.patch`,
        untracked: untracked.length === 0 ? null : `${id}.untracked`,
      }
      mkdirSync(folder, { recursive: true })
      if (work.indexPatch) writeFileSync(join(folder, work.indexPatch), indexPatch)
      if (work.treePatch) writeFileSync(join(folder, work.treePatch), treePatch)
      for (const file of untracked) {
        const target = join(folder, work.untracked!, file)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(join(path, file), target)
        chmodSync(target, statSync(join(path, file)).mode & 0o777)
      }
      return work
    },

    restore({ path, folder, commit, work }) {
      // Everything the point kept is read before anything is thrown away: a patch that went
      // missing must not cost the boss the work that is there now.
      for (const name of [work.indexPatch, work.treePatch, work.untracked]) {
        if (name && !existsSync(join(folder, name))) {
          throw new Error(`The uncommitted work this restore point kept is gone: ${name}`)
        }
      }
      // Nothing here rewrites a commit: the branch ref moves and every commit stays reachable
      // through the worktree's reflog.
      run(path, ['reset', '--hard', commit])
      run(path, ['clean', '-fd'])
      // The index patch goes to both the index and the tree, which are equal at this point; the
      // tree patch then takes the tree the rest of the way and leaves the index alone.
      if (work.indexPatch) apply(path, join(folder, work.indexPatch), ['--index'])
      if (work.treePatch) apply(path, join(folder, work.treePatch), [])
      if (work.untracked) copyTree(join(folder, work.untracked), path)
    },

    commitsSince(path, commit) {
      const log = tryRun(path, ['log', '--format=%s', `${commit}..HEAD`])
      return (log ?? '').split('\n').filter(Boolean)
    },

    forget({ folder, work }) {
      for (const name of [work.indexPatch, work.treePatch, work.untracked]) {
        if (name) rmSync(join(folder, name), { recursive: true, force: true })
      }
    },
  }

  function apply(path: string, patch: string, extra: string[]): void {
    if (!existsSync(patch)) throw new Error(`The restore point's ${patch} is gone`)
    try {
      git.text(path, ['apply', '--binary', ...extra, patch], { maxBuffer: BUFFER })
    } catch (error) {
      throw new Error(`Could not put back the uncommitted work: ${failure(error)}`)
    }
  }
}

/** Copies every file under `from` into `into`, keeping the tree and each file's mode. */
function copyTree(from: string, into: string): void {
  if (!existsSync(from)) return
  for (const file of filesUnder(from)) {
    const target = join(into, file)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(from, file), target)
    chmodSync(target, statSync(join(from, file)).mode & 0o777)
  }
}

function filesUnder(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(root, join(prefix, entry.name)) : [join(prefix, entry.name)],
  )
}

/** A patch of a whole worktree is far larger than a command's default 1MB buffer. */
const BUFFER = 64 * 1024 * 1024

/** A failed command's stderr, else its message. */
function failure(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : ''
  return text.trim() || (error instanceof Error ? error.message : String(error))
}
