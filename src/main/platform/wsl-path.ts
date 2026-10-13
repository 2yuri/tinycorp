/**
 * The two names every file has when a Provider runs inside WSL (T167).
 *
 * The app is a Windows process: it writes an MCP config to `C:\Users\b\AppData\…`, it opens a
 * worktree at `D:\code\acme`, and everything it hands a Session is spelled that way. The CLI is a
 * Linux process in a distro, where those same bytes are at `/mnt/c/Users/b/AppData/…` and
 * `/mnt/d/code/acme`. Hand the Linux side a Windows path and it opens nothing at all — silently,
 * because `--mcp-config C:\…` is a file that is simply not there.
 *
 * So every path that crosses the boundary is translated: the cwd, the arguments, and the paths
 * written inside the files the adapters write. `wslpath` inside the distro is the authority and
 * {@link wslPathVia} asks it; {@link toLinuxPath} and {@link toWindowsPath} are the same answer as
 * a pure function, for the times there is no distro to ask — a test, a probe that timed out, an
 * argument being built before anything has been started.
 *
 * Two shapes go each way:
 *
 * - a drive, `C:\Users\b\x` ↔ `/mnt/c/Users/b/x`, and `/mnt/c` is a default `automount.root` that
 *   a `wsl.conf` can move, which is the one case only `wslpath` gets right;
 * - the distro's own filesystem, reached from Windows over UNC as `\\wsl$\Ubuntu\home\b\x` or
 *   `\\wsl.localhost\Ubuntu\home\b\x`, and from inside simply `/home/b/x`.
 *
 * A UNC path naming a *different* distro is not translated at all: `\\wsl.localhost\Debian\home\b`
 * is Debian's `/home/b`, and inside Ubuntu that path means something else or nothing. The caller
 * gets null and leaves the argument as it was, so a wrong file is never opened in place of a
 * missing one.
 */

/** The prefix a drive is mounted under in a distro nobody has reconfigured. */
export const DEFAULT_AUTOMOUNT_ROOT = '/mnt'

/** The UNC prefixes Windows reaches a distro's own filesystem through, newest first. */
export const WSL_UNC_PREFIXES = ['\\\\wsl.localhost\\', '\\\\wsl$\\'] as const

/** `\\wsl.localhost\Ubuntu\home\b` or `\\wsl$\Ubuntu\home\b`, with the distro and the rest. */
const WSL_UNC = /^\\\\wsl(?:\.localhost|\$)\\([^\\/]+)(?:[\\/](.*))?$/i

/** `C:\Users\b`, `c:/Users/b`, `C:` — a drive letter and whatever follows it. */
const DRIVE = /^([A-Za-z]):(?:[\\/](.*))?$/

/** `/mnt/c/Users/b`, `/mnt/c` — a mounted drive under the automount root. */
function mounted(path: string, root: string): { letter: string; rest: string } | null {
  const prefix = `${root}/`
  if (!path.toLowerCase().startsWith(prefix.toLowerCase())) return null
  const after = path.slice(prefix.length)
  const match = /^([A-Za-z])(?:\/(.*))?$/.exec(after)
  return match ? { letter: match[1]!.toLowerCase(), rest: match[2] ?? '' } : null
}

export interface WslPathOptions {
  /** The distro the Linux side of the translation is inside. */
  distro: string
  /** What `automount.root` is in that distro's `wsl.conf`. Defaults to `/mnt`. */
  automountRoot?: string
}

/**
 * What `path` is called inside `distro`, or null when it is called nothing there: a UNC path into
 * another distro, or something that is not a Windows path at all.
 *
 * A path that is already absolute POSIX is handed straight back. That is not a guess — the only
 * paths TinyCorp builds are Windows ones, so a `/home/b/x` reaching here came from the distro in
 * the first place (a `wslpath` answer, a config the CLI itself wrote) and is already what it
 * should be.
 */
export function toLinuxPath(
  path: string,
  { distro, automountRoot = DEFAULT_AUTOMOUNT_ROOT }: WslPathOptions,
): string | null {
  if (path === '') return null
  const unc = WSL_UNC.exec(path)
  if (unc) {
    if (unc[1]!.toLowerCase() !== distro.toLowerCase()) return null
    return `/${slashes(unc[2] ?? '')}`.replace(/\/+$/, '') || '/'
  }
  const drive = DRIVE.exec(path)
  if (drive) {
    const rest = slashes(drive[2] ?? '')
    return rest ? `${automountRoot}/${drive[1]!.toLowerCase()}/${rest}` : `${automountRoot}/${drive[1]!.toLowerCase()}`
  }
  if (path.startsWith('/')) return path
  return null
}

/**
 * What `path` inside `distro` is called from Windows, or null when it is not an absolute path
 * inside one. A mounted drive comes back as that drive; anything else is the distro's own
 * filesystem, which Windows reaches over UNC — `\\wsl.localhost\`, the spelling every supported
 * Windows understands.
 */
