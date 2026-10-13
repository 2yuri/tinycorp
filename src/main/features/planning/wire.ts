import type { DigestSchedule, DigestScheduleUpdate } from '../../../shared/planning/daily-digest'
import type { CompanyContext, OpenCompany } from '../../core'
import type { CompanyChanged, OwnFace } from '../company'
import { createDailyDigests, type DailyDigestOptions, type DailyDigests, type DigestCompany } from './daily-digest'
import {
  type CompanyPlanning,
  createPlanning,
  type EmployeePlanning,
  type Planning,
  type PlanningOptions as PlansOptions,
} from './planning'

/** What a plan goes through, and what the digest reads that is not planning's own. */
export interface PlanningDeps extends PlanningOptions {
  chat(company: OpenCompany): PlansOptions['chat']
  /**
   * That Company's code flow, whose board planning acts through — not the one it wraps: approving
   * a plan moves a ticket, it does not create one, so there is nothing to plan again.
   */
  code(company: OpenCompany): { boardAs: PlansOptions['board'] }
  /**
   * Who holds `plan` in that Company, who should take a ticket, and why someone should not (T239).
   */
  routing(company: OpenCompany): { planner: PlansOptions['planner'] } & PlansOptions['assignment']
  /** That Company's repos: an area and a repo filter are written against their names. */
  repos(company: OpenCompany): { list(): { id: string; name: string }[] }
  /** That Company's autonomy level: what a plan may do without asking. */
  approvals(company: OpenCompany): {
    level: PlansOptions['level']
    list(filter: { status: 'pending' }): ReturnType<DigestCompany['approvals']>
  }
  deliver(companyId: string, item: Parameters<PlansOptions['deliver']>[0]): void
  /** A plan changed: that Company's Inbox mark, the plan views and the board all redraw. */
  onChange(company: OpenCompany): void
  /**
   * That Company's chat with the asks folded into its Inbox: the digest shows the same rows the
   * Inbox does, asks included, so the two can never disagree (decision 43).
   */
  chatWithAsks(company: OpenCompany): { bossInbox: DigestCompany['bossInbox']; postDigest: DigestCompany['post'] }
  /** Says the digest landed, wherever the boss is. */
  digestPosted(companyId: string, posted: Parameters<DigestCompany['notify']>[0]): void

  now?: DailyDigestOptions['now']
  log: DailyDigestOptions['log']
  /** A digest posted in that Company: its Inbox mark and the chat redraw. */
  onPosted(companyId: string): void
}

