import type { DatabaseSync } from 'node:sqlite'
import { type ProviderOutage, UNKNOWN_RESET_RETRY_MS } from '../../../shared/capacity'
import { COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { PROVIDER_SHORT_NAME } from '../../../shared/domain/providers'
import type { Employee, Provider } from '../../../shared/domain/staff'
import { clockTime } from '../../../shared/platform/clock-time'
import type { SessionRouting } from '../../../shared/session'
import {
  movesBack,
  type OutOfProviderRule,
  pinnedAccountFor,
  ruleFor,
  unknownResetBackoffMs,
} from '../../../shared/usage/usage-routing'
import type { ProviderAdapters, SpawnAccount } from '../../providers'
import type { Chat } from '../chat'
import type { BudgetSignal, CapacityService, SessionActivity } from '../sessions'
import { handoffPrompt, type RoutingHandoff } from '../sessions'
import type { ProviderAccounts } from './provider-accounts'
import type { UsageRoutingStore } from './usage-routing'

/**
 * What one Provider running out did to the team, kept outside the process so the resume survives a
 * restart (T173). It holds ids and times; nothing about a credential and no message body.
 */
export interface OutageRecord {
  provider: string
  accountId: string | null
  exhaustedAt: string
  resetsAt: string | null
  /** How many cheap re-checks a limit with no known reset time has already had. */
  checks: number
  /** Employees stopped by it, in the order they were stopped: the queue the resume puts back. */
  waiting: { companyId: string; employeeId: string }[]
  /** Employees that carried on elsewhere, and where. */
  routed: { companyId: string; employeeId: string; to: string; model: string | null }[]
}

/** Where the outages are remembered between runs. */
export interface OutageStore {
  read(): OutageRecord[] | null
  write(records: OutageRecord[]): void
}

/** An outage store that forgets when the process ends: the default, and what tests use. */
export function memoryOutages(initial: OutageRecord[] = []): OutageStore {
  let held = [...initial]
  return {
    read: () => held.map((record) => ({ ...record })),
    write(records) {
      held = records.map((record) => ({ ...record }))
    },
  }
}

/** How long the system lines wait for their fellows before one is posted (frame `tdI8o`, d). */
export const SYSTEM_LINE_BATCH_MS = 60_000

/** One open Company, as this module needs it. */
export interface RoutingCompany {
  db: DatabaseSync
  chat: Chat
  employees: Employee[]
  routing: UsageRoutingStore
  /** Records one line in the Company's activity log. */
  record(event: { kind: 'provider_switched' | 'provider_reset'; summary: string; detail: string | null }): void
  /** Everything the handoff prompt is built from, for one Employee. */
  handoff(employeeId: string, move: HandoffMove): RoutingHandoff
  /**
   * Writes the switch as a Handoff page in the Company memory and answers with its slug (T175).
   * Optional: a Company whose memory cannot be written still moves the Employee.
   */
  writeHandoffPage?(employeeId: string, handoff: RoutingHandoff, move: HandoffMove): string | null
  /** Claims that page for the Employee whose new Session is about to read it. Exactly once. */
  claimHandoffPage?(employeeId: string, slug: string): void
}

/** What a handoff is for: leaving a Provider that ran out, or going back to it. */
export interface HandoffMove {
  from: { provider: string; model: string | null }
  to: { provider: string; model: string | null }
  reason: 'out-of-budget' | 'moved-back'
  backAt: string | null
}

export interface UsageLimitsOptions {
  capacity: CapacityService
  providers: ProviderAdapters
  accounts: ProviderAccounts
  store?: OutageStore
  /** An open Company, or null. */
  company(companyId: string): RoutingCompany | null
  /** The ids of every open Company. */
  companies(): string[]
  /** Every Session's raw activity, before capacity masks an out-of-budget one. */
  watch(listener: (activity: SessionActivity) => void): () => void
  /**
   * When a Provider's limit resets, asked without spending any usage: the adapter's own status or
   * usage read, never a prompt. Null when it cannot say, which keeps the backoff going.
   */
  readReset?(provider: string, accountId: string | null): Promise<Date | null>
  log(line: string): void
  now?(): number
}

/**
 * Usage limits that handle themselves (T173): the resume is scheduled the moment a limit is hit
 * and survives a restart, Employees carry on somewhere else when their Company's rule says to, and
 * they move back at the next turn boundary when their own Provider resets.
 */
export interface UsageLimits {
  /** A Session said it hit the limit. */
  reported(signal: BudgetSignal): void
  /** The Employee a Session is started as: its own, or the fallback it was routed to. */
  runAs(companyId: string, employee: Employee): Employee
  /** The account a Session runs as, or null. */
  accountFor(companyId: string, employee: Employee): SpawnAccount | null
  /** The Provider an Employee's Session runs on now. */
  effectiveProvider(companyId: string, employeeId: string, hired: string): string
  /** Where an Employee is working while it is off its own Provider, for the drawer and the office. */
  routingOf(companyId: string, employeeId: string): SessionRouting | null
  /** `Continue on <P> now` — the boss does not wait for the rule. */
  continueNow(companyId: string, employeeId: string): void
  /** `Back to <P> now` — the boss moves an Employee home before the reset. */
  moveBackNow(companyId: string, employeeId: string): void
  /**
   * Whether this Company's team really stops when `provider` runs out: false when its rule moves
   * somebody somewhere else, so `#general` is not told the whole team is paused when it is not.
   */
  teamStopped(companyId: string, provider: string): boolean
  /** Every Provider that is out, as the renderer reads them. */
  outages(): ProviderOutage[]
  /** Drops a Company that closed. */
  forgetCompany(companyId: string): void
  close(): void
}

/** An Employee waiting for its turn to end before it is moved. */
interface PendingMove {
  companyId: string
  employeeId: string
  to: { provider: Provider; model: string | null } | null
  move: HandoffMove
}

export function createUsageLimits({
  capacity,
  providers,
  accounts,
  store = memoryOutages(),
  company,
  companies,
  watch,
  readReset,
  log,
  now = Date.now,
}: UsageLimitsOptions): UsageLimits {
  /** Where each routed Employee is working, by `companyId/employeeId`. */
  const routed = new Map<string, { from: Provider; to: Provider; model: string | null }>()
  /** Employees whose move happens the moment their turn ends. */
  const pending = new Map<string, PendingMove>()
  /** The handoff prompt each moved Employee gets the moment its new Session is ready, and its page. */
  const greeting = new Map<string, { prompt: string; page: string | null }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** The system lines waiting for their fellows, per Company. */
  const batches = new Map<string, { at: ReturnType<typeof setTimeout>; lines: string[] }>()

  const key = (companyId: string, employeeId: string) => `${companyId}/${employeeId}`
  const shortName = (provider: string) => PROVIDER_SHORT_NAME[provider as Provider] ?? provider

  function records(): OutageRecord[] {
    try {
      return store.read() ?? []
    } catch (error) {
      log(`Usage limits: could not read the stored outages: ${(error as Error).message}`)
      return []
    }
  }

  function save(next: OutageRecord[]): void {
    try {
      store.write(next)
    } catch (error) {
      log(`Usage limits: could not store the outages: ${(error as Error).message}`)
    }
  }

  function recordOf(provider: string): OutageRecord | null {
    return records().find((record) => record.provider === provider) ?? null
  }

  function putRecord(record: OutageRecord): void {
    save([...records().filter((entry) => entry.provider !== record.provider), record])
  }

  function dropRecord(provider: string): void {
    save(records().filter((record) => record.provider !== provider))
  }

  /** Clears whatever was scheduled for `provider` and schedules what its record now asks for. */
  function schedule(provider: string): void {
    clearTimeout(timers.get(provider))
    timers.delete(provider)
    const record = recordOf(provider)
    if (!record) return
    if (record.resetsAt) {
      const delay = Math.max(0, new Date(record.resetsAt).getTime() - now())
      timers.set(
        provider,
        setTimeout(() => reset(provider), delay),
      )
      return
    }
    // No reset time: ask again on a backoff, and give up on asking after the retry window.
    const exhaustedAt = new Date(record.exhaustedAt).getTime()
    const giveUpAt = exhaustedAt + UNKNOWN_RESET_RETRY_MS
    const nextAt = Math.min(now() + unknownResetBackoffMs(record.checks + 1), giveUpAt)
    capacity.learnedReset(provider, null, new Date(nextAt))
    timers.set(
      provider,
      setTimeout(
        () => {
          // The retry window is over: the team tries again rather than waiting on a time nobody named.
          if (nextAt >= giveUpAt) return reset(provider)
          if (!readReset) return bump(provider, null)
          void recheck(provider)
        },
        Math.max(0, nextAt - now()),
      ),
    )
  }

  /** One cheap read of when the limit resets. It spends no usage: it never sends a prompt. */
  async function recheck(provider: string): Promise<void> {
    const record = recordOf(provider)
    if (!record) return
    let resetsAt: Date | null = null
    try {
      resetsAt = (await readReset?.(provider, record.accountId)) ?? null
    } catch (error) {
      log(`Usage limits: could not re-check ${provider}: ${(error as Error).message}`)
    }
    bump(provider, resetsAt)
  }

  /** Records what a re-check learned — a time, or nothing — and schedules whatever comes next. */
  function bump(provider: string, resetsAt: Date | null): void {
    const current = recordOf(provider)
    if (!current) return
    putRecord({ ...current, checks: current.checks + 1, resetsAt: resetsAt ? resetsAt.toISOString() : null })
    capacity.learnedReset(provider, resetsAt, null)
    schedule(provider)
  }

  /** The Providers an Employee could be moved to right now: installed, and not out themselves. */
  function canRun(provider: string): boolean {
    const adapter = providers[provider as Provider]
    return adapter !== undefined && adapter.installed() && !recordOf(provider)
  }

  function ruleOf(companyId: string, employee: Employee, provider: string): OutOfProviderRule {
    const open = company(companyId)
    if (!open) return { kind: 'wait' }
    return ruleFor(open.routing.get(), open.routing.employee(employee.id), provider)
  }

  function reported(signal: BudgetSignal): void {
    const known = recordOf(signal.provider)
    capacity.budgetExhausted(signal)
    // `budgetExhausted` ignores a Session whose terminal is only redrawing the old message.
    if (!capacity.outages().some((outage) => outage.provider === signal.provider)) return
    const outage = capacity.outages().find((o) => o.provider === signal.provider)!
    if (known) {
      putRecord({ ...known, resetsAt: outage.resetsAt })
      schedule(signal.provider)
      return
    }
    putRecord({
      provider: signal.provider,
      accountId: signal.accountId,
      exhaustedAt: outage.exhaustedAt,
      resetsAt: outage.resetsAt,
      checks: 0,
      waiting: [],
      routed: [],
    })
    schedule(signal.provider)
    decide(signal.provider)
  }

  /** What every Employee on the Provider that just ran out does about it. */
  function decide(provider: string): void {
    const backAt = resetLabel(provider)
    for (const companyId of companies()) {
      const open = company(companyId)
      if (!open) continue
      const switched: string[] = []
      const waiting: string[] = []
      for (const employee of open.employees) {
        if (effectiveProvider(companyId, employee.id, employee.provider) !== provider) continue
        const rule = ruleOf(companyId, employee, provider)
        const rotated = rotationTarget(companyId, employee, provider)
        if (rotated) {
          // Another account of the same Provider, only because the boss turned rotation on.
          switched.push(employee.name)
          queueMove(companyId, employee.id, null, {
            from: { provider, model: employee.model },
            to: { provider, model: employee.model },
            reason: 'out-of-budget',
            backAt,
          })
          continue
        }
        if (rule.kind === 'continue' && canRun(rule.provider)) {
          switched.push(employee.name)
          queueMove(
            companyId,
            employee.id,
            { provider: rule.provider, model: rule.model },
            {
              from: { provider, model: employee.model },
              to: { provider: rule.provider, model: rule.model },
              reason: 'out-of-budget',
              backAt,
            },
          )
          continue
        }
        waiting.push(employee.name)
        rememberWaiting(provider, companyId, employee.id)
      }
      if (switched.length === 0) continue
      const to = switched.length > 0 ? routedNames(companyId, provider) : []
      queueLine(
        companyId,
        `${shortName(provider)} hit its limit · ${names(switched)} continued on ${names(to)} · back to ${shortName(provider)}${
          backAt ? ` at ${backAt}` : ' when it resets'
        }`,
      )
      if (waiting.length > 0) {
        queueLine(
          companyId,
          `${names(waiting)} ${waiting.length === 1 ? 'waits' : 'wait'} for the reset in the coffee area${
            backAt ? ` · back at ${backAt}` : ''
          }`,
        )
      }
      open.record({
        kind: 'provider_switched',
        summary: `routed around ${shortName(provider)}: ${names(switched)} continued elsewhere`,
        detail: waiting.length > 0 ? `${names(waiting)} waited for the reset` : null,
      })
    }
  }

  /** The Providers the switched Employees of a Company went to, as one list of names. */
  function routedNames(companyId: string, from: string): string[] {
    const seen = new Set<string>()
    for (const [id, where] of routed) {
      if (id.startsWith(`${companyId}/`) && where.from === from) seen.add(shortName(where.to))
    }
    for (const move of pending.values()) {
      if (move.companyId === companyId && move.to) seen.add(shortName(move.to.provider))
    }
    return [...seen]
  }

  /**
   * The account this Employee moves to when rotation is on and another one has room — the first
   * sign-in of the same Provider that is not the one that ran out. Null whenever rotation is off,
   * which is the default and what the warning in Company settings is about.
   */
  function rotationTarget(companyId: string, employee: Employee, provider: string): string | null {
    const open = company(companyId)
    if (!open?.routing.get().rotateAccounts) return null
    const spent = recordOf(provider)?.accountId ?? accountFor(companyId, employee)?.id ?? null
    const next = accounts.of(provider).find((account) => account.id !== spent)
    return next?.id ?? null
  }

  function rememberWaiting(provider: string, companyId: string, employeeId: string): void {
    const record = recordOf(provider)
    if (!record) return
    if (record.waiting.some((entry) => entry.employeeId === employeeId && entry.companyId === companyId)) return
    putRecord({ ...record, waiting: [...record.waiting, { companyId, employeeId }] })
  }

  /**
   * Queues a move for the next turn boundary. An Employee in the middle of an edit is never
   * stopped: it is moved when its own turn ends, or at once when it is not in one.
   */
  function queueMove(
    companyId: string,
    employeeId: string,
    to: { provider: Provider; model: string | null } | null,
    move: HandoffMove,
  ): void {
    pending.set(key(companyId, employeeId), { companyId, employeeId, to, move })
    const status = statusOf(companyId, employeeId)
    if (status !== 'busy' && status !== 'starting') apply(companyId, employeeId)
  }

  /** The raw status of a Session, before capacity masks it. */
  const rawStatus = new Map<string, SessionActivity['status']>()
  const statusOf = (companyId: string, employeeId: string) => rawStatus.get(key(companyId, employeeId)) ?? 'off'

  function apply(companyId: string, employeeId: string): void {
    const move = pending.get(key(companyId, employeeId))
    if (!move) return
    pending.delete(key(companyId, employeeId))
    const open = company(companyId)
    if (!open) return
    let prompt: string | null = null
    let page: string | null = null
    try {
      const handoff = open.handoff(employeeId, move.move)
      // The page is written before the prompt, so the prompt can name it (T175).
      page = open.writeHandoffPage?.(employeeId, handoff, move.move) ?? null
      prompt = handoffPrompt({ ...handoff, memoryPage: page })
    } catch (error) {
      log(`Usage limits: could not build ${employeeId}’s handoff: ${(error as Error).message}`)
    }
    try {
      capacity.stopIn(companyId, employeeId)
      if (move.to) {
        const employee = open.employees.find((entry) => entry.id === employeeId)
        routed.set(key(companyId, employeeId), {
          from: (employee?.provider ?? move.move.from.provider) as Provider,
          to: move.to.provider,
          model: move.to.model,
        })
        const record = recordOf(move.move.from.provider)
        if (record) {
          putRecord({
            ...record,
            routed: [
              ...record.routed.filter((entry) => entry.employeeId !== employeeId),
              { companyId, employeeId, to: move.to.provider, model: move.to.model },
            ],
          })
        }
      } else {
        routed.delete(key(companyId, employeeId))
      }
      if (prompt) greeting.set(key(companyId, employeeId), { prompt, page })
      capacity.startIn(companyId, employeeId)
    } catch (error) {
      log(`Usage limits: could not move ${employeeId}: ${(error as Error).message}`)
    }
  }

  /** A Provider has room again: its Sessions wake, and whoever left it comes home. */
  function reset(provider: string): void {
    const record = recordOf(provider)
    clearTimeout(timers.get(provider))
    timers.delete(provider)
    dropRecord(provider)
    capacity.providerReset(provider)
    if (!record) return
    const perCompany = new Map<string, { back: string[]; woken: string[] }>()
    for (const entry of record.routed) {
      const open = company(entry.companyId)
      if (!open) continue
      const employee = open.employees.find((person) => person.id === entry.employeeId)
      if (!employee) continue
      const lists = perCompany.get(entry.companyId) ?? { back: [], woken: [] }
      if (!movesBack(open.routing.get(), provider)) {
        perCompany.set(entry.companyId, lists)
        continue
      }
      lists.back.push(employee.name)
      perCompany.set(entry.companyId, lists)
      queueMove(entry.companyId, entry.employeeId, null, {
        from: { provider: entry.to, model: entry.model },
        to: { provider, model: employee.model },
        reason: 'moved-back',
        backAt: null,
      })
    }
    // Whoever waited goes back to a desk, in the order they stopped, under the concurrency cap.
    for (const entry of record.waiting) {
      const open = company(entry.companyId)
      if (!open?.routing.get().resumeAtReset) continue
      const employee = open.employees.find((person) => person.id === entry.employeeId)
      if (!employee) continue
      const lists = perCompany.get(entry.companyId) ?? { back: [], woken: [] }
      if (statusOf(entry.companyId, entry.employeeId) === 'off') {
        lists.woken.push(employee.name)
        try {
          capacity.startIn(entry.companyId, entry.employeeId)
        } catch (error) {
          log(`Usage limits: could not resume ${entry.employeeId}: ${(error as Error).message}`)
        }
      }
      perCompany.set(entry.companyId, lists)
    }
    for (const [companyId, { back, woken }] of perCompany) {
      const open = company(companyId)
      if (!open) continue
      const parts = [`${shortName(provider)} reset`]
      if (back.length > 0) parts.push(`${names(back)} moved back to ${shortName(provider)} at their next turn`)
      if (woken.length > 0) parts.push(`${names(woken)} ${woken.length === 1 ? 'is' : 'are'} back at their desk`)
      if (parts.length === 1) continue
      queueLine(companyId, parts.join(' · '))
      open.record({
        kind: 'provider_reset',
        summary: `${shortName(provider)} reset`,
        detail: parts.slice(1).join(' · ') || null,
      })
    }
  }

  function resetLabel(provider: string): string | null {
    const record = recordOf(provider)
    if (!record?.resetsAt) return null
    return clockTime(new Date(record.resetsAt), new Date(now()))
  }

  /** One `#general` line, batched with whatever else happens in the same minute (frame `tdI8o`). */
  function queueLine(companyId: string, line: string): void {
    const batch = batches.get(companyId)
    if (batch) {
      batch.lines.push(line)
      return
    }
    batches.set(companyId, {
      lines: [line],
      at: setTimeout(() => flush(companyId), SYSTEM_LINE_BATCH_MS),
    })
  }

  function flush(companyId: string): void {
    const batch = batches.get(companyId)
    if (!batch) return
    clearTimeout(batch.at)
    batches.delete(companyId)
    const open = company(companyId)
    if (!open) return
    for (const line of batch.lines) {
      try {
        open.chat.post({ authorId: COMPANY_AUTHOR, channelId: 'general', text: line })
      } catch (error) {
        log(`Usage limits: could not post to #general: ${(error as Error).message}`)
      }
    }
  }

  function effectiveProvider(companyId: string, employeeId: string, hired: string): string {
    return routed.get(key(companyId, employeeId))?.to ?? hired
  }

  function accountFor(companyId: string, employee: Employee): SpawnAccount | null {
    const open = company(companyId)
    const provider = effectiveProvider(companyId, employee.id, employee.provider)
    if (!accounts.supportsAccounts(provider)) return null
    const pinned = open ? pinnedAccountFor(open.routing.get(), open.routing.employee(employee.id), provider) : null
    if (pinned) return accounts.spawnAccount(pinned)
    const out = recordOf(provider)?.accountId ?? null
    const rows = accounts.of(provider)
    const room = rows.find((account) => account.id !== out) ?? rows.find((account) => account.isDefault) ?? rows[0]
    return room ? { id: room.id, configDir: room.configDir } : null
  }

  const limits: UsageLimits = {
    reported,

    runAs(companyId, employee) {
      const where = routed.get(key(companyId, employee.id))
      if (!where) return employee
      return { ...employee, provider: where.to, model: where.model }
    },

    accountFor,

    effectiveProvider,

    routingOf(companyId, employeeId) {
      const where = routed.get(key(companyId, employeeId))
      if (!where) return null
      const open = company(companyId)
      return {
        provider: where.to,
        model: where.model,
        from: where.from,
        resetsAt: recordOf(where.from)?.resetsAt ?? null,
        movesBack: open ? movesBack(open.routing.get(), where.from) : true,
      }
    },

    continueNow(companyId, employeeId) {
      const open = company(companyId)
      const employee = open?.employees.find((person) => person.id === employeeId)
      if (!open || !employee) return
      const provider = effectiveProvider(companyId, employeeId, employee.provider)
      const rule = ruleOf(companyId, employee, provider)
      if (rule.kind !== 'continue' || !canRun(rule.provider)) {
        throw new Error(`${employee.name} has nowhere to continue: no fallback Provider is ready`)
      }
      queueMove(
        companyId,
        employeeId,
        { provider: rule.provider, model: rule.model },
        {
          from: { provider, model: employee.model },
          to: { provider: rule.provider, model: rule.model },
          reason: 'out-of-budget',
          backAt: resetLabel(provider),
        },
      )
    },

    moveBackNow(companyId, employeeId) {
      const where = routed.get(key(companyId, employeeId))
      const open = company(companyId)
      const employee = open?.employees.find((person) => person.id === employeeId)
      if (!where || !employee) return
      if (recordOf(where.from)) throw new Error(`${shortName(where.from)} has not reset yet`)
      queueMove(companyId, employeeId, null, {
        from: { provider: where.to, model: where.model },
        to: { provider: where.from, model: employee.model },
        reason: 'moved-back',
        backAt: null,
      })
    },

    teamStopped(companyId, provider) {
      const open = company(companyId)
      if (!open) return true
      return !open.employees.some((employee) => {
        if (effectiveProvider(companyId, employee.id, employee.provider) !== provider) return false
        if (rotationTarget(companyId, employee, provider)) return true
        const rule = ruleOf(companyId, employee, provider)
        return rule.kind === 'continue' && canRun(rule.provider)
      })
    },

    outages: () => capacity.outages(),

    forgetCompany(companyId) {
      for (const id of [...routed.keys()]) if (id.startsWith(`${companyId}/`)) routed.delete(id)
      for (const id of [...pending.keys()]) if (id.startsWith(`${companyId}/`)) pending.delete(id)
      const batch = batches.get(companyId)
      if (batch) clearTimeout(batch.at)
      batches.delete(companyId)
    },

    close() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      for (const batch of batches.values()) clearTimeout(batch.at)
      batches.clear()
      stopWatching()
      routed.clear()
      pending.clear()
      greeting.clear()
    },
  }

  const stopWatching = watch((activity) => {
    const id = key(activity.companyId, activity.employeeId)
    rawStatus.set(id, activity.status)
    if (activity.status === 'idle') {
      // A turn ended: whatever was waiting for one happens now, and a moved Employee is told where it is.
      const hello = greeting.get(id)
      if (hello && capacity.sessions.pushPrompt(activity.employeeId, hello.prompt)) {
        greeting.delete(id)
        // The Session that gets the prompt is the one that claims the page — exactly once, because
        // the store refuses a second claim (T175).
        if (hello.page) {
          try {
            company(activity.companyId)?.claimHandoffPage?.(activity.employeeId, hello.page)
          } catch (error) {
            log(`Usage limits: could not claim ${hello.page}: ${(error as Error).message}`)
          }
        }
      }
      apply(activity.companyId, activity.employeeId)
    }
    if (activity.status === 'off') apply(activity.companyId, activity.employeeId)
  })

  // A limit that was hit before the app closed still has a resume to run (T173).
  for (const record of records()) {
    for (const entry of record.routed) {
      routed.set(key(entry.companyId, entry.employeeId), {
        from: record.provider as Provider,
        to: entry.to as Provider,
        model: entry.model,
      })
    }
    capacity.restoreOutage({
      provider: record.provider,
      accountId: record.accountId,
      exhaustedAt: record.exhaustedAt,
      resetsAt: record.resetsAt,
      nextCheckAt: null,
    })
    schedule(record.provider)
  }

  return limits
}

/** `Vega`, `Vega and Orion`, `Vega, Orion and Iris` — how the system lines name a group. */
export function names(list: string[]): string {
  if (list.length === 0) return 'nobody'
  if (list.length === 1) return list[0]!
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)!}`
}
