import { COMPANY_AUTHOR } from '../../../shared/domain/chat'
import type { CompanyContext, OpenCompany } from '../../core'
import type { ActivityContext } from '../activity'
import type { RoutingHandoff } from '../sessions'
import type { UsageFacade } from './facade'
import { type AccountStore, createProviderAccounts, memoryAccounts } from './provider-accounts'
import {
  createUsageLimits,
  type HandoffMove,
  memoryOutages,
  type OutageStore,
  type UsageLimits,
  type UsageLimitsOptions,
} from './usage-limits'
import { createUsageRouting } from './usage-routing'

/**
 * What usage reaches for.
 *
 * An out-of-budget Employee is moved by writing to its Company's chat, its activity log, its
 * handoff page and its Sessions, so nearly all of this is one neighbour per Company. The stores
 * are injected, so no test signs anything in.
 */
export interface UsageDeps extends UsageOptions {
  log(line: string): void
  now(): number
  capacity: UsageLimitsOptions['capacity']
  providers: UsageLimitsOptions['providers']
  chat(entry: OpenCompany): Company['chat']
  staff(entry: OpenCompany): { employees: { list(): Company['employees'] } }
  companyMemory(entry: OpenCompany): { claimHandoff(slug: string, by: string): void }
  /** How that Company's log names who acted: a move to a fallback is a line in it. */
  activity(entry: OpenCompany): () => ActivityContext
  /** What the new Session is told, and the Handoff page the move leaves behind (T173, T175). */
  handoff(entry: OpenCompany, employeeId: string, move: HandoffMove): RoutingHandoff
  handoffPage(entry: OpenCompany, employeeId: string, handoff: RoutingHandoff, move: HandoffMove): string | null
  watch: UsageLimitsOptions['watch']
}

/** One open Company, as the limits write to it. */
type Company = NonNullable<ReturnType<UsageLimitsOptions['company']>>

/** What the boss's app hands in, and a test leaves out. */
export interface UsageOptions {
  /** Where the boss's Provider sign-ins are kept. Defaults to memory (T173). */
  accountStore?: AccountStore
  /**
   * Where a Provider's outage is remembered, so the resume it scheduled outlives the process
   * (T173). Defaults to memory, which is an app that forgets a limit when it closes.
   */
  outageStore?: OutageStore
  /** The folder each added account's own config directory goes under. */
  accountsDir?: string
  /** Makes an added account's config directory. Defaults to `mkdir -p`; tests hand in a no-op. */
  makeAccountDir?(path: string): void
  /**
   * When a Provider's limit resets, read without spending any usage — the adapter's own status or
   * usage read, never a prompt. Without one, a limit that named no time is simply retried.
   */
  readReset?: UsageLimitsOptions['readReset']
}

/** The usage feature, once it is wired. */
export interface UsageFeature {
  /** What the app does about a Provider that ran out: the resume, the routing and the move back. */
  limits: UsageLimits
  facade: Pick<UsageFacade, 'accounts' | 'limits' | 'usageRouting'>
}

/**
 * Wires the subscriptions the Company runs on (T173, T186).
 *
 * The accounts come first because the limits are decided per account: which sign-in an Employee is
 * on is what says whether there is anywhere left to carry on.
 */
export function register(ctx: CompanyContext, deps: UsageDeps): UsageFeature {
  const accounts = createProviderAccounts({
    store: deps.accountStore ?? memoryAccounts(),
    providers: deps.providers,
    dataDir: deps.accountsDir ?? 'accounts',
    makeDir: deps.makeAccountDir,
    log: deps.log,
  })

  const limits = createUsageLimits({
    capacity: deps.capacity,
    providers: deps.providers,
    accounts,
    store: deps.outageStore ?? memoryOutages(),
    company(companyId) {
      const entry = ctx.entryOf(companyId)
      if (!entry) return null
      return {
        db: entry.db,
        chat: deps.chat(entry),
        employees: deps.staff(entry).employees.list(),
        routing: createUsageRouting(() => entry.db),
        record: (event) =>
          deps
            .activity(entry)()
            .log.record({
              kind: event.kind,
              actorId: COMPANY_AUTHOR,
              actorName: deps.activity(entry)().nameOf(COMPANY_AUTHOR),
              summary: event.summary,
              detail: event.detail,
              payload: {},
            }),
        handoff: (employeeId, move) => deps.handoff(entry, employeeId, move),
        writeHandoffPage: (employeeId, handoff, move) => deps.handoffPage(entry, employeeId, handoff, move),
        claimHandoffPage(employeeId, slug) {
          const employee = deps
            .staff(entry)
            .employees.list()
            .find((person) => person.id === employeeId)
          deps.companyMemory(entry).claimHandoff(slug, employee?.name ?? 'an Employee')
        },
      }
    },
    companies: () => ctx.ids(),
    watch: deps.watch,
    ...(deps.readReset && { readReset: deps.readReset }),
    log: deps.log,
    now: deps.now,
  })

  return {
    limits,
    facade: { accounts, limits, usageRouting: createUsageRouting(() => ctx.currentEntry().db) },
  }
}
