import type { Approval } from '../../../shared/approvals'
import { BOSS } from '../../../shared/domain/chat'
import type { CompanyContext, OpenCompany } from '../../core'
import { type ActivityContext, recordDecidedStaffing, recordingHiring } from '../activity'
import { type CompanyHiring, type CompanyHiringOptions, createCompanyHiring, type Hiring } from './hiring'

/** What a hire or a fire goes through: that Company's staff, board, chat, approvals and Sessions. */
export interface HiringDeps {
  /** That Company's role catalog and Employees, on the Provider a hire takes when none is named. */
  staff(company: OpenCompany): CompanyHiringOptions['staff']
  /** That Company's board with its wakes: a fire unassigns the tickets its Employee held. */
  wakes(company: OpenCompany): { boardAs(actorId: string): CompanyHiringOptions['board'] }
  chat(company: OpenCompany): CompanyHiringOptions['chat']
  approvals(company: OpenCompany): CompanyHiringOptions['approvals']
  /** How that Company's activity log names who acted, so a hire and a fire are both recorded. */
  activity(company: OpenCompany): () => ActivityContext
  /** Starts (or parks) an Employee's Session; may throw, e.g. when no provider is available. */
  startSession(employeeId: string): void
  /** Stops an Employee's Session or takes it out of the parked queue. */
  stopSession(employeeId: string): void
  /** Called after someone is hired, fired or rehired: who is on staff changed. */
  onChange(): void
  log(line: string): void
}

/** The hiring feature, once it is wired. */
export interface HiringFeature {
  /** What the Employees view reads and the boss decides, over whichever Company is current. */
  hiring: Hiring
  /** That Company's hiring, made the first time it is asked for. */
  of(entry: OpenCompany): CompanyHiring
  /**
   * The boss decided an Approval. A `hire` or a `fire` is carried out here and nowhere else,
   * because only staffing can say who it hired — and the line in the log needs that answer.
   */
  decided(entry: OpenCompany, approval: Approval): void
}

/**
 * Wires hiring and firing to the Companies the app has open (T187).
 *
 * One `CompanyHiring` per open Company, because the staffing requests live in that Company's own
 * database, and each is wrapped in the activity recorder so a hire lands in the log of the Company
 * it happened in. A Session, though, only ever starts in the Company the boss is looking at: a
 * hire approved in a Company that is no longer current refuses rather than spawns somewhere else.
 */
export function register(ctx: CompanyContext, deps: HiringDeps): HiringFeature {
  const byCompany = ctx.perCompany((entry) => {
    const { id, name } = entry.company
    const requireCurrent = () => {
      if (ctx.currentId() !== id) throw new Error(`${name} is not the current Company`)
    }
    return recordingHiring(
      createCompanyHiring({
        db: entry.db,
        staff: deps.staff(entry),
        board: deps.wakes(entry).boardAs(BOSS),
        chat: deps.chat(entry),
        approvals: deps.approvals(entry),
        startSession(employeeId) {
          requireCurrent()
          deps.startSession(employeeId)
        },
        stopSession(employeeId) {
          requireCurrent()
          deps.stopSession(employeeId)
        },
        onChange: deps.onChange,
        log: deps.log,
      }),
      deps.activity(entry),
    )
  })

  const current = () => byCompany.current()

  return {
    of: (entry) => byCompany.of(entry),

    decided(entry, approval) {
      const hiring = byCompany.of(entry)
      hiring.decided(approval)
      // A fired Employee is found among the former, which is the only place it is left.
      recordDecidedStaffing(hiring, deps.activity(entry), approval, (employeeId) => {
        const everyone = [...deps.staff(entry).employees.list(), ...hiring.former()]
        return everyone.find((person) => person.id === employeeId) ?? null
      })
    },

    hiring: {
      teamLoad: () => current().teamLoad(),
      requestHire: (input) => current().requestHire(input),
      requestFire: (input) => current().requestFire(input),
      setRequestModel: (requestId, model) => current().setRequestModel(requestId, model),
      fire: (employeeId, reason) => current().fire(employeeId, reason),
      rehire: (employeeId) => current().rehire(employeeId),
      former: () => current().former(),
      requests: () => current().requests(),
      updateProposal: (requestId, patch) => current().updateProposal(requestId, patch),
      suggestName: (exclude) => current().suggestName(exclude),
      headcount: () => current().headcount(),
      setMaxHeadcount: (max) => current().setMaxHeadcount(max),
    },
  }
}

/** The Employees view's hiring face. */
export interface HiringFacade {
  /** The current Company's team load, hire and fire requests, and former Employees. */
  hiring: Hiring
}
