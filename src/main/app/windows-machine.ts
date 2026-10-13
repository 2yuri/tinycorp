import type { GitBashCheck } from '../../shared/platform/git-bash'
import { NO_WINDOWS_MACHINE, type WindowsMachine } from '../../shared/platform/windows-machine'
import { findGitBash, type WslDistro } from '../platform'

/**
 * What this Windows is, for the first-launch step and for Your profile (T249).
 *
 * Both readings are already paid for: the distros come from the same cached `wsl.exe -l -v` the
 * Providers card was drawn from, so asking wakes nothing, and Git Bash is a walk of `PATH` and
 * three `stat` calls. Off Windows it looks at neither.
 */
export interface WindowsMachineOptions {
  platform?: NodeJS.Platform
  /** Every distro this machine has, the default first — `ProviderRuntimes.distros`. */
  distros: () => readonly WslDistro[]
  /** Git for Windows' `bash.exe`. Injected, so a test needs no Windows. */
  gitBash?: () => GitBashCheck
}

export function readWindowsMachine({
  platform = process.platform,
  distros,
  gitBash = () => findGitBash({ platform }),
}: WindowsMachineOptions): WindowsMachine {
  if (platform !== 'win32') return NO_WINDOWS_MACHINE
  return {
    windows: true,
    distros: distros().map((distro) => ({ name: distro.name, default: distro.default })),
    gitBash: gitBash(),
  }
}
