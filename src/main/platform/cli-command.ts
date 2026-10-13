import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path'

/**
 * Finding a CLI on this machine, and saying how to start it. One helper, because on Windows the
 * two questions have different answers and answering only the first is the bug (T166).
 *
 * `where codex` finds `codex.cmd` — the shim npm writes for a global install — so the app says the
 * Provider is installed. But a `.cmd` is a batch file, not an image: `CreateProcess`, which both
 * node-pty and `child_process.execFile` end up in, cannot start one. The Employee's drawer would
 * say Codex is here and every Session on it would die at spawn.
 *
 * So the search is done once, against `PATHEXT`, and what comes back is a full path whose shape
 * the app knows: an `.exe` is started directly, and a `.cmd` or `.bat` is started through
 * `cmd.exe /d /s /c` with the command line quoted the way Windows parses one. A shim that exists
 * only as PowerShell (`.ps1`) is not installed, because nothing here will run one.
 *
 * On macOS and Linux this is a `PATH` walk and nothing else: the file is the program.
 */

/** How a CLI is started: the image to run, and the arguments it gets. */
export interface CliInvocation {
  /** The executable. `cmd.exe` when {@link verbatim}, else the CLI itself. */
  file: string
  /** Its arguments, as the platform's spawn takes them. */
  args: string[]
  /**
   * Windows only: {@link args} is one command line that is already quoted, so whoever spawns it
   * passes it through untouched — `windowsVerbatimArguments` for `child_process`, and a single
   * string for node-pty, which appends a string argument to the command line as it stands.
   */
  verbatim: boolean
}

/** What `PATHEXT` holds on a Windows nobody has touched. */
export const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/**
 * The extensions the app will start a CLI from. `PATHEXT` also lists `.VBS` and friends, and npm
 * writes a `.ps1` beside every shim; none of them is something TinyCorp spawns.
 */
const RUNNABLE = new Set(['.com', '.exe', '.bat', '.cmd'])

/** The two Windows leaves to `cmd.exe`, so they are the two that need it. */
const BATCH = new Set(['.bat', '.cmd'])

/** The answers, per command, `PATH` and `PATHEXT`: the drawer asks this every time it draws. */
const found = new Map<string, string | null>()

/** Forgets every cached answer, so the next ask searches `PATH` again. */
export function forgetCliPaths(): void {
  found.clear()
}

/**
 * The full path of `command` on this machine, or null when nothing on `PATH` answers to it. A
 * command that already names a path — `/opt/homebrew/bin/claude`, `C:\tools\codex.cmd` — is
 * checked where it points and nowhere else.
 */
export function resolveCli(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const windows = platform === 'win32'
  const key = `${platform}\u0000${variable(env, 'PATH', windows) ?? ''}\u0000${variable(env, 'PATHEXT', windows) ?? ''}\u0000${command}`
  const known = found.get(key)
  if (known !== undefined) return known
  const path = searchPath(command, env, windows)
  found.set(key, path)
  return path
}

/**
 * One environment variable, by whatever case this platform spells it in.
 *
 * Windows names are case-insensitive, and it hands Node `Path`, not `PATH`. `process.env` itself
 * hides that — it looks a name up either way — but every environment the app builds is a plain
 * object copied out of it (`subscriptionEnv`, an adapter's `cleanEnv`), and a plain object does
 * not. Reading `env.PATH` off one of those would find nothing on Windows, and every Provider on the
 * machine would read as not installed (T166).
 */
function variable(env: NodeJS.ProcessEnv, name: string, windows: boolean): string | undefined {
  const exact = env[name]
  if (exact !== undefined || !windows) return exact
  const found = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase())
  return found === undefined ? undefined : env[found]
}

/** Whether `command` can be started on this machine at all. */
export function cliExists(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return resolveCli(command, env, platform) !== null
}

