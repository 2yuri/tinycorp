/**
 * Whether a path names a place on the disk rather than a piece of one, on every platform the app
 * runs on (T166).
 *
 * `node:path`'s `isAbsolute` already answers this, and the main process uses it. This exists
 * because the same rule has to hold in the renderer, where there is no `node:path` — the dialog
 * the boss types into and the process that never trusts what it was given must agree, or the boss
 * is refused by one and accepted by the other.
 *
 * A Windows path is absolute two ways: a drive (`C:\Users\boss`) and a UNC share (`\\nas\team`).
 * Reading only the leading `/` is what stopped a Windows boss adding a skill folder at all.
 */
export function isAbsolutePath(path: string): boolean {
  const trimmed = path.trim()
  return trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(trimmed)
}

/**
 * The flavour of `node:path` that spells `path` — decided by the path, not by the machine (T259).
 *
 * The app holds paths from two filesystems at once now. A worktree is `D:\code\acme` or
 * `\\wsl.localhost\Arch\home\b\acme` to this Windows process, and `/home/b/acme` to the Employee
 * inside the distro; the boss's Mac has only the POSIX kind. `node:path`'s own functions answer for
 * the machine they run on, so `resolve('/home/b/acme')` on Windows hands back `C:\home\b\acme` — a
 * folder in nobody's worktree, which is how `env_run` came to refuse every command an Employee in a
 * distro could send.
 *
 * So the *shape* chooses: a drive or a UNC share is `win32`, a leading `/` is `posix`, and anything
 * relative is left to the machine, because a relative path only ever means "from here".
 */
export function pathFlavour(path: string): 'win32' | 'posix' | 'native' {
  const trimmed = path.trim()
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) return 'win32'
  return trimmed.startsWith('/') ? 'posix' : 'native'
}
