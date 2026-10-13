import { execFileSync } from 'node:child_process'

/**
 * Finding out what WSL this Windows has, and whether a Provider's CLI is inside one (T167).
 *
 * Plenty of bosses installed `claude`, `codex` or `opencode` in Ubuntu rather than on Windows
 * itself — it is where their toolchain already lives. Until now the app looked at the Windows
 * `PATH` and nothing else, so those machines read "not installed" with the CLI sitting right
 * there. This file is the second place it looks.
 *
 * Everything here is `wsl.exe` with a timeout around it, behind a {@link WslRunner} that is
 * injected, so no test ever starts a distro. Three things it has to get right:
 *
 * - **UTF-16.** `wsl.exe -l` writes UTF-16LE with a BOM, not UTF-8. Read as UTF-8 it is a distro
 *   name with a NUL between every letter, and every comparison against it fails.
 * - **Starting a distro.** Probing a stopped distro starts it, which takes seconds and is fine —
 *   but the row has to say so, rather than look slow for no reason (frame `GacEW`).
 * - **Time.** Every probe is time-boxed. A distro that will not start must cost the drawer a
 *   second, not a minute.
 * - **Whose `PATH`.** A distro is not Ubuntu (T258). `sh -lc` reads `/etc/profile` and `~/.profile`
 *   and Arch ships no `~/.profile`, so `~/.local/bin` — where Claude Code's own installer puts
 *   itself — and nvm, npm-global and bun are all invisible to it while the boss's own terminal has
 *   had them since the day they installed the CLI. So the distro's `PATH` is read the way that
 *   terminal builds it, once per distro, and every lookup and every Session start uses that.
 *
 * On anything that is not Windows none of this runs: {@link wslDistros} answers with nothing and
 * every caller reads that as "no WSL here", which is the truth on a Mac.
 */

/** How long one `wsl.exe` call is given before the app stops waiting on it. */
export const WSL_TIMEOUT_MS = 10_000

/** How long the *listing* is given. It starts nothing, so it is the quick one. */
export const WSL_LIST_TIMEOUT_MS = 5_000

/**
 * How long the boss's own shell is given to print its `PATH` inside a distro.
 *
 * Longer than a probe, because this is the call that may have to start the distro, and an
 * interactive `~/.zshrc` does real work — plugins, a version manager, a prompt. Shorter than
 * forever, because an rc file that waits for a keystroke would otherwise hang a Session start: past
 * this the app falls back to the old `sh -lc` and says so in the log.
 */
export const WSL_PATH_TIMEOUT_MS = 15_000

/** What running `wsl.exe` did. A timeout and a failure are different rows, so they are different answers. */
export type WslOutcome =
  | { kind: 'output'; code: number; output: string }
  /** `wsl.exe` is not on this machine: no WSL, or not Windows at all. */
  | { kind: 'missing' }
  | { kind: 'timeout' }
  | { kind: 'failed'; output: string }

/** Runs `wsl.exe` with these arguments. Injected everywhere, so a test never starts a distro. */
export type WslRunner = (args: readonly string[], options?: { timeoutMs?: number }) => WslOutcome

/** One distro this Windows has installed. */
export interface WslDistro {
  name: string
  /** Whether `wsl.exe -l -v` reported it Running. A stopped one is started by the first probe. */
  running: boolean
  /** The distro `wsl.exe` uses when no `-d` is given. Probed first, because it is the boss's own. */
  default: boolean
}

/**
 * The real `wsl.exe`, decoded from UTF-16LE.
 *
 * `execFileSync` with `encoding: 'buffer'` rather than a string, because the string form would
 * decode as UTF-8 and lose every name. A non-zero exit still printed something worth reading —
 * `wsl.exe -d <gone> -e true` says the distro has no installation — so the output comes back
 * either way.
 */
