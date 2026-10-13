import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type GitBashCheck, NO_GIT_BASH_CHECK } from '../../shared/platform/git-bash'
import { resolveCli } from './cli-command'

/**
 * Finding Git for Windows' `bash.exe` on this machine (T249). `src/shared/platform/git-bash.ts`
 * says why it matters and holds the words; this is the looking.
 *
 * Two places, in this order:
 *
 * 1. the Windows `PATH`, through T166's resolver — which is where it is when the installer's
 *    "Git from the command line" option was taken, and where the boss's own shell finds it;
 * 2. the folders the installer uses when it was not: the two `Program Files`, and the per-user
 *    install under `%LOCALAPPDATA%`.
 *
 * What is **not** Git Bash is `bash.exe` in the Windows system folder. That file is on every
 * machine with WSL enabled and it is the distro launcher, not a shell for the Windows side; a
 * check that accepted it would report success on exactly the machines this exists to warn.
 *
 * Off Windows it looks at nothing and says nothing was found: a Mac's `bash` is not the thing
 * being asked about, and printing a row about it would be noise on a machine that has no problem.
 */

/** The folders Git for Windows installs into, relative to an environment variable. */
const INSTALL_ROOTS = [
  { variable: 'ProgramFiles', fallback: 'C:\\Program Files' },
  { variable: 'ProgramFiles(x86)', fallback: 'C:\\Program Files (x86)' },
  { variable: 'LOCALAPPDATA', folder: 'Programs' },
] as const

/** Where under an install root `bash.exe` sits. `usr\bin` is the same shell, from the msys tree. */
const BASH_PATHS = [join('Git', 'bin', 'bash.exe'), join('Git', 'usr', 'bin', 'bash.exe')]

/** What the card prints for the `PATH` it walked (frame `QFh5u`). */
export const GIT_BASH_PATH_LOOKED_IN = 'PATH'

export interface GitBashOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Whether a path is a file this machine has. Injected, so a test needs no Windows. */
  exists?: (path: string) => boolean
  /** Whether a command is on the Windows `PATH` — T166's resolver by default. */
  onPath?: (command: string) => string | null
}

/**
 * Git for Windows' `bash.exe`, or null when this machine has none. Costs a few `stat` calls and
 * starts nothing.
 */
export function findGitBash({
  platform = process.platform,
  env = process.env,
  exists = isFile,
  onPath = (command) => resolveCli(command, env, platform),
}: GitBashOptions = {}): GitBashCheck {
  if (platform !== 'win32') return NO_GIT_BASH_CHECK
  const lookedIn: string[] = [GIT_BASH_PATH_LOOKED_IN]
  const onWindowsPath = onPath('bash')
  if (onWindowsPath && !isSystemBash(onWindowsPath)) return { path: onWindowsPath, lookedIn }
  for (const root of installRoots(env)) {
    for (const tail of BASH_PATHS) {
      const candidate = join(root, tail)
      // The folder, not the file: it is what the boss checks in Explorer, and what the row prints.
      lookedIn.push(dirname(candidate))
      if (exists(candidate)) return { path: candidate, lookedIn }
    }
  }
  return { path: null, lookedIn }
}

/** The install roots this machine really has, in the order they are looked in. */
function installRoots(env: NodeJS.ProcessEnv): string[] {
  return INSTALL_ROOTS.flatMap((root) => {
    const base = variable(env, root.variable) || ('fallback' in root ? root.fallback : '')
    if (!base) return []
    return ['folder' in root ? join(base, root.folder) : base]
  })
}

/**
 * Whether this is the WSL launcher rather than a shell. Windows keeps it in the system folder,
 * which `%SystemRoot%` names and which `System32` and its 32-bit twin sit under; the name is
 * matched rather than the variable, because a machine whose `%SystemRoot%` is unset still has one.
 */
function isSystemBash(path: string): boolean {
  return /[\\/](system32|syswow64)[\\/]/i.test(path)
}

/** One environment variable by whatever case this Windows spells it in (see `cli-command.ts`). */
function variable(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const exact = env[name]
  if (exact !== undefined) return exact
  const found = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase())
  return found === undefined ? undefined : env[found]
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
