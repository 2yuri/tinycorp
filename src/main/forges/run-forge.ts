import { execFile } from 'node:child_process'
import type { ForgeCliResult, RunForge } from '../../shared/forges/adapter'
import type { ProviderRuntime } from '../../shared/platform/wsl'
import { cliInvocation, type RunInDeps, runIn } from '../platform'

/**
 * Running a forge's CLI, for real.
 *
 * Every adapter is handed one of these rather than reaching for `child_process` itself, so the
 * conformance suite can hand it a fake instead: no test spawns a forge CLI, touches a network or
 * needs a token.
 *
 * The environment is the app's own, with at most an adapter's settings laid over it (`env`). That
 * is the whole authentication story: the CLI finds the boss's credential where it put it, and
 * TinyCorp never reads it, never copies it and never passes one as an argument.
 */

/** How long a forge command is given before the app stops waiting on it. */
export const FORGE_TIMEOUT_MS = 60_000

/** A PR's patch is far larger than a command's default 1MB buffer. */
export const FORGE_BUFFER = 64 * 1024 * 1024

/** The exit code a command that ran out of time is reported with, as a shell reports one. */
export const TIMED_OUT = 124

export const runForge: RunForge = (
  command,
  args,
  { cwd, maxBuffer = FORGE_BUFFER, timeoutMs = FORGE_TIMEOUT_MS, env, stdin },
) =>
  new Promise<ForgeCliResult>((resolve) => {
    const environment = env ? { ...process.env, ...env } : process.env
    // `gh` and `glab` are `.cmd` shims on a Windows that installed them with npm or scoop, and
    // only `cmd.exe` starts one (T166). Same resolution as every Session's spawn.
    const { file, args: argv, verbatim } = cliInvocation(command, args, environment)
    const child = execFile(
      file,
      argv,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer,
        timeout: timeoutMs,
        ...(env && { env: environment }),
        ...(verbatim && { windowsVerbatimArguments: true }),
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ code: 0, stdout, stderr })
        const failure = error as NodeJS.ErrnoException & { killed?: boolean }
        // Not on this machine, or the folder is gone: there is no exit code to report.
        if (failure.code === 'ENOENT') return resolve({ code: null, stdout, stderr })
        // A timeout is a command that ran and said nothing useful, not a command that is missing.
        if (failure.killed) {
          return resolve({ code: TIMED_OUT, stdout, stderr: stderr || `${command} timed out after ${timeoutMs}ms` })
        }
        resolve({ code: typeof failure.code === 'number' ? failure.code : 1, stdout, stderr })
      },
    )
    // A body too long to be an argument — a review with its line comments — goes in on stdin.
    // A CLI that is not on this machine has no stdin to write to, and that is not a failure here:
    // the callback above already reports it.
    if (stdin !== undefined) {
      child.stdin?.on('error', () => {})
      child.stdin?.end(stdin)
    }
  })

/**
 * The same {@link RunForge}, run **where the team runs** (T259).
 *
 * A forge CLI is not a thing the app can run anywhere it likes. `gh pr create` pushes and reads the
 * checkout it is run in, and a checkout inside a distro is a checkout whose `git` is the distro's: a
 * `gh` on the Windows `PATH` asked about `\\wsl.localhost\Arch\home\b\acme` finds a repo git for
 * Windows refuses to open. It is also two sign-ins — `gh auth login` in Arch and `gh auth login` on
 * Windows are two credentials — so asking the wrong one is how a boss gets told to sign in somewhere
 * they already are, which is the mistake T167 already fixed once for Providers.
 *
 * Where the team runs on Windows, and on every Mac and Linux desktop, this is {@link runForge} and
 * nothing else. `platform` is taken rather than read so a suite on any runner can ask what a Windows
 * boss gets, which is the only way the `wsl.exe` half is testable at all.
 */
export function teamForgeRunner(team: () => ProviderRuntime | null, deps: RunInDeps = {}): RunForge {
  return (command, args, options) => {
    const runtime = team()
    if (runtime?.kind !== 'wsl' || (deps.platform ?? process.platform) !== 'win32') {
      return runForge(command, args, options)
    }
    const { cwd, maxBuffer = FORGE_BUFFER, timeoutMs = FORGE_TIMEOUT_MS, env, stdin } = options
    const runner = runIn(runtime, deps)
    return new Promise<ForgeCliResult>((resolve) => {
      const child = runner.spawn(command, args, {
        cwd,
        ...(env && { env: { ...process.env, ...env } }),
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (result: ForgeCliResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      // `spawn` rather than `execFile`, because `wsl.exe` has to be given the body on stdin and be
      // read for a patch that is tens of megabytes; the buffer and the timeout are kept by hand so
      // the answers are the same three shapes every adapter already reads.
      const timer = setTimeout(() => {
        child.kill()
        finish({ code: TIMED_OUT, stdout, stderr: stderr || `${command} timed out after ${timeoutMs}ms` })
      }, timeoutMs)
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.length > maxBuffer) child.kill()
      })
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk
      })
      // `wsl.exe` itself is missing only on a machine that has no WSL, and the team cannot be in a
      // distro there; what a missing CLI *inside* the distro looks like is the login shell's own
      // `command not found`, which arrives as an exit code like any other.
      child.on('error', () => finish({ code: null, stdout, stderr }))
      child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }))
      if (stdin !== undefined) {
        child.stdin?.on('error', () => {})
        child.stdin?.end(stdin)
      }
    })
  }
}