export const runWsl: WslRunner = (args, { timeoutMs = WSL_TIMEOUT_MS } = {}) => {
  try {
    const stdout = execFileSync('wsl.exe', [...args], {
      encoding: 'buffer',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return { kind: 'output', code: 0, output: decodeWsl(stdout) }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stdout?: Buffer; stderr?: Buffer }
    if (failure.code === 'ENOENT') return { kind: 'missing' }
    if (failure.killed) return { kind: 'timeout' }
    const output = `${decodeWsl(failure.stdout)}${decodeWsl(failure.stderr)}`
    return { kind: 'failed', output }
  }
}

/**
 * `wsl.exe`'s own output as text. It writes UTF-16LE with a BOM for its own messages and the
 * distro list; a command run *inside* a distro (`-e sh -lc …`) writes whatever that program wrote,
 * which is UTF-8. Both arrive here, so the encoding is read off the bytes rather than assumed: a
 * BOM, or NUL bytes in the odd positions that only UTF-16LE ASCII produces.
 */
export function decodeWsl(output: Buffer | string | undefined | null): string {
  if (output === undefined || output === null) return ''
  if (typeof output === 'string') return output
  if (output.length >= 2 && output[0] === 0xff && output[1] === 0xfe) return output.subarray(2).toString('utf16le')
  if (looksUtf16(output)) return output.toString('utf16le')
  return output.toString('utf8')
}

/** ASCII in UTF-16LE is every second byte NUL. One in a sample of the front is enough to tell. */
function looksUtf16(output: Buffer): boolean {
  const sample = output.subarray(0, 64)
  if (sample.length < 4) return false
  let nuls = 0
  for (let index = 1; index < sample.length; index += 2) if (sample[index] === 0) nuls += 1
  return nuls > sample.length / 4
}

/**
 * Every distro this Windows has, the default one first.
 *
 * `wsl.exe -l -v` is asked first because it is the only form that reports both the default (a `*`
 * in the first column) and whether each one is running. Its header is localised, so nothing here
 * reads it: a line is a distro when it has a name, and the state column is matched against the
 * word `Running` and against nothing else, so an unrecognised state reads as stopped rather than
 * as running. `wsl.exe -l -q` is the fallback — one name per line, no header, no states — and a
 * machine with no WSL at all answers with nothing.
 */
export function wslDistros(run: WslRunner): WslDistro[] {
  const verbose = run(['-l', '-v'], { timeoutMs: WSL_LIST_TIMEOUT_MS })
  if (verbose.kind === 'output' || verbose.kind === 'failed') {
    const parsed = parseVerboseList(verbose.output)
    if (parsed.length > 0) return parsed
  }
  if (verbose.kind === 'missing' || verbose.kind === 'timeout') return []
  const quiet = run(['-l', '-q'], { timeoutMs: WSL_LIST_TIMEOUT_MS })
  if (quiet.kind !== 'output' && quiet.kind !== 'failed') return []
  const names = quiet.output
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, '').trim())
    .filter((line) => line !== '')
  return names.map((name, index) => ({ name, running: false, default: index === 0 }))
}

/** `* Ubuntu    Running   2` — the star, the name, the state, in whatever spacing it came in. */
const VERBOSE_ROW = /^(\*?)\s*(\S+)\s+(\S+)\s+(\S+)\s*$/

function parseVerboseList(output: string): WslDistro[] {
  const distros: WslDistro[] = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(/\0/g, '').trimEnd()
    const row = VERBOSE_ROW.exec(line.trim())
    if (!row) continue
    const [, star, name, state, version] = row
    // The header is `  NAME   STATE   VERSION` in English and something else in every other
    // language, so it is skipped by shape: a distro's last column is its WSL version, a number.
    if (!/^\d+$/.test(version!)) continue
    distros.push({ name: name!, running: /^running$/i.test(state!), default: star === '*' })
  }
  return distros.sort((a, b) => Number(b.default) - Number(a.default))
}

/** The mark the distro's `PATH` is printed between, so a chatty rc file's output is not taken for it. */
const PATH_MARK = '__TINYCORP_WSL_PATH__'