/**
 * How to start `command` with `args`. A `.cmd` or `.bat` on Windows goes through `cmd.exe`, which
 * is the only thing that runs one, with every argument quoted as Windows parses a command line.
 *
 * A command that is not on `PATH` is handed back as it was: the spawn then fails with `ENOENT`,
 * which is what every caller already expects of a CLI that is not here.
 */
export function cliInvocation(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): CliInvocation {
  const plain = { file: command, args: [...args], verbatim: false }
  if (platform !== 'win32') return plain
  const path = resolveCli(command, env, platform)
  if (!path) return plain
  if (!BATCH.has(extname(path).toLowerCase())) return { file: path, args: [...args], verbatim: false }
  const line = [path, ...args].map(windowsQuote).join(' ')
  // `/d` skips whatever AutoRun a machine has, `/s` fixes how the outer quotes are read, and `/c`
  // runs the line and leaves. The whole line is quoted again because that is the form `/s` is
  // defined against: the first and last quote come off, and the rest is taken as it stands.
  return { file: comSpec(env), args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
}

/** The command interpreter this Windows uses, which a boss may have moved. */
export function comSpec(env: NodeJS.ProcessEnv = process.env): string {
  return variable(env, 'ComSpec', true) || 'cmd.exe'
}

/**
 * One argument, quoted for the Windows command line every program parses with
 * `CommandLineToArgvW`: backslashes matter only in front of a quote, where they double, and a
 * quote itself is escaped.
 *
 * This is the argument's own quoting, not `cmd.exe`'s. Because the quotes are here, `cmd` leaves
 * what is between them alone — except `%VAR%`, which it expands before anything else sees the
 * line. Nothing TinyCorp puts in a CLI's `argv` is written with `%`, and a Session's own text goes
 * in on stdin rather than as an argument.
 */
export function windowsQuote(argument: string): string {
  if (argument !== '' && !/[\s"^&|<>()%!]/.test(argument)) return argument
  const escaped = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  return `"${escaped}"`
}

/** `command` found on `PATH`, extension by extension where the platform has them. */
function searchPath(command: string, env: NodeJS.ProcessEnv, windows: boolean): string | null {
  if (command === '') return null
  const extensions = windows ? pathExtensions(env) : ['']
  const named = windows ? /[\\/]/.test(command) : command.includes('/')
  if (named || isAbsolute(command)) return firstRunnable(resolve(command), extensions, windows)
  for (const dir of (variable(env, 'PATH', windows) ?? '').split(delimiter)) {
    if (!dir) continue
    const hit = firstRunnable(join(unquote(dir), command), extensions, windows)
    if (hit) return hit
  }
  return null
}

/** `PATHEXT`, kept to what the app will spawn, lowercased, with "as written" first. */
function pathExtensions(env: NodeJS.ProcessEnv): string[] {
  const listed = (variable(env, 'PATHEXT', true) || DEFAULT_PATHEXT)
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => RUNNABLE.has(ext))
  // `''` is the command written with its own extension already — `python.exe`, `codex.cmd`.
  return ['', ...listed]
}

/** The first of `stem` plus `extensions` that is a file this machine can start. */
function firstRunnable(stem: string, extensions: string[], windows: boolean): string | null {
  for (const extension of extensions) {
    const candidate = `${stem}${extension}`
    // On Windows a name is only a program when its extension says so, whatever sits at that path.
    if (windows && !RUNNABLE.has(extname(candidate).toLowerCase())) continue
    if (isRunnable(candidate, windows)) return candidate
  }
  return null
}

function isRunnable(path: string, windows: boolean): boolean {
  try {
    if (!statSync(path).isFile()) return false
  } catch {
    return false
  }
  // Windows has no execute bit; the extension is the whole answer there.
  if (windows) return true
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Windows lets a `PATH` entry be quoted; the quotes are not part of the folder. */
function unquote(dir: string): string {
  return dir.startsWith('"') && dir.endsWith('"') ? dir.slice(1, -1) : dir
}
