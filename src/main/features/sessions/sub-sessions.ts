import { randomBytes, randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Employee, Provider } from '../../../shared/domain/staff'
import {
  LIVE_SUB_SESSION_STATES,
  SUB_SESSION_NAME_MAX,
  SUB_SESSION_RESULT_MAX,
  SUB_SESSION_TASK_MAX,
  SUB_SESSION_WORKSPACES,
  type SubSessionInfo,
  type SubSessionState,
  type SubSessionWorkspace,
} from '../../../shared/sub-sessions'
import { clip } from '../../../shared/subagents'
import { ticketCode } from '../../../shared/ticket-id'
import { ticketCodeIn } from '../../core'
import { slugify } from '../../platform'
import type { GrantedMcpServer, HookPayload, ProviderAdapter, ProviderAdapters, PtySession } from '../../providers'
import type { SubSessionSeats } from './capacity'
import { type CompanyBrief, renderInstructions, type SubSessionBrief } from './instructions'
import { BUDGET_OUTPUT_WINDOW, type BudgetSignal, providerOutput, READY_DELAY_MS } from './sessions'
import { changedAnything, type SubSessionGit } from './sub-session-git'

/**
 * The Sessions an Employee starts of its own (T163): each a full Session of the parent's own
 * Provider, model and effort, with its own process, terminal and seat under the concurrency cap,
 * working one piece of a ticket the parent holds.
 *
 * Where it works is the parent's call — its own worktree off the parent's branch, or the parent's
 * worktree — and this module carries it out without picking or refusing either. It is one level
 * deep in code: the MCP token a sub-session is spawned with reaches only `session_report`, never
 * the tools that start sessions.
 */
export interface SubSessions {
  /** Starts a sub-session for the parent, or queues it for a seat. Throws what the parent must fix. */
  start(companyId: string, parentId: string, request: SubSessionRequest): SubSessionInfo
  /** One of the parent's sub-sessions. Throws for an id that is not the parent's. */
  get(companyId: string, parentId: string, id: string): SubSessionInfo
  /** The parent's sub-sessions, oldest first. */
  of(companyId: string, parentId: string): SubSessionInfo[]
  /**
   * Stops one of the parent's sub-sessions. Its own worktree stays while it holds work, for the
   * parent to merge; one that changed nothing leaves nothing behind.
   */
  stop(companyId: string, parentId: string, id: string): SubSessionInfo
  /** What a sub-session reports back to its parent, from its own `session_report`. */
  report(id: string, result: string): SubSessionInfo
  /** Feeds a hook; false when the token is no sub-session's. */
  receiveHook(token: string, payload: HookPayload): boolean
  /** The sub-session an MCP token was issued to, or null. */
  mcpCaller(token: string): { companyId: string; employeeId: string; subSessionId: string } | null
  /**
   * The parent's own Session ended: every sub-session it started stops, and their own worktrees go
   * — after a restore point of whatever they held.
   */
  parentStopped(companyId: string, parentId: string): void
  /** The board changed: a sub-session whose ticket is done, or no longer the parent's, goes the same way. */
  ticketsChanged(companyId: string): void
  /** Stops and removes every sub-session, as the app closes. */
  stopAll(): void
  onChange(listener: () => void): () => void
}

export interface SubSessionRequest {
  /** A few words: the chip, and its branch's suffix. */
  name: string
  /** What to do, as for a colleague who has not read the ticket. */
  task: string
  workspace: SubSessionWorkspace
  /** The ticket it works on; the parent's one ticket in Doing when left out. */
  ticketId?: number
  /** The repo's name or id, when the ticket has worktrees in more than one. */
  repo?: string
}

