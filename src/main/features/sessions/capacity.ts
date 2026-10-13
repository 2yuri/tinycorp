import type { DatabaseSync } from 'node:sqlite'
import {
  type BudgetExhausted,
  type CapacityInfo,
  type ProviderOutage,
  UNKNOWN_RESET_RETRY_MS,
} from '../../../shared/capacity'
import { COMPANY_AUTHOR, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { ClaudeUsage } from '../../../shared/providers/claude-usage'
import type { SessionInfo, SessionStatus } from '../../../shared/session'
import type { Migration } from '../../core'
import type { Chat } from '../chat'
import type { BudgetSignal, SessionActivity, SessionService, Sessions } from './sessions'

/** Sessions a Company runs at once until the boss changes it (decision 18). */
export const DEFAULT_CONCURRENCY_CAP = 5

export { UNKNOWN_RESET_RETRY_MS }

/** The capacity migration step, appended to the engine's migrations. */
export const CAPACITY_MIGRATION: Migration = {
  name: 'capacity-settings',
  sql: `
  CREATE TABLE capacity_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    concurrency_cap INTEGER NOT NULL
  );
`,
}

/** The concurrency cap and budget state of the current Company. */
export interface Capacity {
  get(): CapacityInfo
  /**
   * What the boss spends of the one subscription: every open Company's Sessions against its own
   * cap, whoever waits for a slot, and the app-wide budget.
   */
  usage(): ClaudeUsage
  /** Sets the current Company's cap. Raising it starts parked Employees; lowering it stops no one. */
  setConcurrencyCap(cap: number): CapacityInfo
  /** Called after the cap, the parked queue, the running count or the budget changes. */
  onChange(listener: () => void): () => void
}

/** How many Employees of a Company wait for a slot right now, in queue order. */
export interface ParkedQueue {
  companyId: string
  employeeIds: string[]
}

/** The engine's side of capacity. */
export interface CapacityService extends Capacity {
  /**
   * The Sessions everyone else sees: `start` parks beyond the cap, a freed slot starts the
   * longest-parked Employee, and nothing is pushed while the budget is exhausted.
   */
  sessions: Sessions
  /** A Session's output said the subscription limit was hit, on one Provider and one account. */
  budgetExhausted(signal: BudgetSignal): void
  /** Every Provider that is out right now, oldest first. */
  outages(): ProviderOutage[]
  /**
   * Puts back an outage the app already knew about when it started (T173), without posting
   * anything: the Company was told when the limit was hit, in the run that hit it.
   */
  restoreOutage(outage: ProviderOutage): void
  /**
   * `provider` has room again: its Sessions stop showing `out_of_budget`, their stale terminal
   * output is ignored, and prompts are pushed to them again. Unknown Providers are ignored.
   */
  providerReset(provider: string): void
  /** Says when `provider`'s limit resets, for an outage that named no time when it was reported. */
  learnedReset(provider: string, resetsAt: Date | null, nextCheckAt: Date | null): void
  /** Starts an Employee of any open Company under that Company's cap, parking it beyond it. */
  startIn(companyId: string, employeeId: string): void
  /** Stops an Employee of any open Company, parked or running. */
  stopIn(companyId: string, employeeId: string): void
  /** Who waits for a slot in each open Company, longest-waiting first. */
  queues(): ParkedQueue[]
  /**
   * Seats taken by an Employee's own sub-sessions (T163). Each is a full Session under the same cap
   * as the Employees', and waits in the same queue when there is none.
   */
  seats: SubSessionSeats
  /** Drops a closed Company's parked Employees. */
  forgetCompany(companyId: string): void
  close(): void
}

/** A seat under the concurrency cap for something that is not an Employee's own Session. */
export interface SubSessionSeats {
  /**
   * Takes one of the Company's seats for `key` and calls `start` with it: now when one is free,
   * else once one frees, in the order everyone asked — the same queue a parked Employee waits in.
   */
  take(companyId: string, key: string, start: () => void): 'taken' | 'waiting'
  /** Gives back the seat `key` holds, or its place in the queue. Unknown keys are ignored. */
  release(key: string): void
}

/** Who waits for a seat: an Employee's own Session, or a sub-session. */
type Waiter = { employeeId: string } | { seat: string; start: () => void }

export interface CapacityOptions {
  sessions: SessionService
  /** The current Company's id, database and Employees; throws when none is open. */
  current(): { companyId: string; db: DatabaseSync; employees: Employee[] }
  /** An open Company's database and chat, or null. */
  company(companyId: string): { db: DatabaseSync; chat: Chat } | null
  /** Every open Company, so usage can count across all of them. */
  companies(): { id: string; name: string; db: DatabaseSync; employees: Employee[] }[]
  log(line: string): void
  /** Called once the budget runs out, with the `#general` message each Company got. */
  onBudgetExhausted?(posts: { companyId: string; message: Message }[], resetsAt: Date | null): void
  /**
   * The Provider an Employee's Session actually runs on, which is its own unless routing moved it
   * to a fallback (T173). Without it, every Employee runs on the Provider it was hired on.
   */
  effectiveProvider?(companyId: string, employeeId: string, hired: string): string
  /**
   * Whether a Company's team really stops when `provider` runs out (T173). It does not when the
   * Company's rule moves its Employees somewhere else: the routing lines then say what happened,
   * and `#general` is not told twice.
   */
  teamStopped?(companyId: string, provider: string): boolean
  /**
   * Called each time a Provider goes out, and each time one comes back. Whoever schedules the
   * resume listens here; capacity itself keeps no timer, so the schedule can outlive the process.
   */
  onOutageChange?(outage: ProviderOutage | null, provider: string): void
  now?(): number
}

/** How a reset time reads in `#general`. */
export function formatResetTime(at: Date): string {
  return at.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

interface Outage {
  provider: string
  accountId: string | null
  exhaustedAt: Date
  resetsAt: Date | null
  nextCheckAt: Date | null
}

/**
 * The limits are per Provider, and so is what the app does about them (T173): when Claude runs out
 * the Employees on Claude stop, and the ones on Codex keep working. A Company whose whole team is
 * on the Provider that ran out is the old behaviour — everyone waits — and reads as `budget`.
 */
export function createCapacity({
  sessions: inner,
  current,
  company,
  companies,
  log,
  onBudgetExhausted,
  effectiveProvider = (_companyId, _employeeId, hired) => hired,
  teamStopped = () => true,
  onOutageChange,
  now = Date.now,
}: CapacityOptions): CapacityService {
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const activityListeners = new Set<(activity: SessionActivity) => void>()
  /** Company and own status of every Employee whose Session is running. */
  const live = new Map<string, { companyId: string; status: SessionStatus }>()
  /** Employees and sub-sessions waiting for a slot, per Company, longest-waiting first. */
  const parked = new Map<string, Waiter[]>()
  /** The Company of every sub-session holding a seat, by its key (T163). */
  const held = new Map<string, string>()
  /** One entry per Provider that is out, in the order they ran out. */
  const outages = new Map<string, Outage>()
  /**
   * Sessions that were running at the last reset. Their terminal may still show the old
   * limit message, so it is ignored until they take a new prompt.
   */
  const staleOutput = new Set<string>()

  function capOf(db: DatabaseSync): number {
    const row = db.prepare('SELECT concurrency_cap FROM capacity_setting WHERE id = 1').get() as
      | { concurrency_cap: number }
      | undefined
    return row?.concurrency_cap ?? DEFAULT_CONCURRENCY_CAP
  }

  const runningIn = (companyId: string) =>
    [...live.values()].filter((s) => s.companyId === companyId).length +
    [...held.values()].filter((id) => id === companyId).length
  /** The parked Employees of a Company, longest-waiting first. */
  const queueOf = (companyId: string) =>
    (parked.get(companyId) ?? []).flatMap((waiter) => ('employeeId' in waiter ? [waiter.employeeId] : []))
  const isParked = (companyId: string, employeeId: string) => queueOf(companyId).includes(employeeId)

  function shown(companyId: string, info: SessionInfo): SessionInfo {
    return { ...info, status: shownStatus(companyId, info.employeeId, info.status) }
  }

  /** Every Employee of an open Company, whether it is the current one or not. */
  function employeesIn(companyId: string): Employee[] {
    return companies().find((entry) => entry.id === companyId)?.employees ?? []
  }

  /** The Provider an Employee's Session runs on now: its own, or the fallback routing moved it to. */
  function providerOf(companyId: string, employeeId: string): string | null {
    const hired = employeesIn(companyId).find((employee) => employee.id === employeeId)?.provider
    return hired ? effectiveProvider(companyId, employeeId, hired) : null
  }

  /** Whether the Provider this Employee runs on is out right now. */
  function isOut(companyId: string, employeeId: string): boolean {
    const provider = providerOf(companyId, employeeId)
    return provider !== null && outages.has(provider)
  }

  function shownStatus(companyId: string, employeeId: string, status: SessionStatus): SessionStatus {
    if (status === 'off') return isParked(companyId, employeeId) ? 'parked' : 'off'
    return isOut(companyId, employeeId) ? 'out_of_budget' : status
  }

  function emit(activity: SessionActivity): void {
    for (const listener of activityListeners) listener(activity)
  }

  /** Starts parked Employees of a Company while it has free slots. */
  function fill(companyId: string): void {
    const db = company(companyId)?.db
    const queue = parked.get(companyId)
    if (!db || !queue) return
    while (queue.length > 0 && runningIn(companyId) < capOf(db)) {
      const waiter = queue.shift()!
      if ('seat' in waiter) {
        held.set(waiter.seat, companyId)
        notify()
        try {
          waiter.start()
        } catch (error) {
          held.delete(waiter.seat)
          log(`Capacity: could not start sub-session ${waiter.seat}: ${(error as Error).message}`)
        }
        continue
      }
      const employeeId = waiter.employeeId
      try {
        inner.startIn(companyId, employeeId)
      } catch (error) {
        log(`Capacity: could not start parked Employee ${employeeId}: ${(error as Error).message}`)
        notify()
      }
    }
  }

  const stopInner = inner.onActivity((activity) => {
    const { companyId, employeeId, status, hook } = activity
    if (status === 'off') live.delete(employeeId)
    else live.set(employeeId, { companyId, status })
    if (status === 'off' || hook === 'UserPromptSubmit') staleOutput.delete(employeeId)
    emit({ ...activity, status: shownStatus(companyId, employeeId, status) })
    if (status === 'off') fill(companyId)
  })
  const stopInnerChange = inner.onChange(notify)

  function outageList(): ProviderOutage[] {
    return [...outages.values()]
      .sort((a, b) => a.exhaustedAt.getTime() - b.exhaustedAt.getTime())
      .map((outage) => ({
        provider: outage.provider,
        accountId: outage.accountId,
        exhaustedAt: outage.exhaustedAt.toISOString(),
        resetsAt: outage.resetsAt?.toISOString() ?? null,
        nextCheckAt: outage.nextCheckAt?.toISOString() ?? null,
      }))
  }

  /**
   * The team is stopped when every Provider its Employees run on is out — which is every Company
   * that runs on one Provider, and the shape the office overlay was written for. A Company spread
   * over two Providers with one out is not stopped: those Employees route or wait on their own.
   */
  function budgetOf(employees: { companyId: string; employees: Employee[] }[]): BudgetExhausted | null {
    if (outages.size === 0) return null
    const inUse = new Set(
      employees.flatMap(({ companyId, employees: staff }) =>
        staff.map((employee) => effectiveProvider(companyId, employee.id, employee.provider)),
      ),
    )
    if (inUse.size === 0 || [...inUse].some((provider) => !outages.has(provider))) return null
    const oldest = outageList()[0]!
    return { exhaustedAt: oldest.exhaustedAt, resetsAt: oldest.resetsAt }
  }

  function info(): CapacityInfo {
    const { companyId, db, employees } = current()
    return {
      concurrencyCap: capOf(db),
      running: runningIn(companyId),
      parked: [...queueOf(companyId)],
      budget: budgetOf([{ companyId, employees }]),
      outages: outageList(),
    }
  }

  /** The same numbers as {@link info}, for every open Company at once, with parked Employees named. */
  function usage(): ClaudeUsage {
    return {
      companies: companies().map(({ id, name, db, employees }) => ({
        companyId: id,
        companyName: name,
        concurrencyCap: capOf(db),
        running: runningIn(id),
        parked: queueOf(id).map((employeeId) => employees.find((e) => e.id === employeeId)?.name ?? employeeId),
      })),
      budget: budgetOf(companies().map((entry) => ({ companyId: entry.id, employees: entry.employees }))),
    }
  }

  const sessions: Sessions = {
    list() {
      const { companyId } = current()
      return inner.list().map((s) => shown(companyId, s))
    },

    get(employeeId) {
      return shown(current().companyId, inner.get(employeeId))
    },

    start(employeeId) {
      const { companyId, db, employees } = current()
      const employee = employees.find((e) => e.id === employeeId)
      if (!employee) throw new Error(`Unknown Employee: ${employeeId}`)
      if (live.has(employeeId) || isParked(companyId, employeeId)) {
        throw new Error(`${employee.name}’s Session is already running or parked`)
      }
      if (runningIn(companyId) < capOf(db)) return shown(companyId, inner.start(employeeId))
      parked.set(companyId, [...(parked.get(companyId) ?? []), { employeeId }])
      notify()
      emit({ companyId, employeeId, status: 'parked', hook: null, signal: null })
      return sessions.get(employeeId)
    },

    stop(employeeId) {
      const { companyId } = current()
      if (isParked(companyId, employeeId)) {
        parked.set(
          companyId,
          (parked.get(companyId) ?? []).filter(
            (waiter) => !('employeeId' in waiter) || waiter.employeeId !== employeeId,
          ),
        )
        notify()
        emit({ companyId, employeeId, status: 'off', hook: null, signal: null })
        return sessions.get(employeeId)
      }
      return shown(companyId, inner.stop(employeeId))
    },

    /**
     * A restart keeps the Session's seat, so the cap has nothing to say about it — except while
     * the Provider it runs on is out, when a Session is left alone the same way a prompt is (T237).
     */
    restart(employeeId) {
      const { companyId } = current()
      return isOut(companyId, employeeId) ? false : inner.restart(employeeId)
    },

    staleSessions: () => inner.staleSessions(),

    editedSessions: () => inner.editedSessions(),

    receiveHook: (token, payload) => inner.receiveHook(token, payload),

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    stopAll() {
      parked.clear()
      inner.stopAll()
    },

    mcpCaller: (token) => inner.mcpCaller(token),

    onActivity(listener) {
      activityListeners.add(listener)
      return () => activityListeners.delete(listener)
    },

    pushPrompt(employeeId, text) {
      const { companyId } = current()
      return isOut(companyId, employeeId) ? false : inner.pushPrompt(employeeId, text)
    },

    handoffCommand: (employeeId) => inner.handoffCommand(employeeId),
  }

  return {
    sessions,

    get: info,

    usage,

    setConcurrencyCap(cap) {
      if (!Number.isInteger(cap) || cap < 1) {
        throw new Error(`The concurrency cap must be a whole number of at least 1, not ${cap}`)
      }
      const { companyId, db } = current()
      db.prepare(
        `INSERT INTO capacity_setting (id, concurrency_cap) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET concurrency_cap = excluded.concurrency_cap`,
      ).run(cap)
      notify()
      fill(companyId)
      return info()
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    budgetExhausted({ companyId, employeeId, provider, accountId, resetsAt }) {
      if (staleOutput.has(employeeId)) return
      const known = outages.get(provider)
      if (known) {
        // A second Session saying the same thing adds nothing, unless it names the time the first did not.
        if (known.resetsAt || !resetsAt) return
        outages.set(provider, { ...known, resetsAt, nextCheckAt: null })
        onOutageChange?.(outageList().find((o) => o.provider === provider) ?? null, provider)
        return notify()
      }
      const exhaustedAt = new Date(now())
      outages.set(provider, { provider, accountId, exhaustedAt, resetsAt, nextCheckAt: null })
      const back = resetsAt
        ? `They will be back at ${formatResetTime(resetsAt)}.`
        : `The reset time is unknown, so they will try again at ${formatResetTime(
            new Date(exhaustedAt.getTime() + UNKNOWN_RESET_RETRY_MS),
          )}.`
      const text =
        `Out of budget: the subscription usage limit was hit, so the whole team is paused ` +
        `and no prompts will be pushed. ${back}`
      const posts: { companyId: string; message: Message }[] = []
      // Only the Companies whose own Employees are stopped by this hear about it.
      for (const id of new Set([companyId, ...[...live.values()].map((s) => s.companyId)])) {
        if (!budgetOf([{ companyId: id, employees: employeesIn(id) }])) continue
        if (!teamStopped(id, provider)) continue
        const chat = company(id)?.chat
        const message = chat?.post({ authorId: COMPANY_AUTHOR, channelId: 'general', text })
        if (message) posts.push({ companyId: id, message })
      }
      if (posts.length > 0) onBudgetExhausted?.(posts, resetsAt)
      onOutageChange?.(outageList().find((o) => o.provider === provider) ?? null, provider)
      notify()
      for (const [id, { companyId: where }] of live) {
        if (isOut(where, id))
          emit({ companyId: where, employeeId: id, status: 'out_of_budget', hook: null, signal: null })
      }
    },

    outages: outageList,

    restoreOutage(outage) {
      if (outages.has(outage.provider)) return
      outages.set(outage.provider, {
        provider: outage.provider,
        accountId: outage.accountId,
        exhaustedAt: new Date(outage.exhaustedAt),
        resetsAt: outage.resetsAt ? new Date(outage.resetsAt) : null,
        nextCheckAt: outage.nextCheckAt ? new Date(outage.nextCheckAt) : null,
      })
      notify()
    },

    providerReset(provider) {
      if (!outages.delete(provider)) return
      for (const [employeeId, { companyId }] of live) {
        if (providerOf(companyId, employeeId) === provider) staleOutput.add(employeeId)
      }
      onOutageChange?.(null, provider)
      notify()
      for (const [employeeId, { companyId, status }] of live) {
        emit({ companyId, employeeId, status, hook: null, signal: null })
      }
    },

    learnedReset(provider, resetsAt, nextCheckAt) {
      const known = outages.get(provider)
      if (!known) return
      outages.set(provider, { ...known, resetsAt: resetsAt ?? known.resetsAt, nextCheckAt })
      notify()
    },

    startIn(companyId, employeeId) {
      const found = company(companyId)
      if (!found) throw new Error(`Company ${companyId} is not open`)
      if (live.has(employeeId) || isParked(companyId, employeeId)) return
      if (runningIn(companyId) < capOf(found.db)) {
        inner.startIn(companyId, employeeId)
        return
      }
      parked.set(companyId, [...(parked.get(companyId) ?? []), { employeeId }])
      notify()
      emit({ companyId, employeeId, status: 'parked', hook: null, signal: null })
    },

    stopIn(companyId, employeeId) {
      if (isParked(companyId, employeeId)) {
        parked.set(
          companyId,
          (parked.get(companyId) ?? []).filter((w) => !('employeeId' in w) || w.employeeId !== employeeId),
        )
        notify()
        emit({ companyId, employeeId, status: 'off', hook: null, signal: null })
        return
      }
      inner.stop(employeeId)
    },

    queues: () => [...parked.keys()].map((companyId) => ({ companyId, employeeIds: queueOf(companyId) })),

    seats: {
      take(companyId, key, start) {
        const db = company(companyId)?.db
        if (!db) throw new Error(`Company ${companyId} is not open`)
        const queue = parked.get(companyId) ?? []
        // Whoever asked first goes first: a free seat is not taken past someone already waiting.
        if (queue.length === 0 && runningIn(companyId) < capOf(db)) {
          held.set(key, companyId)
          notify()
          try {
            start()
          } catch (error) {
            held.delete(key)
            notify()
            throw error
          }
          return 'taken'
        }
        parked.set(companyId, [...queue, { seat: key, start }])
        notify()
        fill(companyId)
        return held.has(key) ? 'taken' : 'waiting'
      },

      release(key) {
        const companyId = held.get(key)
        if (companyId !== undefined) {
          held.delete(key)
          notify()
          fill(companyId)
          return
        }
        for (const [id, queue] of parked) {
          const kept = queue.filter((waiter) => !('seat' in waiter) || waiter.seat !== key)
          if (kept.length === queue.length) continue
          parked.set(id, kept)
          notify()
        }
      },
    },

    forgetCompany(companyId) {
      for (const [key, id] of held) if (id === companyId) held.delete(key)
      if (parked.delete(companyId)) notify()
    },

    close() {
      outages.clear()
      stopInner()
      stopInnerChange()
      parked.clear()
      held.clear()
      live.clear()
      listeners.clear()
      activityListeners.clear()
    },
  }
}
