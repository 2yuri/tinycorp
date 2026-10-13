import { readdirSync, statSync } from 'node:fs'
import type { ProviderRuntime } from '../../shared/platform/wsl'
import { RTK_DB_ENV } from '../../shared/rtk'
import type { PtySession, PtySpawnOptions, SpawnPty } from './pty'
import type { RunCli } from './run-cli'
import { withDistroPath } from './wsl'
import { toLinuxPath, toWindowsPath, translatePaths, WSL_UNC_PREFIXES, type WslPathOptions } from './wsl-path'

/**
 * Starting a Provider's CLI inside a WSL distro (T167).
 *
 * No adapter knows about any of this, and none of them should: an adapter's job is its own
 * product's flags, and "which machine is this running on" is not a fact about Claude Code or
 * Codex. So the runtime is a layer *under* every adapter — it wraps the two seams an adapter
 * already takes (`spawnPty` and `runCli`) and the one command it hands back for the boss's own
 * terminal — and a Provider added tomorrow runs in WSL without a line about it.
 *
 * Everything crossing the boundary is translated on the way:
 *
 * - the working directory, which becomes `--cd <linux path>`;
 * - every argument, because `--mcp-config C:\Users\…` names no file inside a distro;
 * - the environment the app added, which crosses through `WSLENV` and nothing else.
 */

/** The command that runs something inside a distro. Resolved on the Windows `PATH` like any other. */
export const WSL_COMMAND = 'wsl.exe'

/**
 * The one-line script every WSL Session is started through:
 *
 *     sh -lc 'PATH=…; exec "$0" "$@"' claude --resume …
 *
 * `sh -lc` because a **login** shell is the only thing that sources the profile at all, and a plain
 * `wsl.exe -e claude` runs with WSL's own bare environment and reports a CLI missing that the boss's
 * terminal finds every day.
 *
 * And the distro's own `PATH` in front of it when it has been read (T258), because a login `sh` is
 * not the boss's shell: `/etc/profile` and `~/.profile` are all it reads, and a distro that ships no
 * `~/.profile` — Arch — has `~/.local/bin`, nvm, npm-global and bun in `~/.zshrc` and nowhere the
 * profile can see. The Session then starts under the same `PATH` the lookup found the CLI on, which
 * is the only way the two can agree.
 *
 * `exec "$0" "$@"` because the command and its arguments then ride in `argv` rather than inside a
 * string the shell has to re-parse: nothing is quoted, nothing is word-split, and a prompt with a
 * quote in it cannot become a shell. And `exec` replaces the shell, so the CLI is the process the
 * PTY is attached to — its signals, its exit code, its resizes.
 */
export const WSL_LOGIN_SCRIPT = 'exec "$0" "$@"'

export interface WslCommandRequest {
  distro: string
  /** The Windows folder the CLI should work in, or null to let the distro choose. */
  cwd: string | null
  command: string
  args: readonly string[]
  /** What `automount.root` is inside the distro, when it is not `/mnt`. */
  automountRoot?: string
  /**
   * The `PATH` the boss's own shell has in this distro, from `cachedWslLoginPath` (T258). Left out
   * or null, the login profile's own `PATH` is all the Session gets — which is what every WSL
   * Session had before T258, and what a distro whose shell would not answer still gets.
   */
  path?: string | null
}

/**
 * `wsl.exe -d Ubuntu --cd /mnt/c/work/acme -e sh -lc 'exec "$0" "$@"' claude --resume …`
 *
 * A cwd that has no name inside the distro — a UNC path into a *different* distro — is passed to
 * `--cd` as the Windows path it is. `wsl.exe` takes either spelling, and a path it cannot reach is
 * a visible failure rather than a Session quietly started in the wrong folder.
 */
export function wslCommand({ distro, cwd, command, args, automountRoot, path }: WslCommandRequest): string[] {
  const paths: WslPathOptions = { distro, ...(automountRoot && { automountRoot }) }
  const where = cwd === null ? [] : ['--cd', toLinuxPath(cwd, paths) ?? cwd]
  return [
    '-d',
    distro,
    ...where,
    '-e',
    'sh',
    '-lc',
    withDistroPath(WSL_LOGIN_SCRIPT, path),
    command,
    ...args.map((argument) => translatePaths(argument, paths)),
  ]
}

/**
 * The variables the app itself put in this environment, as `WSLENV` names them.
 *
 * Only the app's own: a variable that came out of `process.env` unchanged is the *Windows*
 * machine's, and the distro has its own answer for every one of them — its own `PATH`, its own
 * `HOME`, its own login. Crossing those would hand a Linux process a Windows `PATH` and break the
 * very shell profile the login shell was for. So the environment the adapter built is compared
 * with the one the app inherited, and what the app added or changed is what crosses.
 *
 * Almost all of them are a token or a flag rather than a path, and cross as they are. The ones that
 * *are* a path get `/p`, which is what makes `wsl.exe` translate `C:\\Users\\…` into
 * `/mnt/c/Users/…` on the way in — and which one is a path is read off the **value**
 * ({@link isWindowsPathValue}), not off a list of names.
 */
