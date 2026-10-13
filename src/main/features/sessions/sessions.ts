import { randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { providerEntry } from '../../../shared/domain/providers'
import type { Employee, Provider } from '../../../shared/domain/staff'
import type { RtkHook } from '../../../shared/rtk'
import type { SessionAsk, SessionHandoff, SessionInfo, SessionRouting, SessionStatus } from '../../../shared/session'
import { changedSettings, type SpawnSetting, type SpawnSettings } from '../../../shared/spawn-settings'
import type { SubSessionInfo } from '../../../shared/sub-sessions'
import type { Migration } from '../../core'
import {
  askOf,
  type GrantedMcpServer,
  type HookPayload,
  hookSessionId,
  isProviderSessionId,
  type ProviderAdapter,
  type ProviderAdapters,
  type PtySession,
  type SessionSignal,
  type SpawnAccount,
} from '../../providers'
import { type CompanyBrief, renderInstructions } from './instructions'
import { createSubagentModel, type SubagentModel } from './subagents'

/** How long after SessionStart the TUI is taken to be at its prompt (spike v0, finding 2). */
export const READY_DELAY_MS = 1500

/** Employees' Sessions: spawning, stopping, and the hook-driven status machine. */
export interface Sessions {
  /** One entry per Employee of the current Company. */
  list(): SessionInfo[]
  get(employeeId: string): SessionInfo
  /** Spawns the Employee's CLI in the Company folder. */
  start(employeeId: string): SessionInfo
  /** Kills the Employee's CLI. */
  stop(employeeId: string): SessionInfo
  /**
   * Starts the Employee's idle Session again where it stands, continuing the same conversation
   * with instructions written from the Company's settings as they are now (T237), and spawned from
   * the Employee as the boss last saved them (T268).
   *
   * It never passes through `off`, so the Session keeps its seat under the concurrency cap and no
   * parked Employee takes it. False when there is nothing to restart: the Session is not running,
   * or it is mid-turn — a Session is never interrupted, it is restarted once its turn ends.
   */
  restart(employeeId: string): boolean
  /**
   * The Employees of the current Company whose running Session was spawned with settings the
   * Company has since changed, and which of the three each one is behind on (T237).
   */
  staleSessions(): { employeeId: string; settings: SpawnSetting[] }[]
  /**
   * The Employees whose running Session was spawned from a record the boss has since saved over
   * (T268): its persona, MCP servers, skills, model, permissions or anything else a spawn reads.
   * Its desk and its sprite are the office's, and a Session never reads them.
   */
  editedSessions(): string[]
  /** Feeds a hook POSTed by a Session. Hooks with an unknown token are ignored. */
  receiveHook(token: string, payload: HookPayload): void
  /** Called after any Session's status changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
  /** Kills every Session. */
  stopAll(): void
  /**
   * The running Session an MCP token was issued to, or null. A token of one of an Employee's own
   * sub-sessions (T163) answers that Employee, with the sub-session's id.
   */
  mcpCaller(token: string): { companyId: string; employeeId: string; subSessionId?: string } | null
  /** Called after every status change and every hook of any Session. Returns an unsubscribe function. */
  onActivity(listener: (activity: SessionActivity) => void): () => void
  /** Types `text` into the Employee's Session and submits it, only while it is idle. False when not pushed. */
  pushPrompt(employeeId: string, text: string): boolean
  /**
   * The command that opens this Employee's Session in the boss's own terminal (T164), built by its
   * Provider's adapter and shell-quoted here. Null when there is no Session to hand over — the
   * Employee has never been spawned, or the Provider does not build one.
   *
   * It only builds the line. Nothing is run and nothing is spawned.
   */
  handoffCommand(employeeId: string): SessionHandoff | null
}

/** One thing that happened to a Session: a status change (`hook` null) or a hook it sent. */
export interface SessionActivity {
  companyId: string
  employeeId: string
  /** The status after the change or hook. */
  status: SessionStatus
  hook: string | null
  /** What the hook meant for the status machine. */
  signal: SessionSignal | null
  /** The tool a PreToolUse or PostToolUse hook is about, when it names one. */
  tool?: string | null
  /** What the Session is stopped asking the boss in its terminal, after this hook; null when nothing (T165). */
  asking?: SessionAsk | null
}

export interface SessionsOptions {
  providers: ProviderAdapters
  /** The current Company's folder and database; throws when none is open. */
  current(): { folder: string; db: DatabaseSync; companyId: string }
  employees(): Employee[]
  /** Called with every PTY a Session spawns, e.g. to fan its output out to terminals. */
  onSpawn?(employeeId: string, pty: PtySession): void
  /**
   * The Company MCP server's URL for a Company, as this Provider's Session has to dial it. Without
   * it, Sessions start without MCP hands.
   *
   * It takes the Provider because the answer depends on where that Provider runs (T167): a Session
   * inside a WSL distro on the default NAT network cannot reach this machine's `127.0.0.1`, so it
   * is handed the host's address on the WSL switch instead. Everywhere else the two are the same
   * string.
   */
  mcpUrl?: (companyId: string, provider: Provider) => string
  /**
   * The outside MCP servers the boss granted this Employee (T136), with their secrets read from
   * the OS keychain at this moment and never held anywhere else. Without it, an Employee is handed
   * the Company's own server and nothing more — which is what every Employee starts with.
   */
  mcpGrants?: (where: SessionTarget, employee: Employee) => GrantedMcpServer[]
  /** An open Company's folder, database and Employees, or null; lets `startIn` reach a Company that is not current. */
  company?(companyId: string): SessionTarget | null
  /** Called when a Session's terminal or hook output says the subscription limit was hit. */
  onBudgetExhausted?(exhausted: BudgetSignal): void
  /**
   * Called once each time a Session stops in its terminal to ask the boss (T165) — once per ask,
   * however many times the Provider repeats its permission hook, and never for an ask that is
   * already on the boss's desk.
   */
  onAsking?(asked: AskingSignal): void
  /**
   * What an Employee of an open Company is told about it; rendered into that Session's own
   * instructions at every spawn. Every Employee of a Company shares its folder, so the brief
   * travels on the process, never through a file there.
   */
  brief?(companyId: string, employee: Employee): CompanyBrief
  /**
   * Whether this start should continue the Employee's last Session instead of starting a new
   * one. Asked once per start; without it, every start is fresh.
   */
  takeResume?(companyId: string, employeeId: string): boolean
  /**
   * Called when a Session that should have continued the Employee's last one started fresh
   * instead: the resume failed, was refused, or was not possible. The Session has no context.
   */
  onResumeFailed?(companyId: string, employeeId: string): void
  /**
   * Why a Provider's CLI cannot run an Employee right now, or null when it can (T129). A Session
   * that would spawn into nothing is refused with this sentence instead, so the boss reads the
   * same words here as on the Launcher rather than watching an empty terminal.
   */
  refuseSession?(provider: Provider): string | null
  /**
   * The Sessions Employees start of their own (T163). They ride on their parent's `SessionInfo`,
   * and their hooks and MCP tokens come in through the same doors as every Session's.
   */
  subSessions?: SubSessionHost
  /**
   * The Employee a Session is really started as (T173): its own, or the same Employee with the
   * fallback Provider and model routing moved it to while its own Provider is out. It changes
   * which adapter spawns, which model is asked for and which Session can be resumed — and nothing
   * else about the Employee. Without it, every Employee runs on the Provider it was hired on.
   */
  runAs?(companyId: string, employee: Employee): Employee
  /**
   * The sign-in this Session runs as (T173), or null for the product's own default directory.
   * Nothing but a directory crosses this seam.
   */
  accountFor?(companyId: string, employee: Employee): SpawnAccount | null
  /** Where an Employee is working while it is off its own Provider, for its `SessionInfo`. */
  routingOf?(companyId: string, employeeId: string): SessionRouting | null
  /**
   * The Company settings that are written into an Employee's instructions at spawn (T237), read
   * once per spawn and kept beside the Session as what it is running on. Without it, no Session is
   * ever stale and `Apply now` has nothing to restart.
   */
  spawnSettings?(companyId: string): SpawnSettings
  /**
   * The RTK a Session of this Company is spawned with (T179), or null for one spawned with none.
   *
   * Asked once per spawn, which is the whole of *off means off at the next start*: a Session that
   * is already running keeps what it started with, and nothing here edits a running Session's files.
   */
  rtkFor?(companyId: string): RtkHook | null
}

/** What Sessions needs of the sub-sessions module. */
export interface SubSessionHost {
  of(companyId: string, employeeId: string): SubSessionInfo[]
  onChange(listener: () => void): () => void
  /** False when the token is no sub-session's. */
  receiveHook(token: string, payload: HookPayload): boolean
  mcpCaller(token: string): { companyId: string; employeeId: string; subSessionId: string } | null
}

/** Where `startIn` spawns a Session. */
export interface SessionTarget {
  folder: string
  db: DatabaseSync
  companyId: string
  employees: Employee[]
}

/** A Session stopped in its terminal to ask the boss (T165). */
export interface AskingSignal {
  companyId: string
  employeeId: string
  ask: SessionAsk
}

/** A Session's output said the subscription limit was hit. */
export interface BudgetSignal {
  companyId: string
  employeeId: string
  /** The Provider that ran out: the one this Session runs on, which routing may have chosen (T173). */
  provider: Provider
  /** The account it ran out on, or null for a Provider TinyCorp runs on one sign-in. */
  accountId: string | null
  /** When the output says the limit resets, or null when it does not say. */
  resetsAt: Date | null
}

/** Sessions plus what the engine needs to start one outside the current Company. */
export interface SessionService extends Sessions {
  /** Spawns the Employee's CLI in the folder of an open Company, current or not. */
  startIn(companyId: string, employeeId: string): SessionInfo
}

/** What the app says about an Employee whose Provider is not on this machine. */
export function providerMissing(provider: Provider): string {
  const { name, command } = providerEntry(provider)
  return `${name} (\`${command}\`) is not installed — install it to start this Session`
}

/** How much recent terminal output is searched for the usage-limit message. */
export const BUDGET_OUTPUT_WINDOW = 2000

/** Hook fields that carry the user's or a tool's text rather than the provider's own output. */
const NOT_PROVIDER_OUTPUT = ['prompt', 'tool_input', 'tool_response']

/** A hook's fields as text, without the ones that could quote the usage-limit message by accident. */
export function providerOutput(payload: HookPayload): string {
  return JSON.stringify(payload, (key, value: unknown) => (NOT_PROVIDER_OUTPUT.includes(key) ? undefined : value))
}

interface Running {
  employeeId: string
  db: DatabaseSync
  token: string
  /**
   * The conversation the Provider knows this Session as, which is also what the adapter named
   * whatever it wrote for it: what {@link ProviderAdapter.forgetSession} is given when it ends.
   */
  providerSessionId: string
  adapter: ProviderAdapter
  pty: PtySession
  status: SessionStatus
  readyTimer?: ReturnType<typeof setTimeout>
  detach: (() => void)[]
  companyId: string
  mcpToken: string
  /** Where and as whom it was spawned, to spawn it again. */
  where: SessionTarget
  employee: Employee
  /**
   * The Employee's own record at spawn, before routing put it on a fallback: what an edit is
   * compared against (T268), so a Provider going out and coming back is never mistaken for one.
   */
  hired: Employee
  /** Spawned to continue a previous Session, and not yet confirmed by the provider. */
  resuming: boolean
  /** The Provider this process runs on: the Employee's own, or the fallback routing chose. */
  provider: Provider
  /** The account it was spawned as, or null. */
  accountId: string | null
  /** The subagents it runs inside its own process, as its hooks report them (T162). */
  subagents: SubagentModel
  /** What it stopped to ask the boss in its terminal, or null while it is asking nothing (T165). */
  ask: SessionAsk | null
  /** The Company settings its instructions were written from, or null when nothing reads them (T237). */
  spawnSettings: SpawnSettings | null
}

export function createSessions({
  providers,
  current: currentCompany,
  employees: currentEmployees,
  onSpawn,
  mcpUrl,
  mcpGrants,
  company,
  onBudgetExhausted,
  onAsking,
  brief,
  takeResume,
  onResumeFailed,
  refuseSession,
  subSessions,
  runAs = (_companyId, employee) => employee,
  accountFor = () => null,
  routingOf = () => null,
  rtkFor,
  spawnSettings,
}: SessionsOptions): SessionService {
  /** While `startIn` runs, the Company it starts in stands in for the current one. */
  let target: SessionTarget | null = null
  const current = () => target ?? currentCompany()
  const employees = () => target?.employees ?? currentEmployees()
  const running = new Map<string, Running>()
  const byToken = new Map<string, Running>()
  const byMcpToken = new Map<string, Running>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  subSessions?.onChange(notify)
  const activityListeners = new Set<(activity: SessionActivity) => void>()
  const report = (
    session: Running,
    hook: string | null = null,
    signal: SessionSignal | null = null,
    tool: string | null = null,
  ) => {
    const activity = { companyId: session.companyId, employeeId: session.employeeId, status: session.status }
    for (const listener of activityListeners) listener({ ...activity, hook, signal, tool, asking: session.ask })
  }

  function info(db: DatabaseSync, employeeId: string, companyId = current().companyId): SessionInfo {
    const row = db
      .prepare('SELECT provider_session_id, last_hook, last_hook_at, started_at FROM session WHERE employee_id = ?')
      .get(employeeId) as SessionRow | undefined
    const provider = employees().find((e) => e.id === employeeId)?.provider ?? null
    return {
      employeeId,
      status: running.get(employeeId)?.status ?? 'off',
      providerSessionId: row?.provider_session_id ?? null,
      lastHook: row?.last_hook ?? null,
      lastHookAt: row?.last_hook_at ?? null,
      startedAt: running.has(employeeId) ? (row?.started_at ?? null) : null,
      providerReady: provider === null || (providers[provider]?.installed() ?? false),
      subagents: running.get(employeeId)?.subagents.list() ?? [],
      subSessions: subSessions?.of(companyId, employeeId) ?? [],
      asking: running.get(employeeId)?.ask ?? null,
      routedTo: routingOf(companyId, employeeId),
    }
  }

  function setStatus(session: Running, status: SessionStatus): void {
    if (session.status === status) return
    session.status = status
    notify()
    report(session)
  }

  function end(session: Running): void {
    if (running.get(session.employeeId) !== session) return
    running.delete(session.employeeId)
    byToken.delete(session.token)
    byMcpToken.delete(session.mcpToken)
    clearTimeout(session.readyTimer)
    for (const detach of session.detach) detach()
    forget(session)
    session.status = 'off'
    // A Session that ends is asking nobody anything: the boss's desk clears with it.
    session.ask = null
    notify()
    report(session)
  }

  /**
   * The Session is over, so whatever its adapter wrote for it goes now (T199, finding H5). The
   * `mcpToken` above stops working the moment it leaves `byMcpToken`; the file that holds it does
   * not stop being readable by every other Employee on this machine, and nothing else ever deletes
   * it. An adapter that wrote nothing has nothing to do here.
   */
  function forget(session: Running): void {
    session.adapter.forgetSession?.(session.providerSessionId)
  }

  function budgetCheck(session: Running, output: string): boolean {
    if (!onBudgetExhausted || !session.adapter.detectBudgetExhausted(output)) return false
    onBudgetExhausted({
      companyId: session.companyId,
      employeeId: session.employeeId,
      provider: session.provider,
      accountId: session.accountId,
      resetsAt: session.adapter.budgetResetAt(output, new Date()),
    })
    return true
  }

  function watchBudget(session: Running): void {
    let recent = ''
    session.detach.push(
      session.pty.onData((data) => {
        recent = (recent + data).slice(-BUDGET_OUTPUT_WINDOW)
        if (budgetCheck(session, recent)) recent = ''
      }),
    )
  }

  /** Spawns a Session, continuing `resumeId` when given, and makes it the Employee's running one. */
  function launch(where: SessionTarget, employee: Employee, resumeId: string | null, hired = employee): Running {
    const { folder, db, companyId } = where
    const adapter = providers[employee.provider]!
    const providerSessionId = resumeId ?? randomUUID()
    const token = randomBytes(24).toString('base64url')
    const mcpToken = randomBytes(24).toString('base64url')
    const granted = mcpGrants?.(where, employee) ?? []
    const companyServer = mcpUrl ? { url: mcpUrl(companyId, employee.provider), token: mcpToken } : null
    if (companyServer || granted.length > 0) {
      adapter.injectMcp(providerSessionId, { company: companyServer, granted })
    }
    const account = accountFor(companyId, employee)
    const rtk = rtkFor?.(companyId) ?? null
    const companyBrief = brief?.(companyId, employee)
    const pty = adapter.spawn({
      employee,
      cwd: folder,
      ...(companyBrief && { instructions: renderInstructions(employee, companyBrief) }),
      sessionId: providerSessionId,
      resume: resumeId !== null,
      hookToken: token,
      ...(account && { account }),
      ...(rtk && { rtk }),
    })
    onSpawn?.(employee.id, pty)
    db.prepare(
      `INSERT INTO session (employee_id, provider, provider_session_id, started_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (employee_id) DO UPDATE SET provider = excluded.provider,
         provider_session_id = excluded.provider_session_id, started_at = excluded.started_at`,
    ).run(employee.id, employee.provider, providerSessionId, new Date().toISOString())

    const session: Running = {
      employeeId: employee.id,
      db,
      token,
      providerSessionId,
      adapter,
      pty,
      status: running.get(employee.id)?.status ?? 'off',
      detach: [],
      companyId,
      mcpToken,
      where,
      employee,
      hired,
      resuming: resumeId !== null,
      provider: employee.provider,
      accountId: account?.id ?? null,
      subagents: createSubagentModel(),
      ask: null,
      spawnSettings: spawnSettings?.(companyId) ?? null,
    }
    running.set(employee.id, session)
    byToken.set(token, session)
    byMcpToken.set(mcpToken, session)
    session.detach.push(pty.onExit(() => (session.resuming ? startFresh(session) : end(session))))
    watchBudget(session)
    setStatus(session, 'starting')
    return session
  }

  /**
   * A resumed Session exited before the provider confirmed it: spawn a fresh one in its place,
   * without passing through `off`, so its concurrency slot is kept.
   */
  /**
   * The Employee's record as the Company holds it now, or null when it is not one of its people
   * any more. An open Company answers for itself; the current one answers without being asked.
   */
  function savedRecord(session: Running, where: SessionTarget | null): Employee | null {
    const people = where?.employees ?? (sameAsCurrent(session.companyId) ? employees() : null)
    return people?.find((employee) => employee.id === session.employeeId) ?? null
  }

  function sameAsCurrent(companyId: string): boolean {
    try {
      return current().companyId === companyId
    } catch {
      return false
    }
  }

  function startFresh(failed: Running): void {
    if (!release(failed)) return
    // The conversation it failed to continue is not coming back, and the fresh Session below is
    // given an id of its own: what was written for the old one would be left behind for good.
    forget(failed)
    launch(failed.where, failed.employee, null, failed.hired)
    onResumeFailed?.(failed.companyId, failed.employeeId)
  }

  /**
   * Lets go of everything this process holds — its tokens, its timer and its listeners — without
   * telling anybody it stopped, for the two places that put another Session in its seat.
   *
   * False when it is not the Employee's running Session any more, which is the whole guard: an
   * exit that arrives after the Session was replaced must not take the replacement apart.
   */
  function release(session: Running): boolean {
    if (running.get(session.employeeId) !== session) return false
    byToken.delete(session.token)
    byMcpToken.delete(session.mcpToken)
    clearTimeout(session.readyTimer)
    for (const detach of session.detach) detach()
    return true
  }

  const sessions: SessionService = {
    list() {
      const { db } = current()
      return employees().map((employee) => info(db, employee.id))
    },

    get(employeeId) {
      return info(current().db, employeeId)
    },

    staleSessions() {
      const { companyId } = current()
      const now = spawnSettings?.(companyId)
      if (!now) return []
      return employees().flatMap((employee) => {
        const session = running.get(employee.id)
        if (!session || session.companyId !== companyId || !session.spawnSettings) return []
        const settings = changedSettings(session.spawnSettings, now)
        return settings.length > 0 ? [{ employeeId: employee.id, settings }] : []
      })
    },

    handoffCommand(employeeId) {
      const { db, companyId } = current()
      const hired = employees().find((e) => e.id === employeeId)
      if (!hired) return null
      const employee = runAs(companyId, hired)
      const last = db
        .prepare('SELECT provider, provider_session_id FROM session WHERE employee_id = ?')
        .get(employeeId) as { provider: string; provider_session_id: string } | undefined
      // A Session the Employee ran on another Provider is not one this Provider can continue, and
      // an id of the wrong shape is not one to hand the boss a command line built out of.
      if (!last || last.provider !== employee.provider || !isProviderSessionId(last.provider_session_id)) return null
      const argv = providers[employee.provider]?.handoffCommand?.(employee, last.provider_session_id)
      if (!argv || argv.length === 0) return null
      return handoff(argv, last.provider_session_id)
    },

    start(employeeId) {
      const { folder, db, companyId } = current()
      const hired = employees().find((e) => e.id === employeeId)
      if (!hired) throw new Error(`Unknown Employee: ${employeeId}`)
      // While its own Provider is out, an Employee is started on the fallback its rule names (T173).
      const employee = runAs(companyId, hired)
      if (running.has(employeeId)) throw new Error(`${employee.name}’s Session is already running`)
      const adapter = providers[employee.provider]
      if (!adapter) throw new Error(`No provider adapter for ${employee.provider}`)
      // The Launcher's own sentence first (T129); the catalogue's generic one for the rest.
      const refusal = refuseSession?.(employee.provider)
      if (refusal) throw new Error(refusal)
      if (!adapter.installed()) throw new Error(providerMissing(employee.provider))
      const wantsResume = takeResume?.(companyId, employeeId) ?? false
      const last = wantsResume
        ? (db.prepare('SELECT provider, provider_session_id FROM session WHERE employee_id = ?').get(employeeId) as
            | { provider: string; provider_session_id: string }
            | undefined)
        : undefined
      // The stored id is checked again on the way out, not only on the way in: a hook wrote it,
      // and rows written before hooks were checked are still on disk (T199-H1). An id this app
      // would not have written means no resume at all — a fresh Session, and the boss is told.
      const resumeId =
        last?.provider === employee.provider &&
        isProviderSessionId(last.provider_session_id) &&
        adapter.resumeCommand(last.provider_session_id)
          ? last.provider_session_id
          : null
      launch({ folder, db, companyId, employees: employees() }, employee, resumeId, hired)
      if (last && !resumeId) onResumeFailed?.(companyId, employeeId)
      return info(db, employeeId)
    },

    startIn(companyId, employeeId) {
      const found = company?.(companyId)
      if (!found) throw new Error(`Company ${companyId} is not open`)
      target = found
      try {
        return sessions.start(employeeId)
      } finally {
        target = null
      }
    },

    stop(employeeId) {
      const session = running.get(employeeId)
      if (session) {
        end(session)
        session.pty.kill()
      }
      return sessions.get(employeeId)
    },

    restart(employeeId) {
      const session = running.get(employeeId)
      // Mid-turn is not a moment to restart an Employee in: whoever asked is told no, and asks
      // again when the turn ends.
      if (!session || session.status !== 'idle') return false
      // Spawned from the Employee as the boss last saved them (T268): a persona, a model or an MCP
      // server added since reaches a Session only through a spawn, and a restart that reused the
      // record it started with would bring the old one straight back.
      const where = company?.(session.companyId) ?? session.where
      const hired = savedRecord(session, where) ?? session.hired
      const employee = runAs(session.companyId, hired)
      // The same conversation, so the same id — `--resume`, and instructions written again from
      // what the Company says now. A Provider that cannot continue one, or an Employee moved to
      // another Provider, is not a reason to leave the Employee off: it starts fresh and is
      // primed, exactly as a failed resume at start is.
      const resumable =
        employee.provider === session.provider && session.adapter.resumeCommand(session.providerSessionId)
      const resumeId = resumable ? session.providerSessionId : null
      if (!release(session)) return false
      session.pty.kill()
      if (resumeId === null) forget(session)
      launch(where, employee, resumeId, hired)
      if (resumeId === null) onResumeFailed?.(session.companyId, session.employeeId)
      return true
    },

    editedSessions() {
      return [...running.values()].flatMap((session) => {
        const saved = savedRecord(session, company?.(session.companyId) ?? null)
        return saved && spawnInputs(saved) !== spawnInputs(session.hired) ? [session.employeeId] : []
      })
    },

    receiveHook(token, payload) {
      const session = byToken.get(token)
      if (!session) {
        subSessions?.receiveHook(token, payload)
        return
      }
      const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : null
      session.db
        .prepare(
          `UPDATE session SET last_hook = ?, last_hook_at = ?,
             provider_session_id = COALESCE(?, provider_session_id)
           WHERE employee_id = ?`,
        )
        .run(event, new Date().toISOString(), hookSessionId(session.adapter, payload), session.employeeId)

      budgetCheck(session, providerOutput(payload))
      const signal = session.adapter.detectIdle(payload)
      const ask = askOf(signal)
      if (ask) {
        // One ask at a time: a Provider that repeats its permission hook does not ring twice.
        if (!session.ask) {
          session.ask = { what: ask.what, since: new Date().toISOString() }
          notify()
          onAsking?.({ companyId: session.companyId, employeeId: session.employeeId, ask: session.ask })
        }
      } else if (signal !== null && session.ask) {
        // Anything the Session says next — a tool, a prompt, the end of its turn — means it moved on.
        session.ask = null
        notify()
      }
      switch (signal) {
        case 'ready':
          if (session.resuming) {
            session.resuming = false
            if (!(session.adapter.confirmsResume?.(payload) ?? true)) {
              onResumeFailed?.(session.companyId, session.employeeId)
            }
          }
          if (session.status !== 'starting') break
          clearTimeout(session.readyTimer)
          session.readyTimer = setTimeout(() => {
            if (session.status === 'starting') setStatus(session, 'idle')
          }, READY_DELAY_MS)
          break
        case 'busy':
          setStatus(session, 'busy')
          break
        case 'idle':
          setStatus(session, 'idle')
          break
      }
      const subagent = session.adapter.subagentOf?.(payload)
      if (subagent && session.subagents.apply(subagent, new Date()) && running.get(session.employeeId) === session) {
        notify()
      }
      const tool = typeof payload['tool_name'] === 'string' ? payload['tool_name'] : null
      if (running.get(session.employeeId) === session) report(session, event, signal, tool)
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    stopAll() {
      for (const employeeId of [...running.keys()]) sessions.stop(employeeId)
    },

    mcpCaller(token) {
      const session = byMcpToken.get(token)
      if (!session) return subSessions?.mcpCaller(token) ?? null
      return { companyId: session.companyId, employeeId: session.employeeId }
    },

    onActivity(listener) {
      activityListeners.add(listener)
      return () => activityListeners.delete(listener)
    },

    pushPrompt(employeeId, text) {
      const session = running.get(employeeId)
      if (session?.status !== 'idle') return false
      session.adapter.pushPrompt(session.pty, text)
      return true
    },
  }
  return sessions
}

interface SessionRow {
  provider_session_id: string
  last_hook: string | null
  last_hook_at: string | null
  started_at: string
}

/** The last Session of each Employee. Status is not stored: every Session is off when the app opens. */
/** How much of a session id the toast reads back, as frame `zOVl6` abbreviates it: `3f2a…`. */
const SHOWN_ID_CHARS = 4

/** The handoff as the drawer takes it: the whole line, and the same line with the session id short. */
export function handoff(argv: readonly string[], providerSessionId: string): SessionHandoff {
  const command = argv.map(shellQuote).join(' ')
  const short = providerSessionId.slice(0, SHOWN_ID_CHARS)
  return {
    command,
    shown:
      providerSessionId.length > SHOWN_ID_CHARS ? command.split(providerSessionId).join(`${short}\u2026`) : command,
  }
}

/** One argument as a shell takes it back: bare when it is plain, single-quoted when it is not. */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.split("'").join(`'\\''`)}'`
}

export const SESSIONS_MIGRATION: Migration = {
  name: 'sessions-table',
  sql: `
  CREATE TABLE session (
    employee_id TEXT PRIMARY KEY REFERENCES employee (id),
    provider TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    last_hook TEXT,
    last_hook_at TEXT
  );
`,
}

/**
 * What of an Employee a spawn reads (T268), as one string to compare: everything but its id, the
 * desk and sprite the office draws, when it was hired, and which fields it overrides — an override
 * the boss turns on with the value the role already had changes nothing a Session is told.
 */
function spawnInputs(employee: Employee): string {
  const { id: _id, desk: _desk, sprite: _sprite, createdAt: _createdAt, overrides: _overrides, ...read } = employee
  return JSON.stringify(read)
}