/** The current Company's plans, plus what one Employee may do to them. */
export type PlanningView = Planning & {
  /** The planning actions of one Employee, which is what its MCP tools are given. */
  as(employeeId: string): EmployeePlanning
  /** Called after any plan or answer changes, in any open Company. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/** The current Company's daily digest, as Company settings reads and writes it (T172). */
export interface DigestView {
  schedule(): DigestSchedule
  setSchedule(update: DigestScheduleUpdate): DigestSchedule
  /** Called after a digest is posted in any open Company. Returns an unsubscribe function. */
  onPosted(listener: () => void): () => void
}

/** What the boss's app hands in, and a test leaves out. */
export interface PlanningOptions {
  /**
   * What each Provider reports of the subscription, read once per daily digest (T172). Without one
   * the digest simply carries no usage section: it never invents a number it could not read.
   */
  usage?: DailyDigestOptions['usage']
}

/** The planning feature, once it is wired. */
export interface PlanningFeature {
  planning: PlanningView
  digest: DigestView
  facade: OwnFace<PlanningFacade> & OwnFace<DigestFacade>
  /** That Company's planning, made the first time it is asked for. */
  of(company: OpenCompany): CompanyPlanning
  /** Posts what a Company owes and re-arms the timer: a Company opening is a run that was missed. */
  digests: Pick<DailyDigests, 'run' | 'rearm'>
  /** The app is quitting: every Company's planning, the digest timer and every listener go at once. */
  close(): void
}

/**
 * Wires plans and the daily digest to the Companies the app has open (T171, T172, T187).
 *
 * One `CompanyPlanning` per open Company, because a plan and its questions live in that Company's
 * own database. The digest is one service over all of them: it composes from those same tables and
 * posts as the Company itself, so no Session starts and no Employee is woken. They are one feature
 * because the digest's "waiting on you" section is the plans — the digest cannot be written without
 * them.
 */
export function register(ctx: CompanyContext, deps: PlanningDeps): PlanningFeature {
  const planChanged = ctx.listeners()
  const digestPosted = ctx.listeners()
  const byCompany = ctx.perCompany((entry) =>
    createPlanning({
      db: entry.db,
      chat: deps.chat(entry),
      board: (actorId) => deps.code(entry).boardAs(actorId),
      planner: () => deps.routing(entry).planner(),
      assignment: {
        assignee: (ticket) => deps.routing(entry).assignee(ticket),
        claimBlock: (employeeId, ticket) => deps.routing(entry).claimBlock(employeeId, ticket),
      },
      repos: () => deps.repos(entry).list(),
      level: () => deps.approvals(entry).level(),
      deliver: (item) => deps.deliver(entry.company.id, item),
      onChange: () => {
        deps.onChange(entry)
        planChanged.notify()
      },
    }),
  )

  const digests = createDailyDigests({
    company(companyId) {
      const entry = ctx.entryOf(companyId)
      if (!entry) return null
      const chat = deps.chatWithAsks(entry)
      return {
        db: entry.db,
        name: entry.company.name,
        plans: () => byCompany.of(entry).list(),
        // The same rows the Inbox shows, asks included, so the two can never disagree (decision 43).
        bossInbox: chat.bossInbox,
        approvals: () => deps.approvals(entry).list({ status: 'pending' }),
        post: (input) => chat.postDigest(input),
        notify: (posted) => deps.digestPosted(entry.company.id, posted),
      }
    },
    openCompanyIds: () => ctx.ids(),
    ...(deps.usage && { usage: deps.usage }),
    ...(deps.now && { now: deps.now }),
    log: deps.log,
    onPosted(companyId) {
      deps.onPosted(companyId)
      digestPosted.notify()
    },
  })

  const current = () => byCompany.current()

  const planning: PlanningView = {
    of: (subject) => current().of(subject),
    list: () => current().list(),
    versions: (subject) => current().versions(subject),
    answer: (questionId, text) => current().answer(questionId, text),
    delegate: (questionId) => current().delegate(questionId),
    approve: (planId) => current().approve(planId),
    requestChanges: (planId, comments) => current().requestChanges(planId, comments),
    keep: (planId) => current().keep(planId),
    replan: (ticketId, reason, changes) => current().replan(ticketId, reason, changes),
    as: (employeeId) => current().as(employeeId),
    onChange: (listener) => planChanged.add(listener),
  }

  const digest: DigestView = {
    schedule: () => digests.schedule(ctx.currentEntry().company.id),
    setSchedule: (update) => digests.setSchedule(ctx.currentEntry().company.id, update),
    onPosted: (listener) => digestPosted.add(listener),
  }

  return {
    of: (entry) => byCompany.of(entry),
    digests,
    planning,
    digest,
    facade: { planning, digest },

    close() {
      // The timer is the app's, not a Company's: it goes here, and the context empties the caches.
      digests.close()
    },
  }
}

/** The plan drawer's face. */
export interface PlanningFacade extends CompanyChanged {
  /** The current Company's plans (T171): what waits on the boss before a ticket is Ready. */
  planning: PlanningView
}

/** The daily digest's face (T172). */
export interface DigestFacade extends CompanyChanged {
  /** When it posts, and where. The digest is written by the engine, so it spends no usage. */
  digest: DigestView
}