/**
 * The one line a distro is asked for its own `PATH` through (T258).
 *
 * `$SHELL` first, and `/etc/passwd` when the distro has not set it — which `wsl.exe -e sh` usually
 * has not, because nothing has logged in. Then that shell as **`-ilc`**: interactive *and* login,
 * because that is the only form that reads `~/.zshrc` and `~/.bashrc`, and on a distro with no
 * `~/.profile` — Arch ships none — that is the only place `~/.local/bin`, nvm, npm-global and bun
 * are ever put on the path. It is the question `readLoginShellPath` asks on a Mac and on a Linux
 * desktop (`login-path.ts`), asked inside the distro, so all three platforms find a CLI the same
 * way the boss's own terminal does.
 *
 * Nothing in the script needs a single quote, so the whole of it nests inside one.
 */
export const WSL_PATH_SCRIPT = [
  'shell="$SHELL"',
  '[ -n "$shell" ] || shell=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)',
  `exec "\${shell:-/bin/sh}" -ilc 'printf "${PATH_MARK}%s${PATH_MARK}" "$PATH"'`,
].join('; ')

/**
 * The `PATH` the boss's own shell has inside `distro`, or null when it would not say.
 *
 * Null is every way of not answering — a shell that hung past {@link WSL_PATH_TIMEOUT_MS}, an rc
 * file that failed, a distro that would not start — and every caller reads it the same way: fall
 * back to a login `sh`, which is what the app did before this existed.
 */
export function wslLoginPath(run: WslRunner, distro: string): string | null {
  const outcome = run(['-d', distro, '-e', 'sh', '-c', WSL_PATH_SCRIPT], { timeoutMs: WSL_PATH_TIMEOUT_MS })
  if (outcome.kind !== 'output' && outcome.kind !== 'failed') return null
  const between = new RegExp(`${PATH_MARK}(.*)${PATH_MARK}`).exec(outcome.output.replace(/\0/g, ''))
  return between?.[1]?.trim() || null
}

/**
 * A script with the distro's own `PATH` in front of it: `PATH='/home/b/.local/bin:…'; command -v …`.
 *
 * In front of the script rather than instead of the login shell, so a distro that puts something
 * else in a Session's environment still does — only the `PATH` is replaced, and only when there is
 * a better one to replace it with. A null leaves the script exactly as it was.
 */
export function withDistroPath(script: string, path: string | null | undefined): string {
  return path ? `PATH=${shellQuote(path)}; ${script}` : script
}

/**
 * `/mnt/c/Users/…` — a *Windows* folder, which WSL puts on every distro's `PATH` by default.
 *
 * A Windows npm shim found through it is not this distro's CLI: running it would start the Windows
 * installation from inside Linux, with the Windows login, under a `PATH` of Linux folders. So a hit
 * there is no hit, which is what stops a machine with `claude` only on Windows from reading as
 * "installed in Arch" (T258).
 */
const WINDOWS_MOUNT = /^\/mnt\/[a-z]\//i

/** Where a probe found a command, and what it cost to find out. */
export interface WslProbe {
  distro: string
  /** The command's path inside the distro, or null when it is not there. */
  path: string | null
  /** The probe could not answer: the distro would not start in time, or `wsl.exe` failed. */
  unreachable: boolean
  /** The distro was stopped before this probe, so the probe started it (frame `GacEW`). */
  started: boolean
}

/**
 * Whether `command` is inside `distro`, and where.
 *
 * It is looked for on the `PATH` the boss's own shell in there has, handed in by the caller and read
 * once per distro (T258): a login `sh` reads `/etc/profile` and `~/.profile` and no more, so on any
 * distro that ships no `~/.profile` it misses `~/.local/bin`, nvm, npm-global and bun — every place
 * the three Providers actually install into. `sh -lc` stays underneath, so a distro that does put
 * its CLI on the profile's path is still found when the shell would not answer.
 *
 * `command -v` rather than `which`, because it is a shell builtin: it needs nothing installed and
 * it is what `sh` itself uses. A distro that has to be started to answer is started — that is what
 * the boss's first Session would do anyway — and the probe says so, so the row can.
 */
