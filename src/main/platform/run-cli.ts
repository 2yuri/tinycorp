import { execFile } from 'node:child_process'
import { cliInvocation } from './cli-command'

/**
 * Running a Provider's CLI to ask it a question — never to do work with it.
 *
 * The preflight (T135) is the only caller: it asks each Provider in use whether it is signed in,
 * once, on start. That is a subprocess with a timeout around it, injected everywhere it is used so
 * no test and no render path ever spawns anything, and it may never spend the boss's subscription.
 */

/** How long a CLI is given to answer before the app stops waiting on it and draws anyway. */
export const CLI_TIMEOUT_MS = 8_000

/**
 * What running a CLI did. A missing command and a command that answered are different sentences on
 * the Launcher, so they are different answers here; a timeout and a failure are not — both mean the
 * app found the command and got nothing readable out of it.
 */
export type CliOutcome =
  | { kind: 'output'; code: number; output: string }
  | { kind: 'missing' }
  | { kind: 'timeout' }
  | { kind: 'failed' }

export interface RunCliOptions {
  /** The environment the command runs in. The caller cleans it the way it cleans a Session's. */
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

/** Runs a CLI and reports what it said. Adapters take one so tests never spawn a real product. */
export type RunCli = (command: string, args: readonly string[], options?: RunCliOptions) => Promise<CliOutcome>

/** The real thing: the command, with a timeout around it, and both its streams read back. */
export const runCli: RunCli = (command, args, { env = process.env, timeoutMs = CLI_TIMEOUT_MS } = {}) =>
  new Promise((resolve) => {
    // The same resolution every Session's spawn goes through (T166): on Windows a Provider is
    // often a `.cmd` shim, which only `cmd.exe` starts, and the preflight must ask the very
    // command a Session would run rather than one that looks like it.
    const { file, args: argv, verbatim } = cliInvocation(command, args, env)
    execFile(
      file,
      argv,
      { env, encoding: 'utf8', timeout: timeoutMs, ...(verbatim && { windowsVerbatimArguments: true }) },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`
        if (!error) return resolve({ kind: 'output', code: 0, output })
        const failure = error as NodeJS.ErrnoException & { killed?: boolean }
        if (failure.code === 'ENOENT') return resolve({ kind: 'missing' })
        if (failure.killed) return resolve({ kind: 'timeout' })
        // A non-zero exit still printed something worth reading: the CLI said it is signed out.
        if (!output.trim()) return resolve({ kind: 'failed' })
        resolve({ kind: 'output', code: typeof failure.code === 'number' ? failure.code : 1, output })
      },
    )
  })
