import { spawn } from 'node:child_process'
import type { DatabaseSync } from 'node:sqlite'
import { createRedactor, type RedactableValue } from '../../../shared/platform/redaction'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import { type AppRun, localUrl, type RunnableRepo } from '../../../shared/testing'
import { ticketCodeIn } from '../../core'
import { shellInvocation } from '../../platform'
import type { CodeFlow } from '../code'
import { createTestingSettings } from './test-settings'

/** How many lines of a run's output the app keeps. Older lines fall off the top. */
export const RUN_LOG_LINES = 500

/** One running command, as the engine holds it. The default is `node:child_process`. */
export interface RunProcess {
  /** Called with every chunk of stdout and stderr, as text. */
  onOutput(listener: (chunk: string) => void): void
  /** Called once, when the command is over. */
  onExit(listener: (code: number | null) => void): void
  /** Ends it. Called again on a process that already left, it does nothing. */
  kill(): void
}

/** Starts a run command. Injected so nothing in a test ever starts a real dev server. */
export type SpawnRun = (input: {
  command: string
  cwd: string
  /** The environment's values, when the repo has a default environment (T176). */
  values?: readonly RedactableValue[]
  /** Where the command runs: a WSL runtime puts it inside that distro (T167). */
  runtime?: ProviderRuntime | null
}) => RunProcess

/**
 * The default: the repo's own command line, in the ticket's worktree, through the shell of
 * whichever platform this is — `shell-command.ts` says which, so `pnpm dev` means what it means in
 * a terminal on a Mac, on Windows and inside a distro. Its output is what the Log pane shows.
 */
export const spawnRunCommand: SpawnRun = ({ command, cwd, values = [], runtime = null }) => {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const { name, value } of values) env[name] = value
  const invocation = shellInvocation(command, { cwd, runtime, env })
  const child = spawn(invocation.file, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(invocation.verbatim && { windowsVerbatimArguments: true }),
  })
  return {
    onOutput(listener) {
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => listener(chunk))
      child.stderr?.on('data', (chunk: string) => listener(chunk))
    },
    onExit(listener) {
      child.on('exit', (code) => listener(code))
      child.on('error', () => listener(null))
    },
    kill() {
      child.kill()
    },
  }
}

/** The apps a Company has running for its tickets in Testing. */
export interface AppRuns {
  /** Every repo of the ticket that can be run, with its run when one is up. */
  runnable(ticketId: number): RunnableRepo[]
  /** The runs of one ticket, running or just exited. */
  of(ticketId: number): AppRun[]
  /** Starts the repo's run command in the ticket's worktree. Throws with the reason when it cannot. */
  start(input: { ticketId: number; repoId: string; actorId: string }): AppRun
  /** Stops it. Throws when nothing of that repo is running for the ticket. */
  stop(ticketId: number, repoId: string): AppRun
  /** The run's output, oldest line first. */
  log(ticketId: number, repoId: string): string[]
  /** Kills every run of a ticket, e.g. when it leaves Testing. Silent when it has none. */
  stopTicket(ticketId: number): void
  /** Kills the runs of every ticket not in this list, which is how leaving Testing stops an app. */
  stopUnless(ticketIds: readonly number[]): void
  /** Kills everything this Company has running, on close and on quit. */
  stopAll(): void
  onChange(listener: () => void): () => void
}

export interface AppRunsOptions {
  db: DatabaseSync
  /** The ticket's worktrees, which is where a run command runs. */
  code: Pick<CodeFlow, 'of'>
  spawnRun?: SpawnRun
  /**
   * The values `Run it` runs with, for a repo whose default environment is available to checks
   * (T176). They go into the child process and are redacted out of every line the Log pane keeps.
   */
  environment?: (repoId: string) => readonly RedactableValue[]
  /** Where the command runs, when a Provider of this Company lives in a distro (T167). */
  runtime?: () => ProviderRuntime | null
  log(line: string): void
}

interface Live {
  run: AppRun
  process: RunProcess
  lines: string[]
}

/**
 * The `Run it` processes of one Company (T174).
 *
 * Nothing here starts by itself: a run begins when the boss presses Run it or the QA agent calls
 * `test_run_app`, and it ends on Stop, when the ticket leaves Testing, or when the app quits. Two
 * runs that would answer on the same port are refused before either is started, because the second
 * one would either fail in a way only its log shows or, worse, quietly serve the first one's app.
 */
