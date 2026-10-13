import { spawn } from 'node:child_process'
import { ENV_RUN_MAX_BYTES, ENV_RUN_TIMEOUT_MS } from '../../../shared/environments'
import { createRedactor, type RedactableValue } from '../../../shared/platform/redaction'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import { shellInvocation } from '../../platform'

/**
 * Running one command with an Environment's values in it (T176).
 *
 * The values are in **this** child process and nowhere else: not in the Employee's Session, not in
 * its shell, not in a file in the worktree. What comes back is the exit code and both streams with
 * every value already swapped for `‹NAME›` — redacted as each chunk arrives, so a value cut in
 * half by a pipe boundary is still caught, and so a value never sits in a buffer waiting to be
 * filtered later.
 *
 * It is time-boxed, cancellable and bounded. A `pnpm dev` an Employee starts here would otherwise
 * hold the app open until the boss noticed.
 *
 * Where it runs is `shell-command.ts`'s to say: `/bin/sh -c` on macOS and Linux, `%ComSpec% /d /s
 * /c` on Windows, and `wsl.exe … sh -c` inside the distro when that is where the Employee's
 * Provider lives — with the values named in `WSLENV` so they cross with it (T166, T167).
 */

export interface EnvRunInput {
  command: string
  cwd: string
  /** The variables to inject. These are the only ones the child gets beyond the app's own. */
  values: readonly RedactableValue[]
  /** The app's environment the command starts from. Defaults to this process's. */
  base?: NodeJS.ProcessEnv
  /** The Employee's Provider runtime; a WSL one runs the command inside that distro. */
  runtime?: ProviderRuntime | null
  platform?: NodeJS.Platform
  timeoutMs?: number
  maxBytes?: number
  /** Cancels the run: the child is killed and what it printed so far comes back. */
  signal?: AbortSignal
}

export interface EnvRunOutcome {
  /** Null when the command was killed by a signal, a timeout or a cancel. */
  exitCode: number | null
  /** Redacted. */
  stdout: string
  /** Redacted. */
  stderr: string
  /** How many values were swapped out of both streams. */
  redacted: number
  timedOut: boolean
  cancelled: boolean
  /** True when either stream hit the byte cap and the rest was dropped. */
  truncated: boolean
}

/** Spawns the command. Injected so a test runs no real process. */
export type SpawnCommand = typeof spawn

/**
 * Runs `command` through the platform's shell with `values` in its environment, and answers with
 * redacted output. Never rejects: a command that could not start is an outcome with its message on
 * `stderr`, because that is what the Employee needs to read.
 */
export async function runWithEnvironment({
  command,
  cwd,
  values,
  base = process.env,
  runtime = null,
  platform = process.platform,
  timeoutMs = ENV_RUN_TIMEOUT_MS,
  maxBytes = ENV_RUN_MAX_BYTES,
  signal,
  spawnCommand = spawn,
}: EnvRunInput & { spawnCommand?: SpawnCommand }): Promise<EnvRunOutcome> {
  const withValues: NodeJS.ProcessEnv = { ...base }
  for (const { name, value } of values) withValues[name] = value
  const invocation = shellInvocation(command, { cwd, runtime, platform, env: withValues })

  const out = stream(values, maxBytes)
  const err = stream(values, maxBytes)
  let timedOut = false
  let cancelled = false

  return await new Promise<EnvRunOutcome>((resolve) => {
    let child: ReturnType<SpawnCommand>
    try {
      child = spawnCommand(invocation.file, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.env,
        ...(invocation.verbatim && { windowsVerbatimArguments: true }),
      })
    } catch (error) {
      return resolve({
        exitCode: null,
        stdout: '',
        stderr: message(error),
        redacted: 0,
        timedOut: false,
        cancelled: false,
        truncated: false,
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child, platform, spawnCommand)
    }, timeoutMs)
    const cancel = () => {
      cancelled = true
      killTree(child, platform, spawnCommand)
    }
    signal?.addEventListener('abort', cancel, { once: true })

    let settled = false
    const done = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      resolve({
        // A command we stopped has no exit code of its own: Windows reports 1 for a killed tree,
        // POSIX null, and neither is what the command said.
        exitCode: timedOut || cancelled ? null : exitCode,
        stdout: out.end(),
        stderr: err.end(),
        redacted: out.redacted() + err.redacted(),
        timedOut,
        cancelled,
        truncated: out.truncated || err.truncated,
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    // A command that cannot start (a missing binary, a cwd that is gone) never emits `close`.
    child.on('error', (error) => {
      err.push(Buffer.from(`${message(error)}\n`))
      done(null)
    })
    child.on('close', (code) => done(code))
    // `close` waits for every pipe, and a grandchild that outlived the shell still holds one —
    // which on Windows is how a killed `cmd.exe` leaves a promise that never settles. `exit` says
    // the command is over; the grace is for the last chunk still in flight.
    child.on('exit', (code) => setTimeout(() => done(code), EXIT_GRACE_MS))
  })
}

/** How long after `exit` the streams get to finish before the answer goes without them. */
const EXIT_GRACE_MS = 250

/**
 * Ends the command. On Windows the child is `cmd.exe` and the work is its grandchild, so killing
 * the shell alone leaves `pnpm dev` running: `taskkill /t /f` is what ends the tree there.
 */
function killTree(child: ReturnType<SpawnCommand>, platform: NodeJS.Platform, spawnCommand: SpawnCommand): void {
  if (platform === 'win32' && child.pid !== undefined) {
    try {
      spawnCommand('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      return
    } catch {
      // `taskkill` is not there, or refused: fall through to what Node can do by itself.
    }
  }
  child.kill('SIGKILL')
}

/** One redacted, bounded stream. The redactor sees every chunk before anything is kept. */
function stream(values: readonly RedactableValue[], maxBytes: number) {
  const redactor = createRedactor(values)
  let held = ''
  let bytes = 0
  let truncated = false
  let ended = false
  return {
    get truncated() {
      return truncated
    },
    push(chunk: Buffer) {
      if (ended) return
      const safe = redactor.push(chunk.toString('utf8'))
      if (bytes + safe.length > maxBytes) {
        held += safe.slice(0, Math.max(0, maxBytes - bytes))
        bytes = maxBytes
        truncated = true
        return
      }
      held += safe
      bytes += safe.length
    },
    end(): string {
      if (ended) return held
      ended = true
      const rest = redactor.end()
      const room = Math.max(0, maxBytes - bytes)
      if (rest.length > room) truncated = true
      held += rest.slice(0, room)
      bytes += Math.min(rest.length, room)
      if (truncated) held += '\n… output cut off here.'
      return held
    },
    redacted: () => redactor.count,
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
