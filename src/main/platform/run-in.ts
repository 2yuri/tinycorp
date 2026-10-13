import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProviderRuntime } from '../../shared/platform/wsl'
import { runtimeKey, WINDOWS_RUNTIME } from '../../shared/platform/wsl'
import { cliInvocation } from './cli-command'
import { cachedWslLoginPath, runWsl } from './wsl'
import { toWindowsPath, type WslPathOptions, wslUncDistro } from './wsl-path'
import { isWsl, runtimePaths, WSL_COMMAND, wslCommand, wslEnv } from './wsl-runtime'

/**
 * One process runner per runtime (T259).
 *
 * T167 put a Provider's *Session* inside a WSL distro. Everything else TinyCorp runs for that
 * Company stayed on Windows: git, `gh`, `rtk`, a repo's run command, the language server. On a
 * machine where the boss chose WSL that is a mixed team — a Linux Employee editing a repo whose
 * worktrees were made by a Windows git — and the seam it breaks at is not a nicety:
 *
 * - `git worktree add` writes an **absolute** `gitdir:` link into the worktree and an absolute
 *   `worktree` line back into the repo. A Windows git writes `C:/code/acme` or
 *   `//wsl.localhost/Ubuntu/home/b/acme`, and the distro's git cannot follow either. So a repo is
 *   all-Windows or all-distro, and which one is decided by **where the repo is**, not by a setting.
 * - Everything a repo inside the distro is asked from Windows needs `safe.directory`, because every
 *   file under it is owned by a uid Windows has never heard of. The distro's own git needs none of
 *   that: there it is simply the owner.
 *
 * So this file is the one place a non-Provider child process is started, and it is built the way
 * `shell-command.ts` is built — out of `wslCommand` and `wslEnv` — so a distro's login shell, its
 * `PATH` and its own copy of a tool are what answer.
 *
 * **On macOS, on Linux, and on Windows with the team on Windows this is today's `execFile` and
 * nothing else.** {@link runIn} with a Windows runtime returns a runner that adds no argument, no
 * translation and no `wsl.exe`: the same call, through one more function. That is the property
 * `run-in.test.ts` pins per platform, because it is the only way the other two platforms can be
 * sure a WSL ticket did not change them.
 */

/** What every call through a runner may set. A subset of node's options: only what callers use. */
export interface RunInOptions {
  /** The folder the command runs in, in **host** spelling — this runner translates it. */
  cwd?: string
  /** The whole environment. What the app added to it crosses into a distro through `WSLENV`. */
  env?: NodeJS.ProcessEnv
  timeout?: number
  maxBuffer?: number
  /** Written to the command's stdin, for the `execFileSync` form. */
  input?: string
  /**
   * Whether the command is resolved the way a Windows shim needs it: through `cliInvocation`, so a
   * `gh.cmd` written by npm or scoop is started through `cmd.exe` rather than handed to
   * `CreateProcess`, which cannot start a batch file (T166).
   *
   * Off by default, because a Windows boss whose team runs on Windows must get **today's**
   * `execFile` — the same image, the same argv — and `git` on Windows is an `.exe` that never
   * needed it. A caller whose tool really is a shim (`gh`, `glab`, `rtk`) says so. Inside a distro
   * it is not read at all: there the login shell resolves its own `PATH`, which is the whole reason
   * `wslCommand` runs `sh -lc`.
   */
  shim?: boolean
  /**
   * Whether absolute POSIX paths in what the command **printed** are mapped back to their host
   * spelling. Off by default, and that default is the interesting half.
   *
   * A command's output is only sometimes paths. `git rev-parse --show-toplevel` is one, and
   * `git worktree list --porcelain` is one; `git show HEAD:src/x.ts` is a **file**, and
   * `git diff` is a patch whose body is somebody's source code. Mapping every `/usr/...` in those
   * would rewrite the boss's own code on its way to the screen — silently, and only on one
   * platform. So the caller that parses paths says so, and nothing else pays for it.
   */
  mapPaths?: boolean
}