export function wslEnv(env: Record<string, string>, host: NodeJS.ProcessEnv): Record<string, string> {
  const crossing = Object.keys(env)
    .filter((name) => name !== 'WSLENV' && env[name] !== host[name])
    .sort()
  if (crossing.length === 0) return env
  const existing = env['WSLENV'] ? env['WSLENV'].split(':').filter((entry) => entry !== '') : []
  const names = [
    ...new Set([...existing, ...crossing.map((name) => (crossesAsPath(name, env[name]!) ? `${name}/p` : name))]),
  ]
  return { ...env, WSLENV: names.join(':') }
}

/**
 * The variables the app puts on a Session whose value is a **Windows path**, so `wsl.exe` has to
 * translate them rather than hand the distro a drive letter it cannot open.
 *
 * `RTK_DB_PATH` is the one that has to be named (T179): its file does not exist yet when the Session
 * starts, so there is nothing to recognise it by, and a `C:\\Users\\…` there is a file RTK inside the
 * distro cannot create — the savings would silently stay at zero.
 */
export const CROSSING_PATHS = new Set([RTK_DB_ENV])

/**
 * Whether this variable's value has to be translated on the way into a distro.
 *
 * **Read off the value and not off a list of names** (T258). Three more of them needed translating
 * — `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `OPENCODE_CONFIG`, the folders each product reads its
 * sign-in and its per-Session config from — and an account TinyCorp had made under its own data
 * folder therefore arrived in the distro as `C:\\Users\\b\\AppData\\…`: a folder no Linux process can
 * open, so an added account in WSL signed in nowhere the CLI could reach (T257).
 *
 * Naming them here would put a list of the Providers in `platform`, which sits *below* every
 * Provider and may not name one — and the list would be wrong again the day a Provider adds a
 * fourth. Naming them on the adapter instead would need the adapter to exist before the seams it is
 * built with. A value that is a Windows path, on the other hand, is a Windows path whoever set it:
 * every variable the app adds is its own, and the app has no reason to hand a Linux process a
 * drive letter it means literally.
 */
export function crossesAsPath(name: string, value: string): boolean {
  return CROSSING_PATHS.has(name) || isWindowsPathValue(value)
}

/**
 * `C:\\Users\\b\\.claude`, `\\\\wsl.localhost\\Arch\\home\\b\\co` — a value only `wslpath` can turn into a
 * name inside the distro. A UNC path counts, because a Company folder may live on a WSL share
 * itself (T256), and `wsl.exe` translates that spelling too.
 *
 * A list — `C:\\a;C:\\b` — is deliberately not one: `WSLENV` would need `/l` for it, and nothing the
 * app puts on a Session is one. A relative path is not one either; there is no drive to translate.
 */