export function createAppRuns({
  db,
  code,
  spawnRun = spawnRunCommand,
  environment = () => [],
  runtime = () => null,
  log,
}: AppRunsOptions): AppRuns {
  const live = new Map<string, Live>()
  const listeners = new Set<() => void>()
  const settings = createTestingSettings(db)

  const keyOf = (ticketId: number, repoId: string) => `${ticketId}:${repoId}`

  function changed(): void {
    for (const listener of listeners) listener()
  }

  function repo(id: string): { name: string } | undefined {
    return db.prepare('SELECT name FROM repo WHERE id = ?').get(id) as { name: string } | undefined
  }

  function repoName(id: string): string {
    return repo(id)?.name ?? 'removed repo'
  }

  function runnable(ticketId: number): RunnableRepo[] {
    return code.of(ticketId).worktrees.flatMap((worktree) => {
      const rule = settings.ofRepo(worktree.repoId)
      if (!rule.runCommand) return []
      return [
        {
          repoId: worktree.repoId,
          repoName: repoName(worktree.repoId),
          command: rule.runCommand,
          cwd: worktree.path,
          port: rule.port,
          url: rule.port === null ? null : localUrl(rule.port),
          run: live.get(keyOf(ticketId, worktree.repoId))?.run ?? null,
        },
      ]
    })
  }

  /** Whoever else is already answering on `port`, or null. */
  function holderOf(port: number, ticketId: number, repoId: string): Live | null {
    for (const entry of live.values()) {
      const { run } = entry
      if (run.state !== 'running' || run.port !== port) continue
      if (run.ticketId === ticketId && run.repoId === repoId) continue
      return entry
    }
    return null
  }

  function record(entry: Live, line: string): void {
    entry.lines.push(line)
    if (entry.lines.length > RUN_LOG_LINES) entry.lines.splice(0, entry.lines.length - RUN_LOG_LINES)
    entry.run = { ...entry.run, lastLine: line, lines: entry.lines.length }
  }

  function kill(entry: Live): void {
    try {
      entry.process.kill()
    } catch (error) {
      log(`Could not stop ${entry.run.command} in ${entry.run.cwd}: ${String(error)}`)
    }
  }

  return {
    runnable,
    of: (ticketId) => runnable(ticketId).flatMap((r) => (r.run ? [r.run] : [])),

    start({ ticketId, repoId, actorId }) {
      const target = runnable(ticketId).find((r) => r.repoId === repoId)
      if (!target) {
        const known = repo(repoId)
        throw new Error(
          known
            ? `${known.name} has no run command and no worktree for ${ticketCodeIn(db, ticketId)}. ` +
                'Set one in Company settings → Testing.'
            : 'There is no such repo in this Company',
        )
      }
      if (target.run?.state === 'running') {
        throw new Error(`${target.repoName} is already running for ${ticketCodeIn(db, ticketId)}`)
      }
      if (target.port !== null) {
        const clash = holderOf(target.port, ticketId, repoId)
        if (clash) {
          throw new Error(
            `Port ${target.port} is already taken by ${clash.run.repoName} running for ` +
              `${ticketCodeIn(db, clash.run.ticketId)}. Stop that one, or give one of the two repos another port.`,
          )
        }
      }
      const run: AppRun = {
        ticketId,
        repoId,
        repoName: target.repoName,
        command: target.command,
        cwd: target.cwd,
        port: target.port,
        url: target.url,
        state: 'running',
        startedAt: new Date().toISOString(),
        startedBy: actorId,
        exitCode: null,
        lastLine: '',
        lines: 0,
      }
      const key = keyOf(ticketId, repoId)
      const values = environment(repoId)
      const process = spawnRun({ command: target.command, cwd: target.cwd, values, runtime: runtime() })
      const entry: Live = { run, process, lines: [] }
      live.set(key, entry)
      // The Log pane is read by the boss *and* by whoever is testing, so what a dev server prints
      // goes through the same redactor `env_run` uses — including across chunk boundaries, which
      // is why the stream form is used and flushed when the process leaves (T176).
      const redactor = createRedactor(values)
      // A line is kept whole: the redactor holds back the few characters that could still be the
      // start of a value, so a line split across two chunks is one line here rather than two.
      let pending = ''
      const keep = (text: string, last = false) => {
        pending += text
        const parts = pending.split(/\r?\n/)
        pending = last ? '' : (parts.pop() ?? '')
        for (const line of parts) {
          if (line.trim()) record(entry, line)
        }
      }
      process.onOutput((chunk) => {
        keep(redactor.push(String(chunk)))
        changed()
      })
      process.onExit((code) => {
        keep(redactor.end(), true)
        entry.run = { ...entry.run, state: 'exited', exitCode: code }
        changed()
      })
      changed()
      return entry.run
    },

    stop(ticketId, repoId) {
      const entry = live.get(keyOf(ticketId, repoId))
      if (!entry) throw new Error(`Nothing is running for ${ticketCodeIn(db, ticketId)} in ${repoName(repoId)}`)
      kill(entry)
      entry.run = { ...entry.run, state: 'exited' }
      changed()
      return entry.run
    },

    log: (ticketId, repoId) => [...(live.get(keyOf(ticketId, repoId))?.lines ?? [])],

    stopTicket(ticketId) {
      for (const [key, entry] of live) {
        if (entry.run.ticketId !== ticketId) continue
        if (entry.run.state === 'running') kill(entry)
        live.delete(key)
      }
      changed()
    },

    stopUnless(ticketIds) {
      const keep = new Set(ticketIds)
      for (const [key, entry] of live) {
        if (keep.has(entry.run.ticketId)) continue
        if (entry.run.state === 'running') kill(entry)
        live.delete(key)
      }
      changed()
    },

    stopAll() {
      for (const entry of live.values()) if (entry.run.state === 'running') kill(entry)
      live.clear()
      changed()
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
