import type { ProviderRuntime } from '../../shared/platform/wsl'
import { type CliInvocation, comSpec } from './cli-command'
import { isWsl, WSL_COMMAND, wslCommand, wslEnv } from './wsl-runtime'

/**
 * Starting **one command line** — `pnpm db:migrate`, a repo's run command — on whichever of the
 * three platforms the boss is on, and inside a WSL distro when that is where the Employee's
 * Provider lives (T166, T167, T176).
 *
 * `cli-command.ts` answers the neighbouring question: how to start a *named CLI* with arguments.
 * This one is for a line the boss or an Employee wrote, which is a shell's to parse — so the
 * shell is named per platform rather than left to `spawn`'s `shell: true`:
 *
 * - POSIX: `/bin/sh -c '<line>'`, the same shell a terminal would give it.
 * - Windows: `%ComSpec% /d /s /c "<line>"`, with `windowsVerbatimArguments`, which is the form
 *   `cli-command.ts` already uses for a `.cmd` shim — `/d` skips a machine's AutoRun and `/s`
 *   fixes how the outer quotes are read.
 * - WSL: `wsl.exe -d <distro> --cd <linux cwd> -e sh -lc 'exec "$0" "$@"' sh -c '<line>'`, through
 *   `wslCommand`, so the cwd and any Windows path inside the line are translated and the distro's
 *   own login shell is what runs it.
 */

/** Where a command line runs: this machine, or inside a distro. */
export interface ShellPlace {
  /** The folder it runs in, as this platform spells it. */
  cwd: string
  /** The Employee's Provider runtime; a WSL one puts the command inside that distro. */
  runtime?: ProviderRuntime | null
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

/** How to spawn `line`, and the environment to spawn it with. */
export interface ShellInvocation extends CliInvocation {
  /** The cwd to hand `spawn`. For WSL it is the Windows one: `--cd` carries the distro's. */
  cwd: string
  /** The environment, with `WSLENV` added when variables have to cross into a distro. */
  env: NodeJS.ProcessEnv
}

/**
 * The invocation for one command line. `env` is the whole environment the command gets; for a WSL
 * run, whatever the app added to it is named in `WSLENV` so it reaches the Linux process — without
 * that, an injected `DATABASE_URL` would simply not be there on the other side.
 */
export function shellInvocation(
  line: string,
  { cwd, runtime, platform = process.platform, env = process.env }: ShellPlace,
): ShellInvocation {
  if (isWsl(runtime)) {
    const args = wslCommand({ distro: runtime.distro, cwd, command: 'sh', args: ['-c', line] })
    return { file: WSL_COMMAND, args, verbatim: false, cwd, env: wslEnv(asRecord(env), process.env) }
  }
  if (platform === 'win32') {
    return { file: comSpec(env), args: ['/d', '/s', '/c', `"${line}"`], verbatim: true, cwd, env }
  }
  return { file: '/bin/sh', args: ['-c', line], verbatim: false, cwd, env }
}

/** `process.env` has optional values; everything the app puts in one is a string. */
function asRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string>
}
