import type { Approval } from '../../../shared/approvals'
import type { CompanyContext, OpenCompany } from '../../core'
import { type ActivityContext, recordingApprovals } from '../activity'
import type { CompanyChanged } from '../company'
import {
  type Approvals,
  type CompanyApprovals,
  type CompanyApprovalsOptions,
  createCompanyApprovals,
} from './approvals'

/**
 * What approvals reach for, one Company at a time.
 *
 * The types are read off the factory's own options, so this interface can never drift from what it
 * actually takes.
 */
export interface ApprovalsDeps {
  /** The channel an Approval's thread is posted in, and who can be named in it. */
  chat(entry: OpenCompany): CompanyApprovalsOptions['chat']
  /** Files an inbox item for the requester, so the decision reaches them. */
  deliver(companyId: string, item: Parameters<CompanyApprovalsOptions['deliver']>[0]): void
  /**
   * How the activity log names who acted: an Approval asked for and decided is a line in it, and
   * approvals record nothing themselves.
   */
  activity(entry: OpenCompany): () => ActivityContext
  /**
   * Why the ticket's repos refuse a merge, or null when they allow it (decision 61). A merge the
   * repo forbids is refused here, so the boss is never asked for it under any autonomy level.
   */
  mergeRefusal(entry: OpenCompany, ticketId: number): string | null
  /** The level or an Approval changed: the Company rail and the screens redraw. */
  onChanged(companyId: string): void
  /**
   * The boss decided one, before the engine's own decision listeners run. The hire or fire an
   * Approval stands for is carried out here, because only staffing can say who it hired.
   */
  onDecided(companyId: string, approval: Approval): void
}

/** The approvals feature, once it is wired. */
export interface ApprovalsFeature {
  /** The current Company's Approvals, plus the events of every open one. */
  approvals: Approvals
  /** That Company's Approvals, made the first time they are asked for. */
  of(entry: OpenCompany): CompanyApprovals
}

/**
 * Wires what an Employee must ask the boss before it does it, to the open Companies (T187).
 *
 * One set of Approvals per open Company, because they are rows in that Company's own database. The
 * listeners are not per Company: the screens read whichever Company is current, and a decision
 * carries the Company it was made in.
 */
export function register(ctx: CompanyContext, deps: ApprovalsDeps): ApprovalsFeature {
  const changed = ctx.listeners()
  const decided = ctx.listeners<[Approval, string]>()
  const byCompany = ctx.perCompany((entry) => {
    const companyId = entry.company.id
    return recordingApprovals(
      createCompanyApprovals({
        db: entry.db,
        chat: deps.chat(entry),
        deliver: (item) => deps.deliver(companyId, item),
        mergeRefusal: (ticketId) => deps.mergeRefusal(entry, ticketId),
        onChange: () => {
          deps.onChanged(companyId)
          changed.notify()
        },
        onDecision: (approval) => {
          deps.onDecided(companyId, approval)
          decided.notify(approval, companyId)
        },
      }),
      deps.activity(entry),
    )
  })

  const current = (): CompanyApprovals => byCompany.current()

  return {
    of: (entry) => byCompany.of(entry),

    approvals: {
      level: () => current().level(),
      setLevel: (level) => current().setLevel(level),
      gate: (action, conditions) => current().gate(action, conditions),
      request: (input) => current().request(input),
      decide: (id, decision) => current().decide(id, decision),
      list: (filter) => current().list(filter),
      granted: (...args) => current().granted(...args),
      onChange: (listener) => changed.add(listener),
      onDecision: (listener) => decided.add(listener),
    },
  }
}

/** The Approvals screen's face. */
export interface ApprovalsFacade extends CompanyChanged {
  /** The current Company's autonomy level and Approvals. */
  approvals: Approvals
}
