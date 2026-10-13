import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const MARK = '__TINYCORP_PATH__'

/**
 * The folders the Provider CLIs are installed into by their own installers, for when the login
 * shell cannot be asked: Claude Code's native installer, Homebrew on both architectures, npm's and
 * bun's global bins.
 *
 * The last three are Linux's own (T177), and they are the ones a desktop launch misses most: a
 * `.desktop` file is started by the session, not by a shell, so nvm's shims, Linuxbrew and a snap
 * are all missing from the `PATH` the app inherits — while the boss's terminal has had them since
 * they installed the CLI.
 */
export function wellKnownBins(home = homedir(), platform: NodeJS.Platform = process.platform): string[] {
  const shared = [
    join(home, '.local', 'bin'),
    '/usr/local/bin',
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
  ]
  return platform === 'linux'
    ? [...shared, '/home/linuxbrew/.linuxbrew/bin', join(home, '.linuxbrew', 'bin'), '/snap/bin']
    : [...shared, '/opt/homebrew/bin']
}

/** The boss's own shell, or the platform's usual one: zsh on a Mac, bash on a Linux desktop. */
export function loginShell(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return env['SHELL'] || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

/** The PATH the boss's login shell prints, or null when it could not be read. */
export function readLoginShellPath(
  shell = loginShell(),
  run: (file: string, args: string[]) => string = (file, args) =>
    execFileSync(file, args, { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] }),
): string | null {
  try {
    // Marks around the value, so whatever an rc file prints on its way in is not taken for it.
    const out = run(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`])
    const match = out.match(new RegExp(`${MARK}(.*)${MARK}`))
    return match?.[1] || null
  } catch {
    return null
  }
}

/** `current`, then the login shell's folders, then the well-known ones, each folder once. */
export function mergePath(current: string | undefined, login: string | null, known: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of [...(current ?? '').split(delimiter), ...(login ?? '').split(delimiter), ...known]) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    out.push(dir)
  }
  return out.join(delimiter)
}

/**
 * A Mac app opened from the Finder or the Dock inherits launchd's PATH — `/usr/bin:/bin:/usr/sbin:
 * /sbin` — not the one the boss's terminal has, so `claude` in `~/.local/bin` and `codex` in
 * Homebrew are not found and the app says they are missing. Before anything looks a CLI up, the
 * PATH is widened with the login shell's own and the installers' usual folders.
 *
 * **A Linux desktop is the same story** (T177): an app started from GNOME's activities overview
 * or a `.desktop` entry is started by the session and inherits `/usr/local/bin:/usr/bin:/bin`,
 * with none of what `~/.profile`, nvm or `~/.bashrc` added. So this runs there too, with that
 * boss's own `$SHELL` — bash as often as zsh — rather than a hard-coded zsh.
 *
 * Windows is the exception, and only Windows: a GUI app there already gets the user's own `PATH`.
 */
export function adoptLoginShellPath({
  env = process.env,
  platform = process.platform,
  home = homedir(),
  /** Asking the shell. Injected so a test can say what it answered without starting one. */
  readPath = readLoginShellPath,
}: {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  readPath?: (shell: string) => string | null
} = {}): void {
  if (platform === 'win32') return
  env['PATH'] = mergePath(env['PATH'], readPath(loginShell(env, platform)), wellKnownBins(home, platform))
}