export function toWindowsPath(
  path: string,
  { distro, automountRoot = DEFAULT_AUTOMOUNT_ROOT }: WslPathOptions,
): string | null {
  if (!path.startsWith('/')) return null
  const drive = mounted(path, automountRoot)
  if (drive) return `${drive.letter.toUpperCase()}:\\${drive.rest.replace(/\//g, '\\')}`
  return `${WSL_UNC_PREFIXES[0]}${distro}${path.replace(/\//g, '\\')}`
}

/** Back- and forward-slashes alike separate a Windows path; the Linux side has only one. */
function slashes(rest: string): string {
  return rest.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
}

/**
 * Whether `path` is a folder inside a distro's own filesystem, reached over UNC — the shape the
 * app's own git has to be careful with, because the owner of every file under it is a Linux uid
 * Windows has never heard of. Returns the distro when it is one, and null when it is not.
 */
export function wslUncDistro(path: string): string | null {
  return WSL_UNC.exec(path)?.[1] ?? null
}

/**
 * One argument, with the Windows path in it translated — and nothing else touched.
 *
 * An argument is translated when it *is* a path (`--mcp-config` is followed by one), or when it is
 * `key=<path>` or `key="<path>"`, which is how a product that takes config overrides on the
 * command line is handed one.
 *
 * Nothing else, and that limit is the whole point. An earlier version rewrote any `X:\…` it found
 * anywhere inside an argument, and a Provider that carries the Employee's instructions in
 * `-c key="…"` has escape sequences in that text: `shaped like:\n` reads as the drive `e:` followed
 * by `\n`, and the instructions came out with a `/mnt/e/` in the middle of a sentence. A path
 * TinyCorp passes is always a whole argument or a whole value, so that is all that is looked at.
 */
export function translatePaths(argument: string, options: WslPathOptions): string {
  const whole = windowsPath(argument, options)
  if (whole !== null) return whole
  const setting = /^([^=\s"']{1,120}=)(.*)$/s.exec(argument)
  if (!setting) return argument
  const [, key, raw] = setting
  const quote =
    raw!.length > 1 && (raw!.startsWith('"') || raw!.startsWith("'")) && raw!.endsWith(raw![0]!) ? raw![0]! : ''
  const value = quote ? raw!.slice(1, -1) : raw!
  const translated = windowsPath(value, options)
  return translated === null ? argument : `${key}${quote}${translated}${quote}`
}

/** `text` as a Linux path when the whole of it is a Windows one, and null when it is not. */
function windowsPath(text: string, options: WslPathOptions): string | null {
  if (!ABSOLUTE.test(text)) return null
  return toLinuxPath(text, options)
}

/**
 * A whole argument that is an absolute Windows path: a drive or a UNC share, and then anything a
 * filename may hold. The characters Windows forbids in one — `<>|"*?` and a newline — end it, so a
 * sentence that happens to start with a letter and a colon is not mistaken for a path.
 */
const ABSOLUTE = /^(?:\\\\[^\\/:*?"<>|\r\n]+\\[^:*?"<>|\r\n]*|[A-Za-z]:[\\/][^:*?"<>|\r\n]*)$/

/**
 * The inverse of {@link translatePaths}: every `/mnt/<letter>/…` back to its drive.
 *
 * Only the mounted-drive shape, and deliberately so. A path under the distro's own filesystem has
 * no Windows spelling that is the same folder in any useful sense, and a `/home/b/x` that came out
 * of the distro should stay what it is. This exists so a test can read back what an adapter
 * *meant* before the runtime translated it, and say the same thing on a Mac and on Windows.
 */
export function untranslatePaths(argument: string, options: WslPathOptions): string {
  const root = options.automountRoot ?? DEFAULT_AUTOMOUNT_ROOT
  const back = (text: string): string | null => {
    if (!text.startsWith(`${root}/`)) return null
    return toWindowsPath(text, options)
  }
  const whole = back(argument)
  if (whole !== null) return whole
  const setting = /^([^=\s"']{1,120}=)(.*)$/s.exec(argument)
  if (!setting) return argument
  const [, key, raw] = setting
  const quote =
    raw!.length > 1 && (raw!.startsWith('"') || raw!.startsWith("'")) && raw!.endsWith(raw![0]!) ? raw![0]! : ''
  const value = quote ? raw!.slice(1, -1) : raw!
  const translated = back(value)
  return translated === null ? argument : `${key}${quote}${translated}${quote}`
}

/** Runs `wslpath` inside a distro. Injected, so nothing in a test starts one. */
export type WslPathRunner = (args: readonly string[]) => string | null

/**
 * What `path` is called on the other side, asked of the distro itself.
 *
 * `wslpath -u` and `wslpath -w` know things a pure function cannot: an `automount.root` moved in
 * `wsl.conf`, a drive mounted somewhere unusual, a symlink in the middle. So it is asked first and
 * {@link toLinuxPath} is what answers when it cannot be — a stopped distro, a probe that timed
 * out, a `wslpath` that is not on this distro's PATH.
 */
export function wslPathVia(
  run: WslPathRunner,
  path: string,
  direction: 'linux' | 'windows',
  options: WslPathOptions,
): string | null {
  const answered = run([direction === 'linux' ? '-u' : '-w', path])?.trim()
  if (answered) return answered
  return direction === 'linux' ? toLinuxPath(path, options) : toWindowsPath(path, options)
}