export function probeWsl(
  run: WslRunner,
  distro: WslDistro,
  command: string,
  loginPath: string | null = null,
): WslProbe {
  const script = withDistroPath(`command -v ${shellQuote(command)}`, loginPath)
  const outcome = run(['-d', distro.name, '-e', 'sh', '-lc', script])
  const started = !distro.running
  if (outcome.kind === 'timeout' || outcome.kind === 'missing') {
    return { distro: distro.name, path: null, unreachable: true, started }
  }
  // A non-zero exit from `command -v` is the answer "not here", not a broken probe. A `wsl.exe`
  // that could not reach the distro at all says so in its own words and prints no path.
  const first = outcome.output
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, '').trim())
    .find((line) => line.startsWith('/') && !WINDOWS_MOUNT.test(line))
  if (first) return { distro: distro.name, path: first, unreachable: false, started }
  const broken = outcome.kind === 'failed' && /wsl\/|0x8007|no installed distributions|WSL/i.test(outcome.output)
  return { distro: distro.name, path: null, unreachable: broken, started }
}

/** One argument for `sh -c`. Nothing TinyCorp probes has a quote in it; the guard is free. */
export function shellQuote(argument: string): string {
  return `'${argument.replace(/'/g, `'\\''`)}'`
}

/**
 * The distros, found once and remembered — the way `cli-command.ts` remembers a `PATH` lookup, and
 * for the same reason: the Providers card asks for every Provider every time it draws, and
 * `wsl.exe -l -v` is a subprocess. `forgetWsl` is what `Check again` calls.
 */
let distroCache: WslDistro[] | null = null
const probeCache = new Map<string, WslProbe>()
const pathCache = new Map<string, string | null>()

/** Every distro, from the cache when it has been asked before. */
export function cachedWslDistros(run: WslRunner): WslDistro[] {
  if (distroCache === null) distroCache = wslDistros(run)
  return distroCache
}

/**
 * The distro's own `PATH`, read once per distro and kept for the rest of the run (T258).
 *
 * Once, because it is an interactive shell with the boss's whole rc file in it — the most expensive
 * thing this file does — and every probe and every Session start in that distro needs the same
 * answer. A shell that did not answer is remembered as *did not answer*, so a hanging `~/.zshrc`
 * costs {@link WSL_PATH_TIMEOUT_MS} once rather than once per Provider, and says so in the log.
 *
 * `Check again` forgets it along with everything else: the boss pressing it means something about
 * this machine changed, and *a folder the rc file now adds* is one of the things it can be.
 */
export function cachedWslLoginPath(
  run: WslRunner,
  distro: string,
  log: (message: string) => void = console.warn,
): string | null {
  const known = pathCache.get(distro)
  if (known !== undefined) return known
  const path = wslLoginPath(run, distro)
  if (path === null) {
    log(
      `WSL: ${distro} did not print its own PATH within ${WSL_PATH_TIMEOUT_MS}ms, so a login sh is used instead — a CLI in ~/.local/bin or under nvm may read as missing there.`,
    )
  }
  pathCache.set(distro, path)
  return path
}

/** One probe, from the cache when this command has been looked for in this distro before. */
export function cachedWslProbe(run: WslRunner, distro: WslDistro, command: string): WslProbe {
  const key = `${distro.name}\u0000${command}`
  const known = probeCache.get(key)
  if (known) return known
  const probe = probeWsl(run, distro, command, cachedWslLoginPath(run, distro.name))
  // A distro that would not answer is not remembered as an answer: the boss starts it and presses
  // Check again, and the next ask has to actually ask.
  if (!probe.unreachable) probeCache.set(key, probe)
  return probe
}

/** Forgets every remembered distro and probe, so the next ask runs `wsl.exe` again. */
export function forgetWsl(): void {
  distroCache = null
  probeCache.clear()
  pathCache.clear()
}
