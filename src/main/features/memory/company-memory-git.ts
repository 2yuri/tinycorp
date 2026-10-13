import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { MemoryRevision } from '../../../shared/memory/company-memory'
import { isNetworkFolder } from '../../../shared/platform/company-folder'
import { createGitRunner, type GitRunner } from '../../platform'

/**
 * The Company memory's git repo (T175). The memory folder is a repo of its own, so every edit —
 * an Employee's `memory_write`, a capture, the boss's own — is a commit with its author, and
 * History and restore are git's, not a table the app has to keep.
 *
 * It is its own repo and never a work repo: `memory/` is already one of `COMPANY_DATA_PATTERNS`,
 * so nothing here can be committed to a repo an Employee opens a PR in.
 *
 * Every call goes through the app's one git runner — `core.longpaths` on Windows, where a Company
 * folder under `C:\Users\<name>\…` plus `memory/company/conventions/<a long slug>.md` runs past
 * git's 260-character default, and `safe.directory` for a folder inside a WSL distro, whose files
 * git for Windows sees as owned by a Linux uid and refuses as *dubious ownership* (T167, T256) —
 * and runs in the folder's native realpath, because git answers with the long name of a folder
 * whose short `RUNNER~1` form the app may be holding (T166).
 *
 * A Company folder **inside a distro** gets the distro's own git (T259): the wiki is a repo like any
 * other, and a repo is worked on by whichever git owns its filesystem. The runner decides that from
 * the folder, so nothing here has to know.
 *
 * The file arguments are the store's own POSIX keys (`decisions/x.md`). That is not a shortcut
 * around `node:path`: it is git's own path syntax, which is forward slashes on every platform.
 */
export interface MemoryGit {
  /** Makes the folder a repo if it is not one yet. Safe to call at every open. */
  init(folder: string): void
  /**
   * Commits the named files as `author`, and answers with the commit, or null when there was
   * nothing to commit. Paths are relative to the folder.
   */
  commit(folder: string, input: { files: string[]; message: string; author: string }): string | null
  /** The commits that touched one file, newest first. Empty where git cannot say. */
  history(folder: string, file: string, limit?: number): MemoryRevision[]
  /** One file as a commit left it, or null when that commit does not have it. */
  show(folder: string, commit: string, file: string): string | null
  /** Puts one file back to what `commit` had, as a new commit by `author`. */
  restore(folder: string, input: { commit: string; file: string; author: string }): string | null
}

/**
 * Git's own identity settings, forced on every commit: the Company writes these commits, not the
 * person at the keyboard, and the boss's `commit.gpgsign` would ask for a passphrase no app run
 * can answer.
 */
function identity(author: string): string[] {
  const name = author.trim() || 'the Company'
  const email = `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'company'
  }@tinycorp.local`
  return ['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=']
}

const BUFFER = 8 * 1024 * 1024

export interface MemoryGitOptions {
  /** The one git (T259). A memory wiki inside a distro is committed by the distro's own git. */
  git?: GitRunner
}

export function createMemoryGit({ git = createGitRunner() }: MemoryGitOptions = {}): MemoryGit {
  function run(folder: string, args: string[]): string | null {
    return git.tryText(truePath(folder), args, { maxBuffer: BUFFER })
  }

  return {
    init(folder) {
      if (existsSync(join(folder, '.git'))) return
      // A new Company has no memory folder yet: make it, or the repo is never made and no page
      // written after it is ever a commit.
      try {
        mkdirSync(folder, { recursive: true })
      } catch {
        return // a folder that cannot be made cannot hold a repo either; the pages say why on write
      }
      run(folder, ['init', '--initial-branch=main'])
    },

    commit(folder, { files, message, author }) {
      if (!existsSync(join(folder, '.git'))) return null
      // `--` so a slug that looks like a flag or a branch is still only ever a path.
      if (run(folder, ['add', '--all', '--', ...files]) === null) return null
      const staged = run(folder, ['diff', '--cached', '--name-only'])
      if (staged === null || staged.trim() === '') return null
      if (run(folder, [...identity(author), 'commit', '-m', message]) === null) return null
      return run(folder, ['rev-parse', 'HEAD'])?.trim() ?? null
    },

    history(folder, file, limit = 50) {
      const log = run(folder, ['log', `-${limit}`, '--format=%H%x1f%an%x1f%aI%x1f%s', '--follow', '--', file])
      if (!log) return []
      return log
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          const [commit, author, at, subject] = line.split('\x1f')
          return { commit: commit ?? '', author: author ?? '', at: at ?? '', subject: subject ?? '' }
        })
        .filter((revision): revision is MemoryRevision => revision.commit !== '')
    },

    show(folder, commit, file) {
      return run(folder, ['show', `${commit}:${file}`])
    },

    restore(folder, { commit, file, author }) {
      if (run(folder, ['checkout', commit, '--', file]) === null) return null
      return this.commit(folder, { files: [file], message: `Restore ${file} from ${commit.slice(0, 7)}`, author })
    },
  }
}

/** The one true path of a folder: the native realpath, the only one that expands `RUNNER~1`. */
function truePath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    // A share Windows cannot reach at this moment keeps its own spelling: `resolve` would read
    // `\\wsl.localhost\…` as a relative name and hand back a folder under the cwd (T256).
    return isNetworkFolder(path) ? path : resolve(path)
  }
}

/** A memory that keeps no history: the store works, History is empty and nothing throws. */
export function noMemoryGit(): MemoryGit {
  return {
    init: () => {},
    commit: () => null,
    history: () => [],
    show: () => null,
    restore: () => null,
  }
}