/** The three shapes of child process the app starts. Nothing else reaches `node:child_process`. */
export interface ProcessRunner {
  /** Where this runner runs. Every path it takes and answers is translated for this. */
  readonly runtime: ProviderRuntime
  /** `execFileSync`, always as UTF-8 text, with stderr folded into the thrown error as node does. */
  execFileSync(file: string, args: readonly string[], options?: RunInOptions): string
  /** `execFile` as a promise, the way `promisify(execFile)` gives it. */
  execFile(file: string, args: readonly string[], options?: RunInOptions): Promise<{ stdout: string; stderr: string }>
  /** `spawn`, for a long-lived process whose streams the caller reads itself. */
  spawn(file: string, args: readonly string[], options?: RunInOptions): ChildProcess
  /** `path` as this runtime spells it, or `path` unchanged when it has no name in there. */
  toRuntime(path: string): string
  /** A path this runtime printed, as this process spells it, or unchanged when it is not one. */
  toHost(path: string): string
}

const execFileAsync = promisify(execFile)

/** What a runner is built with. Everything about the machine, so a test can answer for one. */
export interface RunInDeps {
  platform?: NodeJS.Platform
  host?: NodeJS.ProcessEnv
  /**
   * The `PATH` the boss's own shell has in this distro (T258), or null when its shell would not say.
   *
   * **Every command here gets the same `PATH` the Sessions do**, and it has to be the same one: T258
   * found the CLI on it, so a `gh` or an `rtk` that only a login `sh` can see is a `gh` or an `rtk`
   * the app would report installed and then fail to start. A distro that ships no `~/.profile` —
   * Arch — keeps `~/.local/bin`, nvm, npm-global and bun in `~/.zshrc`, where a login shell never
   * looks.
   *
   * Read through T258's per-distro cache, so it costs one interactive shell for the whole run however
   * many git calls follow, and `Check again` clears it with everything else. It is called per **call**
   * rather than when the runner is made, because a runner is made at module load for every
   * `createGitRunner()` default and none of them may start a distro.
   */
  loginPath?: (distro: string) => string | null
}

/**
 * A runner for one runtime.
 *
 * `platform` is taken rather than read so a test on a Mac can ask what a Windows boss would get,
 * which is the only way the WSL half is testable at all: a distro runner is `wsl.exe` plus
 * arguments, and that string is the same string on every machine.
 */
export function runIn(
  runtime: ProviderRuntime | null,
  {
    platform = process.platform,
    host = process.env,
    loginPath = (distro) => cachedWslLoginPath(runWsl, distro),
  }: RunInDeps = {},
): ProcessRunner {
  if (!isWsl(runtime) || platform !== 'win32') return hostRunner(platform)
  const inside = runtime
  const paths: WslPathOptions = { distro: inside.distro }

  /**
   * `wsl.exe -d Ubuntu --cd /home/b/acme -e sh -lc 'exec "$0" "$@"' git status`, and **no cwd for
   * `spawn`**.
   *
   * `--cd` already carries the folder, in the spelling the Linux process needs. Handing node the
   * Windows one as well would be a second answer to the same question, and on the shape that
   * matters most — a repo inside the distro, reached over `\\wsl.localhost\…` — a UNC working
   * directory is the one thing `cmd.exe` and a good deal of Win32 refuse outright. So the host
   * process starts wherever the app is and the distro does the `cd`.
   */
  function invoke(file: string, args: readonly string[], options: RunInOptions) {
    const env = options.env ?? host
    return {
      file: WSL_COMMAND,
      args: wslCommand({
        distro: inside.distro,
        cwd: options.cwd ?? null,
        command: file,
        args,
        path: loginPath(inside.distro),
      }),
      options: { ...withoutCwd(options), env: wslEnv(plain(env), host) },
    }
  }

  const back = (text: string, on: boolean) => (on ? mapPathsToHost(text, paths) : text)

  return {
    runtime: inside,
    execFileSync(file, args, options = {}) {
      const call = invoke(file, args, options)
      const out = execFileSync(call.file, call.args, { ...syncOptions(call.options), encoding: 'utf8' })
      return back(out, options.mapPaths === true)
    },
    async execFile(file, args, options = {}) {
      const call = invoke(file, args, options)
      const { stdout, stderr } = await execFileAsync(call.file, call.args, {
        ...asyncOptions(call.options),
        encoding: 'utf8',
      })
      const on = options.mapPaths === true
      return { stdout: back(stdout, on), stderr: back(stderr, on) }
    },
    spawn(file, args, options = {}) {
      const call = invoke(file, args, options)
      return spawn(call.file, call.args, { ...spawnOptions(call.options), windowsHide: true })
    },
    ...runtimePaths(inside),
  }
}