export interface SubSessionsOptions {
  providers: ProviderAdapters
  /** An open Company's database and Employees, or null. */
  company(companyId: string): { db: DatabaseSync; employees: Employee[] } | null
  /** The seats under the concurrency cap; read when a sub-session asks for one. */
  seats(): SubSessionSeats
  /** Without it, no sub-session can have a worktree of its own. */
  git?: SubSessionGit
  /** The Company MCP server's URL for a Company. Without it, a sub-session has no way to report. */
  mcpUrl?: (companyId: string, provider: Provider) => string
  /** The outside MCP servers the parent holds, which a sub-session holds too: it is the parent thinking. */
  mcpGrants?: (companyId: string, employee: Employee) => GrantedMcpServer[]
  /** What the sub-session is told, on its own process: the Company, with its piece of the work. */
  brief?: (companyId: string, employee: Employee, sub: SubSessionBrief) => CompanyBrief
  /** Called with every PTY a sub-session spawns, by the sub-session's id: its terminal. */
  onSpawn?(id: string, pty: PtySession): void
  /** Records a restore point of an own worktree before the app removes it. */
  beforeRemoving?(companyId: string, point: { ticketId: number; repoId: string; path: string; note: string }): void
  /** A sub-session ended on its own — done, or its process gone — and its parent should hear. */
  finished?(companyId: string, sub: SubSessionInfo): void
  onBudgetExhausted?(signal: BudgetSignal): void
  log(line: string): void
  now?: () => Date
}

interface Sub {
  info: SubSessionInfo
  companyId: string
  repoId: string
  parentPath: string
  /** The commit an own worktree started at. */
  base: string | null
  /** The full task, which travels in its instructions; the info keeps only its first line. */
  fullTask: string
  running: {
    adapter: ProviderAdapter
    /** The Provider its process runs on, and the account it was spawned as. */
    provider: Provider
    accountId: string | null
    pty: PtySession
    token: string
    mcpToken: string
    /** The conversation its Provider knows it as, and what its adapter named its files after. */
    sessionId: string
    readyTimer?: ReturnType<typeof setTimeout>
    detach: (() => void)[]
  } | null
}

/** A worktree of a ticket the parent holds in Doing. */
interface ParentWorktree {
  ticket_id: number
  repo_id: string
  repo_name: string
  path: string
  branch: string
}

