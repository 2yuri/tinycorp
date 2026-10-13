import type { ProviderRuntime } from '../../shared/platform/wsl'
import { createRunners, type ProcessRunner, type Runners } from './run-in'
import { wslUncDistro } from './wsl-path'

/**
 * The one git in the app (T259).
 *
 * Before this there were eleven: `git-service.ts` and ten feature modules, each with its own
 * `execFileSync('git', …)` and its own `git?: string` option. On a Mac that is eleven copies of the
 * same three lines. On a Windows where the boss chose WSL it is eleven separate answers to a
 * question with one right answer — *which git owns this repo* — and every wrong one is a broken
 * worktree:
 *
 * - `git worktree add` writes an **absolute** `gitdir:` into the new worktree and an absolute
 *   `worktree` line into the repo. A repo whose links were written by `C:\…\git.exe` cannot be
 *   followed by the distro's git, and the other way round.
 * - A repo inside the distro, asked from Windows over `\\wsl.localhost\…`, is a repo every file of
 *   which is owned by a Linux uid: git refuses the lot with *detected dubious ownership* unless it
 *   is told to trust that one path. Asked by the distro's own git, it is simply the owner, and the
 *   whole workaround goes away — which is why {@link GitRunner.settings} answers differently per
 *   runtime rather than always adding `safe.directory`.
 *
 * So a repo is **all-Windows or all-distro**, decided by where the repo is (`runtimeForPath`), and
 * this is where that decision is made once. Every caller hands it a folder and gets the right git.
 *
 * On a Mac, on a Linux desktop, and on a Windows whose team runs on Windows, `runtimeForPath`
 * answers *this machine* for every path there is, and a call through here is the `execFileSync` it
 * always was with `core.longpaths` in front of it.
 */
export interface GitRunner {
  /** git in `cwd`; throws with git's own stderr in the message. */
  text(cwd: string, args: readonly string[], options?: GitCall): string
  /** The same, answering null where git exited non-zero — a ref that is not there, not an error. */
  tryText(cwd: string, args: readonly string[], options?: GitCall): string | null
  /** git in `cwd`, asynchronously, for the calls whose output is a patch or a whole file. */
  output(cwd: string, args: readonly string[], options?: GitCall): Promise<string>
  /**
   * The `-c` settings every call in this folder carries, for a caller that builds its own argv in
   * front of them — a commit that needs an identity, a merge that must not sign.
   */
  settings(cwd: string): string[]
  /** Where git runs for this folder. What the PR has to be able to say, and what a test reads. */
  runtimeFor(cwd: string): ProviderRuntime
  /** A path git printed for this folder, in the spelling this process and the database use. */
  toHost(cwd: string, path: string): string
}

export interface GitCall {
  maxBuffer?: number
  /** Laid over the app's own environment, as `repo-init` does for a missing git identity. */
  env?: NodeJS.ProcessEnv
  /**
   * Whether the paths in git's answer are translated back to this process's spelling. Set it where
   * the **whole** answer is paths — `rev-parse --show-toplevel`, `--git-path`, `worktree list
   * --porcelain` — and never where it is a patch or a file, whose body is somebody's source code.
   */
  mapPaths?: boolean
}

/**
 * `core.longpaths` is Windows: a Company folder under `C:\Users\<name>\…` plus a worktree named
 * after a ticket runs past the 260-character limit git keeps to by default, and `worktree add` then
 * fails with `Filename too long` on a path the boss chose in the app. It is set per command rather
 * than written into the boss's config, because it is ours to need, not theirs to keep (T166).
 */
const LONG_PATHS = ['-c', 'core.longpaths=true']

export interface GitRunnerOptions {
  /** Where the team runs (T249). Read on every call: the boss can move it while the app is up. */
  team?: () => ProviderRuntime | null
  /** The runners, for a composition root that already has a set. */
  runners?: Runners
  /** The git command. A test hands in a name it can see; nothing here resolves it. */
  git?: string
}

export function createGitRunner({ team = () => null, runners, git = 'git' }: GitRunnerOptions = {}): GitRunner {
  const set = runners ?? createRunners({ team })

  function runnerFor(cwd: string): ProcessRunner {
    return set.forPath(cwd)
  }

  /**
   * The app's own settings for this folder.
   *
   * `safe.directory` only where it is really needed: a repo inside a distro that **Windows's** git
   * is being pointed at over UNC. The distro's own git owns those files, and naming a
   * `\\wsl.localhost\…` path to it would be a setting about a path that does not exist in there.
   */
  function settings(cwd: string): string[] {
    const runner = runnerFor(cwd)
    // Inside the distro git is simply the owner, and `core.longpaths` is a Windows-only key: the
    // whole workaround the Windows side needs has nothing to say in there.
    if (runner.runtime.kind === 'wsl') return []
    if (!wslUncDistro(cwd)) return LONG_PATHS
    // Both spellings of the one folder. `safe.directory` is a multi-valued key, so repeating `-c`
    // adds rather than replaces, and git compares the path it computed for the repo against each:
    // it writes a UNC with forward slashes, while this process is holding the backslashed one (T256).
    return [...LONG_PATHS, '-c', `safe.directory=${cwd}`, '-c', `safe.directory=${cwd.replace(/\\/g, '/')}`]
  }

  function argv(cwd: string, args: readonly string[]): string[] {
    return [...settings(cwd), ...args]
  }

  function call(cwd: string, options: GitCall = {}) {
    return {
      cwd,
      ...(options.maxBuffer !== undefined && { maxBuffer: options.maxBuffer }),
      ...(options.env !== undefined && { env: { ...process.env, ...options.env } }),
      ...(options.mapPaths !== undefined && { mapPaths: options.mapPaths }),
    }
  }

  return {
    text(cwd, args, options) {
      try {
        return runnerFor(cwd).execFileSync(git, argv(cwd, args), call(cwd, options))
      } catch (error) {
        throw new GitFailure(`git ${args[0]} failed in ${cwd}: ${gitFailure(error)}`, error)
      }
    },
    tryText(cwd, args, options) {
      try {
        return runnerFor(cwd).execFileSync(git, argv(cwd, args), call(cwd, options))
      } catch {
        return null
      }
    },
    async output(cwd, args, options) {
      return (await runnerFor(cwd).execFile(git, argv(cwd, args), call(cwd, options))).stdout
    },
    settings,
    runtimeFor: (cwd) => runnerFor(cwd).runtime,
    toHost: (cwd, path) => runnerFor(cwd).toHost(path),
  }
}

/**
 * A git that exited non-zero, with what it printed still attached.
 *
 * The message is the sentence the boss is shown; `stdout` is why this is a class rather than an
 * `Error`. A merge with conflicts exits non-zero and says `CONFLICT` on **stdout**, and the only way
 * to tell that from a merge that failed for any other reason is to read it — so wrapping the failure
 * must not throw the output away, which is exactly what it used to do.
 */
export class GitFailure extends Error {
  readonly stdout: string
  readonly stderr: string
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'GitFailure'
    this.stdout = streamOf(cause, 'stdout')
    this.stderr = streamOf(cause, 'stderr')
  }
}

function streamOf(error: unknown, which: 'stdout' | 'stderr'): string {
  const value = (error as Record<string, unknown> | null)?.[which]
  if (typeof value === 'string') return value
  return Buffer.isBuffer(value) ? value.toString('utf8') : ''
}

/** A failed git's stderr, else its message — the sentence the boss is shown. */
export function gitFailure(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : ''
  return text.trim() || (error instanceof Error ? error.message : String(error))
}
