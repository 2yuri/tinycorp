import { isAbsolute, posix, relative, resolve, win32 } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Approval } from '../../../shared/approvals'
import { ENVIRONMENT_IDS, type EnvironmentId, type EnvRunResult, isEnvironmentId } from '../../../shared/environments'
import { pathFlavour } from '../../../shared/platform/absolute-path'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import { runtimePaths } from '../../platform'
import type { CompanyApprovals } from '../approvals'
import { type EnvRunOutcome, runWithEnvironment } from './env-run'
import type { EnvironmentStore, EnvironmentUse } from './environments'

/**
 * `env_run`: the one way an Employee uses a secret (T176).
 *
 * Three things happen here and nowhere else. The **place** is resolved — a command runs in one of
 * the calling Employee's own worktrees, so the repo it is in is a fact rather than a claim, and
 * that repo is what the variable scopes are checked against. The **approval** is resolved — an
 * environment that asks before every use raises a card and the run waits for it, and one Approve
 * covers exactly one run (frame `aD50i`, a: "Approve once runs this one command. The next use asks
 * again."). Then the command runs, with the values in the child process and in nothing else.
 *
 * The Employee never learns a value, an approval it did not get, or a variable it is not scoped
 * to. What it gets back is an exit code, redacted output, and the **names** it ran with.
 */

export interface EnvRunRequest {
  command: string
  /** The environment to run with, or undefined for the repo's default. */
  environment?: EnvironmentId
  /** Where to run, inside one of this Employee's worktrees. Its only worktree when there is one. */
  cwd?: string
}

export interface EnvironmentRuns {
  /** Runs, or answers `pending` with the approval to wait for, or `denied` when the boss said no. */
  run(employeeId: string, request: EnvRunRequest): Promise<EnvRunResult>
}

export interface EnvironmentRunsOptions {
  db(): DatabaseSync
  environments: EnvironmentStore
  approvals: CompanyApprovals
  /** Runs the command. Injected so tests spawn nothing. */
  run?: typeof runWithEnvironment
  /**
   * Where this Employee's Provider runs (T167): a WSL runtime puts the command inside that distro,
   * which is where the Employee's own tools are. Without one, everything runs on the host.
   */
  runtimeFor?(employeeId: string): ProviderRuntime | null
  now?: () => Date
}

/** One place an Employee may run in: its worktree, and the repo that worktree is of. */
interface Place {
  path: string
  repoId: string
  ticketId: number
}