/**
 * This machine, with nothing added.
 *
 * With `shim` off — which is every git call — the file and the arguments reach `node:child_process`
 * exactly as the caller wrote them, so a Mac, a Linux desktop and a Windows whose team runs on
 * Windows all keep the behaviour they had before this file existed.
 */
function hostRunner(platform: NodeJS.Platform): ProcessRunner {
  const invoke = (file: string, args: readonly string[], options: RunInOptions) => {
    if (options.shim !== true) return { file, args: [...args], verbatim: false }
    return cliInvocation(file, args, options.env ?? process.env, platform)
  }
  return {
    runtime: WINDOWS_RUNTIME,
    execFileSync(file, args, options = {}) {
      const call = invoke(file, args, options)
      return execFileSync(call.file, call.args, {
        ...syncOptions(options),
        encoding: 'utf8',
        ...(call.verbatim && { windowsVerbatimArguments: true }),
      })
    },
    async execFile(file, args, options = {}) {
      const call = invoke(file, args, options)
      return execFileAsync(call.file, call.args, {
        ...asyncOptions(options),
        encoding: 'utf8',
        ...(call.verbatim && { windowsVerbatimArguments: true }),
      })
    },
    spawn(file, args, options = {}) {
      const call = invoke(file, args, options)
      return spawn(call.file, call.args, {
        ...spawnOptions(options),
        ...(call.verbatim && { windowsVerbatimArguments: true }),
      })
    },
    toRuntime: (path) => path,
    toHost: (path) => path,
  }
}

/**
 * Whichever runtime owns `path` — the rule that keeps a repo from being worked on by two gits
 * (T259).
 *
 * **Nothing at all happens until the team runs in a distro.** A Windows boss whose team is on
 * Windows keeps every path they had, including a Company folder on a WSL share: that repo is reached
 * over UNC by the Windows git and made openable by the `safe.directory` T256 put in front of it. A
 * distro that has no `git` installed is then still a working machine, which is the whole reason this
 * is not decided by the path alone.
 *
 * Once the team **is** in a distro, two answers:
 *
 * 1. A path reached over `\\wsl.localhost\Debian\…` is in **Debian**, even when the team runs in
 *    Ubuntu. Its `gitdir:` links are absolute and Debian's, and only Debian's git can follow them.
 * 2. An absolute POSIX path came *from* the team's distro — it is what that distro's own git or
 *    `wslpath` printed — so it belongs to the team's runtime.
 *
 * Everything else is a drive of this PC, and a drive is Windows's. That includes a repo on `D:` on a
 * machine whose team runs in Ubuntu: `/mnt/d` is the same bytes, but the worktree links under it
 * were written by the Windows git that made them.
 */
export function runtimeForPath(path: string, team: ProviderRuntime | null): ProviderRuntime {
  if (!isWsl(team)) return WINDOWS_RUNTIME
  const distro = wslUncDistro(path)
  if (distro) return { kind: 'wsl', distro }
  return path.startsWith('/') ? team : WINDOWS_RUNTIME
}

/**
 * Every absolute POSIX path in `text`, as this Windows process spells it.
 *
 * Whole words only, and a word is what a path can be made of: git prints one per line
 * (`rev-parse --show-toplevel`) or after a keyword (`worktree /home/b/acme`), never glued to
 * prose. `/home/b/x` becomes `\\wsl.localhost\Ubuntu\home\b\x` and `/mnt/d/code` becomes
 * `D:\code`, which is the one the app's own database already holds.
 */