export function createSubSessions({
  providers,
  company,
  seats,
  git,
  mcpUrl,
  mcpGrants,
  brief,
  onSpawn,
  beforeRemoving,
  finished,
  onBudgetExhausted,
  log,
  now = () => new Date(),
}: SubSessionsOptions): SubSessions {
  const subs = new Map<string, Sub>()
  const byToken = new Map<string, Sub>()
  const byMcpToken = new Map<string, Sub>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const snapshot = (sub: Sub): SubSessionInfo => ({ ...sub.info })

  function companyOf(companyId: string): { db: DatabaseSync; employees: Employee[] } {
    const found = company(companyId)
    if (!found) throw new Error(`Company ${companyId} is not open`)
    return found
  }

  function mine(companyId: string, parentId: string, id: string): Sub {
    const sub = subs.get(id)
    if (!sub || sub.companyId !== companyId || sub.info.parentId !== parentId) {
      throw new Error(`No sub-session ${id} of yours`)
    }
    return sub
  }

  /** The worktrees of the tickets the parent holds in Doing, which is where a sub-session can work. */
  function worktreesOf(db: DatabaseSync, parentId: string): ParentWorktree[] {
    return db
      .prepare(
        `SELECT w.ticket_id, w.repo_id, r.name AS repo_name, w.path, w.branch
           FROM worktree w
           JOIN ticket t ON t.id = w.ticket_id
           JOIN repo r ON r.id = w.repo_id
          WHERE t.assignee_id = ? AND t.column_id = 'doing'
          ORDER BY w.ticket_id, w.created_at, w.rowid`,
      )
      .all(parentId) as unknown as ParentWorktree[]
  }

  function where(db: DatabaseSync, parentId: string, request: SubSessionRequest): ParentWorktree {
    const all = worktreesOf(db, parentId)
    const tickets = [...new Set(all.map((w) => w.ticket_id))]
    const codes = (ids: number[]) => ids.map((id) => ticketCodeIn(db, id)).join(', ')
    let ticketId = request.ticketId
    if (ticketId === undefined) {
      if (tickets.length === 0) {
        throw new Error('You hold no ticket in Doing with a worktree, and a sub-session works on one of yours.')
      }
      if (tickets.length > 1) throw new Error(`Say which ticket it works on: ${codes(tickets)}.`)
      ticketId = tickets[0]!
    } else if (!tickets.includes(ticketId)) {
      throw new Error(
        `${ticketCodeIn(db, ticketId)} is not a ticket you hold in Doing with a worktree` +
          (tickets.length ? `; yours are ${codes(tickets)}.` : '.'),
      )
    }
    const ofTicket = all.filter((w) => w.ticket_id === ticketId)
    if (request.repo !== undefined) {
      const wanted = request.repo.trim().toLowerCase()
      const found = ofTicket.find((w) => w.repo_id === request.repo || w.repo_name.toLowerCase() === wanted)
      if (!found) {
        throw new Error(
          `${ticketCodeIn(db, ticketId)} has no worktree in ${request.repo}; it has ${ofTicket.map((w) => w.repo_name).join(', ')}.`,
        )
      }
      return found
    }
    if (ofTicket.length > 1) {
      throw new Error(`Say which repo it works in: ${ofTicket.map((w) => w.repo_name).join(', ')}.`)
    }
    return ofTicket[0]!
  }

  /** `<parent branch>+<name>`, made unique in the repo. */
  function ownBranch(parent: ParentWorktree, name: string): string {
    const stem = `${parent.branch}+${slugify(name) || 'session'}`
    const taken = (branch: string) =>
      git!.hasBranch(parent.path, branch) || [...subs.values()].some((s) => s.info.branch === branch)
    let branch = stem
    for (let n = 2; taken(branch); n++) branch = `${stem}-${n}`
    return branch
  }

  function setState(sub: Sub, state: SubSessionState): void {
    if (sub.info.state === state) return
    sub.info.state = state
    notify()
  }

  function refreshChanges(sub: Sub): boolean {
    if (sub.info.workspace !== 'own' || !git || !sub.base || !sub.info.worktreeKept) return false
    const changes = git.changes({ path: sub.info.path, base: sub.base })
    const files = changes?.files ?? 0
    if (files === sub.info.filesChanged) return changedAnything(changes)
    sub.info.filesChanged = files
    notify()
    return changedAnything(changes)
  }

  function launch(sub: Sub): void {
    const { db, employees } = companyOf(sub.companyId)
    const parent = employees.find((e) => e.id === sub.info.parentId)
    if (!parent) throw new Error(`Unknown Employee: ${sub.info.parentId}`)
    // The parent's own Provider, model and effort: a sub-session is the Employee thinking in parallel.
    const adapter = providers[parent.provider]
    if (!adapter) throw new Error(`No provider adapter for ${parent.provider}`)
    const sessionId = randomUUID()
    const token = randomBytes(24).toString('base64url')
    const mcpToken = randomBytes(24).toString('base64url')
    const granted = mcpGrants?.(sub.companyId, parent) ?? []
    // The parent's Provider: a sub-session runs through the same adapter, so it runs in the same
    // place and dials the same address (T163, T167).
    const companyServer = mcpUrl ? { url: mcpUrl(sub.companyId, parent.provider), token: mcpToken } : null
    if (companyServer || granted.length > 0) adapter.injectMcp(sessionId, { company: companyServer, granted })
    const companyBrief = brief?.(sub.companyId, parent, briefOf(db, sub, parent))
    const pty = adapter.spawn({
      employee: parent,
      cwd: sub.info.path,
      ...(companyBrief && { instructions: renderInstructions(parent, companyBrief) }),
      subSession: { name: sub.info.name },
      sessionId,
      hookToken: token,
    })
    const running = {
      adapter,
      pty,
      token,
      mcpToken,
      sessionId,
      provider: parent.provider,
      accountId: null,
      detach: [] as (() => void)[],
    }
    sub.running = running
    byToken.set(token, sub)
    byMcpToken.set(mcpToken, sub)
    onSpawn?.(sub.info.id, pty)
    let recent = ''
    running.detach.push(
      pty.onData((data) => {
        recent = (recent + data).slice(-BUDGET_OUTPUT_WINDOW)
        if (budgetCheck(sub, recent)) recent = ''
      }),
      // A process that exits on its own stops the sub-session before its turn ended; the parent hears it.
      pty.onExit(() => end(sub, 'stopped', { tell: true })),
    )
    setState(sub, 'starting')
  }

  function briefOf(db: DatabaseSync, sub: Sub, parent: Employee): SubSessionBrief {
    const title = (
      db.prepare('SELECT title FROM ticket WHERE id = ?').get(sub.info.ticketId) as { title: string } | undefined
    )?.title
    return {
      parentName: parent.name,
      ticket: ticketCodeIn(db, sub.info.ticketId),
      title: title ?? '',
      name: sub.info.name,
      task: sub.fullTask,
      workspace: sub.info.workspace,
      path: sub.info.path,
      branch: sub.info.branch,
      parentBranch: sub.info.parentBranch,
      parentPath: sub.parentPath,
    }
  }

  function budgetCheck(sub: Sub, output: string): boolean {
    const running = sub.running
    if (!running || !onBudgetExhausted || !running.adapter.detectBudgetExhausted(output)) return false
    onBudgetExhausted({
      companyId: sub.companyId,
      employeeId: sub.info.parentId,
      // A sub-session runs on its parent's Provider, on the account the parent's Session uses.
      provider: running.provider,
      accountId: running.accountId,
      resetsAt: running.adapter.budgetResetAt(output, now()),
    })
    return true
  }

  /** Hands the sub-session its task: one line, since the whole task is already in its instructions. */
  function pushTask(sub: Sub): void {
    const running = sub.running
    if (!running || sub.info.state !== 'starting') return
    const { db } = companyOf(sub.companyId)
    const parentName = company(sub.companyId)?.employees.find((e) => e.id === sub.info.parentId)?.name ?? 'your parent'
    running.adapter.pushPrompt(
      running.pty,
      `[company] ${parentName} started you for ${JSON.stringify(sub.info.name)} on ${ticketCodeIn(db, sub.info.ticketId)}. ` +
        'Your task is in your instructions: do it, report with session_report, then end your turn.',
    )
    setState(sub, 'working')
  }

  /**
   * Ends a sub-session: its process, its seat and its tokens. An own worktree that changed nothing
   * goes with it; one that holds work stays for the parent to merge.
   */
  function end(sub: Sub, state: 'done' | 'stopped', { tell }: { tell: boolean }): void {
    if (!LIVE_SUB_SESSION_STATES.includes(sub.info.state)) return
    const running = sub.running
    sub.running = null
    if (running) {
      clearTimeout(running.readyTimer)
      for (const detach of running.detach) detach()
      byToken.delete(running.token)
      byMcpToken.delete(running.mcpToken)
      running.pty.kill()
      // Whatever the adapter wrote for it goes with it (T199, finding H5): a sub-session's MCP
      // config left on the disk is the parent's own tools one `cat` away from any Employee.
      running.adapter.forgetSession?.(running.sessionId)
    }
    seats().release(sub.info.id)
    sub.info.state = state
    sub.info.endedAt = now().toISOString()
    sub.info.now = null
    try {
      if (sub.info.worktreeKept && !refreshChanges(sub)) remove(sub)
    } catch (error) {
      log(`Sub-session ${sub.info.name}: could not look at its worktree: ${(error as Error).message}`)
    }
    notify()
    if (tell) finished?.(sub.companyId, snapshot(sub))
  }

  /** Takes an own worktree off the disk; its branch stays while it holds commits the parent's does not. */
  function remove(sub: Sub): void {
    if (!git || !sub.info.worktreeKept) return
    const { branchKept } = git.remove({
      parentPath: sub.parentPath,
      path: sub.info.path,
      branch: sub.info.branch,
      parentBranch: sub.info.parentBranch,
    })
    sub.info.worktreeKept = false
    sub.info.branchKept = branchKept
    notify()
  }

  /** The parent stopped, or the ticket closed: stop it, and remove its worktree after a restore point. */
  function clear(sub: Sub, why: string): void {
    end(sub, 'stopped', { tell: false })
    if (!sub.info.worktreeKept) return
    try {
      if (refreshChanges(sub)) {
        beforeRemoving?.(sub.companyId, {
          ticketId: sub.info.ticketId,
          repoId: sub.repoId,
          path: sub.info.path,
          note: `Before removing ${sub.info.name}’s worktree: ${why}`,
        })
      }
      remove(sub)
    } catch (error) {
      log(`Sub-session ${sub.info.name}: could not remove ${sub.info.path}: ${(error as Error).message}`)
    }
  }

  return {
    start(companyId, parentId, request) {
      const { db, employees } = companyOf(companyId)
      const parent = employees.find((e) => e.id === parentId)
      if (!parent) throw new Error(`Unknown Employee: ${parentId}`)
      if (!providers[parent.provider]) throw new Error(`No provider adapter for ${parent.provider}`)
      if (!SUB_SESSION_WORKSPACES.includes(request.workspace)) {
        throw new Error(`workspace must be "own" or "shared", not ${JSON.stringify(request.workspace)}`)
      }
      const name = clip(request.name, SUB_SESSION_NAME_MAX)
      const task = request.task.trim()
      if (!name) throw new Error('Give the sub-session a name: a few words for its piece of the work.')
      if (!task)
        throw new Error('Give the sub-session a task: what to do, as for a colleague who has not read the ticket.')
      if (request.workspace === 'own' && !git) {
        throw new Error('This Company has no git to make a worktree with; start it with workspace "shared".')
      }
      const parentTree = where(db, parentId, request)
      const id = `sub-${randomBytes(6).toString('hex')}`
      const own = request.workspace === 'own'
      const branch = own ? ownBranch(parentTree, name) : parentTree.branch
      // Beside the parent's worktree, under the same folder: never inside a repo (decision 45).
      const path = own
        ? join(dirname(parentTree.path), `${basename(parentTree.path)}+${branch.slice(parentTree.branch.length + 1)}`)
        : parentTree.path
      const base = own ? git!.add({ parentPath: parentTree.path, path, branch }).base : null
      const sub: Sub = {
        info: {
          id,
          parentId,
          name,
          task: clip(task.split('\n')[0] ?? task, SUB_SESSION_TASK_MAX),
          workspace: request.workspace,
          state: 'waiting',
          ticketId: parentTree.ticket_id,
          repoName: parentTree.repo_name,
          path,
          branch,
          parentBranch: parentTree.branch,
          startedAt: now().toISOString(),
          endedAt: null,
          now: null,
          filesChanged: own ? 0 : null,
          result: null,
          worktreeKept: own,
          branchKept: own,
        },
        companyId,
        repoId: parentTree.repo_id,
        parentPath: parentTree.path,
        base,
        fullTask: task,
        running: null,
      }
      subs.set(id, sub)
      notify()
      // A seat now, or later once one frees: a start that fails later is told to the parent,
      // one that fails now is thrown back at it.
      let asked: 'now' | 'later' = 'now'
      let failed: unknown = null
      const begin = () => {
        try {
          launch(sub)
        } catch (error) {
          if (asked === 'now') failed = error
          else log(`Sub-session ${sub.info.name} could not start: ${(error as Error).message}`)
          clear(sub, 'it could not start')
          if (asked === 'later') finished?.(companyId, snapshot(sub))
        }
      }
      try {
        seats().take(companyId, id, begin)
      } catch (error) {
        failed = error
      }
      asked = 'later'
      if (failed !== null) {
        clear(sub, 'it could not start')
        subs.delete(id)
        notify()
        throw failed
      }
      return snapshot(sub)
    },

    get: (companyId, parentId, id) => snapshot(mine(companyId, parentId, id)),

    of(companyId, parentId) {
      return [...subs.values()]
        .filter((sub) => sub.companyId === companyId && sub.info.parentId === parentId)
        .map(snapshot)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    },

    stop(companyId, parentId, id) {
      const sub = mine(companyId, parentId, id)
      end(sub, 'stopped', { tell: false })
      return snapshot(sub)
    },

    report(id, result) {
      const sub = subs.get(id)
      if (!sub) throw new Error('This sub-session is gone')
      const text = result.trim()
      if (!text) throw new Error('Say what you did: the result is what your parent reads.')
      sub.info.result = text.length > SUB_SESSION_RESULT_MAX ? `${text.slice(0, SUB_SESSION_RESULT_MAX - 1)}…` : text
      notify()
      return snapshot(sub)
    },

    receiveHook(token, payload) {
      const sub = byToken.get(token)
      const running = sub?.running
      if (!sub || !running) return false
      budgetCheck(sub, providerOutput(payload))
      switch (running.adapter.detectIdle(payload)) {
        case 'ready':
          clearTimeout(running.readyTimer)
          running.readyTimer = setTimeout(() => pushTask(sub), READY_DELAY_MS)
          break
        case 'idle':
          // Its turn on the task is over: the result is what it reported, and its seat is free again.
          if (sub.info.state === 'working') end(sub, 'done', { tell: true })
          else pushTask(sub)
          break
        default:
          break
      }
      if (sub.running) {
        const doing = nowOf(payload)
        if (doing && doing !== sub.info.now) {
          sub.info.now = doing
          notify()
        }
        if (payload.hook_event_name === 'PostToolUse') {
          try {
            refreshChanges(sub)
          } catch (error) {
            log(`Sub-session ${sub.info.name}: could not read its worktree: ${(error as Error).message}`)
          }
        }
      }
      return true
    },

    mcpCaller(token) {
      const sub = byMcpToken.get(token)
      return sub ? { companyId: sub.companyId, employeeId: sub.info.parentId, subSessionId: sub.info.id } : null
    },

    parentStopped(companyId, parentId) {
      for (const sub of subs.values()) {
        if (sub.companyId === companyId && sub.info.parentId === parentId) clear(sub, 'its parent stopped')
      }
    },

    ticketsChanged(companyId) {
      const found = company(companyId)
      if (!found) return
      for (const sub of subs.values()) {
        if (sub.companyId !== companyId) continue
        if (!LIVE_SUB_SESSION_STATES.includes(sub.info.state) && !sub.info.worktreeKept) continue
        const row = found.db.prepare('SELECT column_id, assignee_id FROM ticket WHERE id = ?').get(sub.info.ticketId) as
          | { column_id: string; assignee_id: string | null }
          | undefined
        if (!row || row.column_id === 'done') clear(sub, 'its ticket is done')
        else if (row.assignee_id !== sub.info.parentId) clear(sub, 'its ticket went to someone else')
      }
    },

    stopAll() {
      for (const sub of subs.values()) clear(sub, 'the app closed')
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** What a hook says the sub-session is running now: the command, else the tool and its file. */
function nowOf(payload: HookPayload): string | null {
  if (payload.hook_event_name !== 'PreToolUse' || typeof payload['tool_name'] !== 'string') return null
  const input =
    payload['tool_input'] !== null && typeof payload['tool_input'] === 'object'
      ? (payload['tool_input'] as Record<string, unknown>)
      : {}
  if (typeof input['command'] === 'string') return clip(input['command'], 80)
  const file = typeof input['file_path'] === 'string' ? basename(input['file_path']) : null
  return clip(file ? `${payload['tool_name']} ${file}` : payload['tool_name'], 80)
}

/**
 * What wakes the parent when a sub-session ends on its own: on one line, since a prompt is typed
 * into a terminal, with the result JSON-quoted.
 */
export function finishedPrompt(companyKey: string, sub: SubSessionInfo): string {
  const ended = sub.state === 'done' ? 'finished' : 'stopped before it finished'
  const said = sub.result ? `It reported: ${JSON.stringify(sub.result)}.` : 'It reported nothing.'
  const work =
    sub.workspace === 'shared'
      ? `It worked in your own worktree, ${sub.path}.`
      : sub.worktreeKept || sub.branchKept
        ? `Its work is on ${sub.branch}${sub.worktreeKept ? ` in ${sub.path}` : ''}: merge it into ${sub.parentBranch} ` +
          'in your own worktree when you are ready, and resolve any conflict yourself.'
        : 'It changed nothing, so its worktree and branch are gone.'
  return (
    `[company] Your Session ${JSON.stringify(sub.name)} on ${ticketCode(companyKey, sub.ticketId)} ${ended}. ` +
    `${said} ${work} Read it again with session_read ${sub.id}.`
  )
}