export function createEnvironmentRuns({
  db,
  environments,
  approvals,
  run = runWithEnvironment,
  runtimeFor = () => null,
  now = () => new Date(),
}: EnvironmentRunsOptions): EnvironmentRuns {
  function places(employeeId: string): Place[] {
    const rows = db()
      .prepare(
        `SELECT w.path AS path, w.repo_id AS repo_id, w.ticket_id AS ticket_id
         FROM worktree w JOIN ticket t ON t.id = w.ticket_id
         WHERE t.assignee_id = ? ORDER BY w.ticket_id, w.repo_id`,
      )
      .all(employeeId) as unknown as { path: string; repo_id: string; ticket_id: number }[]
    return rows.map((row) => ({ path: settle(row.path), repoId: row.repo_id, ticketId: row.ticket_id }))
  }

  function placeFor(employeeId: string, cwd: string | undefined): Place & { cwd: string } {
    const mine = places(employeeId)
    // Both sides of every sentence below are in the Employee's own spelling (T259): an Employee in a
    // distro was told `/home/b/Acme/worktrees/t-4` and is told the same thing back, because a
    // `\\wsl.localhost\…` in an error message names a path it cannot `cd` to.
    const spelling = runtimePaths(runtimeFor(employeeId))
    const theirs = () => mine.map((p) => spelling.toRuntime(p.path)).join(', ')
    if (mine.length === 0) {
      throw new Error(
        'You have no worktree to run in. env_run runs inside a worktree of a ticket assigned to you: ' +
          'move your ticket into Doing first.',
      )
    }
    if (cwd === undefined) {
      if (mine.length > 1) {
        throw new Error(`You have ${mine.length} worktrees, so name cwd: one of ${theirs()}.`)
      }
      return { ...mine[0]!, cwd: mine[0]!.path }
    }
    // `resolve` on its own is what refused a distro's paths: on Windows it reads `/home/b/x` as a
    // path relative to the drive the app is on and hands back `C:\home\b\x`, which is inside
    // nobody's worktree. So an inbound path is translated to this process's spelling first.
    const wanted = settle(spelling.toHost(cwd))
    const place = mine.find((candidate) => inside(candidate.path, wanted))
    if (!place) {
      throw new Error(
        `${spelling.toRuntime(wanted)} is not inside one of your worktrees. env_run runs in your own worktree: ` +
          `${theirs()}.`,
      )
    }
    return { ...place, cwd: wanted }
  }

  function environmentFor(request: EnvRunRequest, repoId: string): EnvironmentId {
    if (request.environment !== undefined) {
      if (!isEnvironmentId(request.environment)) {
        throw new Error(
          `There is no environment named ${JSON.stringify(request.environment)}. It is one of ${ENVIRONMENT_IDS.join(', ')}.`,
        )
      }
      return request.environment
    }
    const fallback = environments.repoDefault(repoId)
    if (!fallback) {
      throw new Error(
        'This repo has no default environment, so name the one to run with: ' + ENVIRONMENT_IDS.join(', ') + '.',
      )
    }
    return fallback
  }

  /**
   * The Approval for this exact run, from the boss's point of view: the command, the environment
   * and the variables it would receive. One row per ask, consumed by the run it allowed.
   */
  function grant(
    employeeId: string,
    environment: EnvironmentId,
    repoId: string,
    cwd: string,
    command: string,
    names: string[],
  ): { kind: 'granted' } | { kind: 'pending'; approval: Approval } | { kind: 'denied'; reason: string } {
    const open = db()
      .prepare(
        `SELECT r.id AS id, r.approval_id AS approval_id, a.status AS status, a.decision_reason AS reason
         FROM env_run_request r JOIN approval a ON a.id = r.approval_id
         WHERE r.employee_id = ? AND r.environment_id = ? AND r.command = ? AND r.cwd = ? AND r.used_at IS NULL
         ORDER BY r.id DESC LIMIT 1`,
      )
      .get(employeeId, environment, command, cwd) as
      | { id: number; approval_id: number; status: string; reason: string | null }
      | undefined
    if (open?.status === 'approved') {
      // Approve once means once: the row is spent here, and the next run asks again.
      db().prepare('UPDATE env_run_request SET used_at = ? WHERE id = ?').run(now().toISOString(), open.id)
      return { kind: 'granted' }
    }
    if (open?.status === 'rejected') {
      db().prepare('UPDATE env_run_request SET used_at = ? WHERE id = ?').run(now().toISOString(), open.id)
      return { kind: 'denied', reason: open.reason ?? 'The boss said no.' }
    }
    if (open) {
      const approval = approvals.list().find((row) => row.id === open.approval_id)
      if (approval) return { kind: 'pending', approval }
    }
    const outcome = approvals.request({
      requesterId: employeeId,
      action: 'env_run',
      subject: `${command} with ${environment}`,
      summary: `I need to run \`${command}\` with ${environment}.`,
      reason: `In ${cwd}, with ${names.length > 0 ? names.join(', ') : 'no variables'}.`,
    })
    // `env_run` always asks when it reaches the gate, so `free` cannot happen; if it ever did,
    // the run going ahead is the right answer, not a crash.
    if (outcome.gate === 'free') return { kind: 'granted' }
    db()
      .prepare(
        `INSERT INTO env_run_request (approval_id, employee_id, environment_id, repo_id, command, cwd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(outcome.approval.id, employeeId, environment, repoId, command, cwd, now().toISOString())
    return { kind: 'pending', approval: outcome.approval }
  }

  return {
    async run(employeeId, request) {
      const command = request.command.trim()
      if (command === '') throw new Error('env_run needs a command to run.')
      const place = placeFor(employeeId, request.cwd)
      const environment = environmentFor(request, place.repoId)
      const use: EnvironmentUse = { environment, repoId: place.repoId }
      const values = environments.valuesFor(use)
      const names = values.map(({ name }) => name)

      if (environments.list().find((row) => row.id === environment)?.askEveryUse) {
        const decision = grant(employeeId, environment, place.repoId, place.cwd, command, names)
        if (decision.kind === 'pending') {
          return answer('pending', names, {
            stderr:
              `The boss is being asked about this one: #${decision.approval.channelId}, thread ` +
              `${decision.approval.messageId}. ${environment} asks before every use. End your turn now; the ` +
              'decision arrives in your inbox, and then run env_run again with the same command.',
          })
        }
        if (decision.kind === 'denied') {
          return answer('denied', names, { stderr: `The boss said no: ${decision.reason}` })
        }
      }

      const outcome = await run({ command, cwd: place.cwd, values, runtime: runtimeFor(employeeId) })
      environments.markUsed(use, employeeId, now().toISOString())
      return ran(outcome, names)
    },
  }
}

function answer(status: EnvRunResult['status'], variables: string[], parts: { stderr: string }): EnvRunResult {
  return {
    status,
    exitCode: null,
    stdout: '',
    stderr: parts.stderr,
    redacted: 0,
    variables,
    timedOut: false,
    truncated: false,
  }
}

function ran(outcome: EnvRunOutcome, variables: string[]): EnvRunResult {
  return {
    status: 'ran',
    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    redacted: outcome.redacted,
    variables,
    timedOut: outcome.timedOut,
    truncated: outcome.truncated,
  }
}

/** Whether `path` is `root` or inside it, without a `..` walking out of it. */
/**
 * A path with its `..` collapsed, in **its own** spelling rather than this machine's. See
 * `pathFlavour`: a `/home/b/x` that came out of a distro must not come back as `C:\home\b\x`.
 */
function settle(path: string): string {
  const flavour = pathFlavour(path)
  if (flavour === 'win32') return win32.resolve(path)
  return flavour === 'posix' ? posix.resolve(path) : resolve(path)
}

function inside(root: string, path: string): boolean {
  // Both sides have been through `settle`, so they are the same flavour — and it is that flavour's
  // `relative` that has to answer, or a `\\wsl.localhost\…` pair compares as two unrelated names on
  // a POSIX runner and the suite says something different per platform.
  const step = pathFlavour(root) === 'win32' ? win32.relative(root, path) : relative(root, path)
  return step === '' || (!step.startsWith('..') && !isAbsolute(step) && !win32.isAbsolute(step))
}