export function mapPathsToHost(text: string, options: WslPathOptions): string {
  return text.replace(/(^|[\s:=])(\/[^\s:*?"<>|]*)/g, (whole, lead: string, path: string) => {
    const windows = toWindowsPath(path, options)
    return windows === null ? whole : `${lead}${windows}`
  })
}

/** An environment as a plain record, which is what `WSLENV` has to be merged into. */
function plain(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

/** The same options with no `cwd`: the distro's `--cd` is the answer to that question. */
function withoutCwd({ cwd: _cwd, ...rest }: RunInOptions): Omit<RunInOptions, 'cwd'> {
  return rest
}

/**
 * The three shapes below say which of node's options each form takes, and they stay narrow on
 * purpose: `mapPaths` is ours and node would not know what to do with it, and `stdio` is set here
 * rather than passed, so no caller can hand a child this process's own streams by accident.
 */
function syncOptions(options: RunInOptions) {
  return {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.env !== undefined && { env: options.env }),
    ...(options.timeout !== undefined && { timeout: options.timeout }),
    ...(options.maxBuffer !== undefined && { maxBuffer: options.maxBuffer }),
    ...(options.input !== undefined && { input: options.input }),
    stdio: ['pipe', 'pipe', 'pipe'] as ('pipe' | 'ignore')[],
  }
}

function asyncOptions(options: RunInOptions) {
  return {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.env !== undefined && { env: options.env }),
    ...(options.timeout !== undefined && { timeout: options.timeout }),
    ...(options.maxBuffer !== undefined && { maxBuffer: options.maxBuffer }),
  }
}

function spawnOptions(options: RunInOptions) {
  return {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.env !== undefined && { env: options.env }),
    stdio: ['pipe', 'pipe', 'pipe'] as ('pipe' | 'ignore')[],
  }
}

/**
 * Where the team runs, as the machine's own answer — read the way `PATH` is read.
 *
 * Every `createXGit()` in the app has a default, and those defaults are reached from places that have
 * no engine to be handed one: a Provider adapter calling `excludeFromGit` on a worktree, a repo
 * inspector walking a folder the boss just picked. Threading the boss's profile into all of them
 * would be a parameter on twenty functions to say one thing about the computer, so instead the
 * composition root answers it once, here, next to the `PATH` cache in `cli-command.ts` and the distro
 * cache in `wsl.ts` — the other two facts about this machine that are read rather than passed.
 *
 * It is a *function*, not a value, because the boss can move the team while the app is up. Nothing
 * in a test ever sets it: a test that cares builds its own {@link Runners} with `team`, and a test
 * that does not gets this default, which is this machine and nothing else.
 */
let teamRuntime: () => ProviderRuntime | null = () => null

/**
 * Says where the team runs. Called once, by the composition root, before the engine exists.
 *
 * Passing nothing puts it back to *this machine*, which is what every test starts from and what
 * `run-in.test.ts` relies on to stay honest about the other two platforms.
 */
export function setTeamRuntime(where: (() => ProviderRuntime | null) | null = null): void {
  teamRuntime = where ?? (() => null)
}

/** Which runner to use, decided per call: for the team, or for whatever owns a path. */
export interface Runners {
  /**
   * Where the team runs — the boss's one answer (T249), the place with no path to read it off:
   * `rtk --version`, `gh --version`, whether a CLI is installed at all.
   */
  team(): ProcessRunner
  /**
   * The runner for whatever owns `path`, by {@link runtimeForPath}. Every git call goes through
   * this one, because a repo is all-Windows or all-distro and the path is what says which.
   */
  forPath(path: string): ProcessRunner
}

export interface RunnersOptions extends RunInDeps {
  /**
   * Where the team runs, read fresh: the boss can change it while the app is up. Left out, it is
   * whatever the composition root told {@link setTeamRuntime}, which off Windows is this machine.
   */
  team?: () => ProviderRuntime | null
}

/**
 * The runners, made once per runtime and kept.
 *
 * A runner holds no state of its own — it is a closure over a distro name — but it is asked for on
 * every git call, and a `Map` lookup is the honest cost of that. `team()` is read on each ask
 * rather than captured, because Company settings can move it while the app is running and the next
 * command has to go to the new place.
 */
export function createRunners({ team = () => teamRuntime(), ...deps }: RunnersOptions = {}): Runners {
  const made = new Map<string, ProcessRunner>()
  function runner(runtime: ProviderRuntime | null): ProcessRunner {
    const key = runtime === null ? 'windows' : runtimeKey(runtime)
    const known = made.get(key)
    if (known) return known
    const fresh = runIn(runtime, deps)
    made.set(key, fresh)
    return fresh
  }
  return {
    team: () => runner(team()),
    forPath: (path) => runner(runtimeForPath(path, team())),
  }
}