export function isWindowsPathValue(value: string): boolean {
  if (value.includes(';')) return false
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

export interface WslRuntimeOptions {
  distro: string
  /** The environment the app itself was started with, to tell its own variables from Windows's. */
  host?: NodeJS.ProcessEnv
  automountRoot?: string
  /**
   * Where `rtk` is **inside this distro**, or null when it is not in there (T179). The `rtk` on the
   * Windows `PATH` is not on the distro's, so a hook written with it would name a program that does
   * not exist and every command would run uncompressed without a word.
   */
  rtkPath?: string | null
  /** The `PATH` the boss's own shell has in this distro (T258). See {@link WslCommandRequest.path}. */
  path?: string | null
}

/**
 * The same {@link SpawnPty} the adapter would have used, starting the CLI inside the distro.
 *
 * The PTY is still a Windows one, attached to `wsl.exe`: the terminal the drawer draws, the
 * resizes it sends and the keystrokes it types all work exactly as they did, because a Session in
 * WSL is a `wsl.exe` process on Windows with a Linux process inside it.
 */
export function wslSpawnPty(
  inner: SpawnPty,
  { distro, host = process.env, automountRoot, path = null }: WslRuntimeOptions,
): SpawnPty {
  return (file: string, args: string[], options: PtySpawnOptions): PtySession =>
    inner(
      WSL_COMMAND,
      wslCommand({ distro, cwd: options.cwd, command: file, args, ...(automountRoot && { automountRoot }), path }),
      {
        ...options,
        env: wslEnv(options.env, host),
      },
    )
}

/**
 * The same {@link RunCli} the preflight would have used, asking the CLI inside the distro.
 *
 * Signed in is checked where the CLI runs (T167): a `claude` on Windows and a `claude` in Ubuntu
 * are two installations with two logins, and asking the wrong one produces a card telling the boss
 * to sign in somewhere they already are.
 */
export function wslRunCli(
  inner: RunCli,
  { distro, host = process.env, automountRoot, path = null }: WslRuntimeOptions,
): RunCli {
  return (command, args, options = {}) => {
    const env = options.env ?? host
    return inner(
      WSL_COMMAND,
      wslCommand({ distro, cwd: null, command, args, ...(automountRoot && { automountRoot }), path }),
      { ...options, env: wslEnv(plain(env), host) },
    )
  }
}

/** An environment as a plain record, which is what `WSLENV` has to be merged into. */
function plain(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

/**
 * The two spellings one path has across a runtime, as pure functions (T259).
 *
 * Deliberately free of `process.platform`, unlike {@link runIn}, and the two answer different
 * questions. *Which process starts the command* is about the machine the app is on — there is no
 * `wsl.exe` on a Mac. *What a path is called* is about the runtime alone: an Employee inside Arch was
 * handed `/home/b/Acme/worktrees/t-4` and will send that back whatever machine the app runs on, so
 * every suite says the same thing on every runner, which is what `docs/engineering.md` asks of a
 * fixture that names a path.
 *
 * A path with no name on the other side — a UNC into a different distro, a relative path — is handed
 * back as it came, so a wrong folder is never used in place of a missing one.
 */
export function runtimePaths(runtime: ProviderRuntime | null): {
  toHost(path: string): string
  toRuntime(path: string): string
} {
  if (!isWsl(runtime)) return { toHost: (path) => path, toRuntime: (path) => path }
  const paths: WslPathOptions = { distro: runtime.distro }
  return {
    toHost: (path) => toWindowsPath(path, paths) ?? path,
    toRuntime: (path) => toLinuxPath(path, paths) ?? path,
  }
}

/** Whether this runtime needs any of the above. Windows is the plain case and stays plain. */
export function isWsl(runtime: ProviderRuntime | null | undefined): runtime is { kind: 'wsl'; distro: string } {
  return runtime?.kind === 'wsl'
}

/**
 * The home folders inside a distro, spelled the way this Windows process reaches them:
 * `\\wsl.localhost\Ubuntu\home\b` (T167, T249).
 *
 * A distro's `/home` holds one folder per Linux account, and which of them is the boss's is not a
 * question this process can answer without running something inside the distro. So it answers with
 * all of them: the caller is listing folders, and a home with nothing in it contributes nothing.
 * Listing only — nothing is written, and `root`, whose home is `/root`, is not one of these.
 */
export function wslHomeFolders(distro: string): string[] {
  const home = `${WSL_UNC_PREFIXES[0]}${distro}\\home`
  let names: string[]
  try {
    names = readdirSync(home).sort()
  } catch {
    // A distro that is not there, or a `\\wsl.localhost` this Windows does not serve.
    return []
  }
  return names
    .map((name) => `${home}\\${name}`)
    .filter((path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    })
}

export interface TeamHomeOptions {
  /** Where the team runs (T249), read off the boss's profile. Null on a Mac, and until they say. */
  teamDefault: ProviderRuntime | null
  /** `app.getPath('home')`: what a team on Windows, and every Mac and Linux desktop, gets. */
  windowsHome: string
  /** This OS account's name, tried first among a distro's homes. */
  account?: string
  /** The home folders inside a distro. Injected; defaults to reading the share. */
  homesIn?: (distro: string) => string[]
}

/**
 * The home folder a new Company is suggested under (T256).
 *
 * A boss whose team runs inside a distro keeps their code there, and `C:\Users\b` is not where
 * they work: the Create step suggests the distro's own home, `\\wsl.localhost\Arch\home\b`, and
 * only the database stays on this PC. A team on Windows keeps the home it always had, and so does
 * every Mac and Linux desktop, where there is no team default at all.
 *
 * Which of a distro's homes is the boss's is not a question this process can answer without
 * running something inside the distro, so the Windows account's own name is tried first — `b` on
 * Windows is `b` in the distro far more often than not — and the first home answers otherwise. A
 * distro with no `/home` at all falls back to Windows rather than suggesting a folder that is not
 * there.
 */
export function teamHomeFolder({
  teamDefault,
  windowsHome,
  account,
  homesIn = wslHomeFolders,
}: TeamHomeOptions): string {
  if (!isWsl(teamDefault)) return windowsHome
  const homes = homesIn(teamDefault.distro)
  const mine = account && homes.find((home) => home.toLowerCase().endsWith(`\\${account.toLowerCase()}`))
  return mine ?? homes[0] ?? windowsHome
}
