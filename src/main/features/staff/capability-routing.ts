import { BOSS } from '../../../shared/domain/chat'
import {
  type Capability,
  type Employee,
  intakeHolder,
  preferredAssignee,
  rankAssignees,
  SECURITY_ROLE_ID,
  type TicketArea,
} from '../../../shared/domain/staff'

/** Who gets what, decided by capabilities. Job titles are labels only. */
export interface Routing {
  /**
   * Who turns the boss's goals into targets: the first Employee hired with `intake`, or the only
   * Employee of a one-Employee Company. Null when nobody does.
   */
  intake(): Employee | null
  /**
   * Who plans a ticket or epic before it is Ready (T171): the first Employee hired with `plan`,
   * else whoever holds `intake`. Null when nobody does.
   */
  planner(): Employee | null
  /** Who reviews a PR by `authorId`: the first `review` holder other than the author, else `BOSS`. */
  reviewer(authorId: string): string
  /**
   * Who tests a ticket of `authorId` before it merges (T174): the first `test` holder other than
   * the person who wrote it, or null when nobody holds it — then the boss tests it themselves.
   */
  tester(authorId: string): string | null
  /**
   * Who reads a change by `authorId` for security (T241): the first Employee hired into the
   * Security role that still holds `review` and did not write the change, or null when the Company
   * has nobody — then no PR gets a security pass at all.
   */
  securityReviewer(authorId: string): string | null
  /**
   * Who should take this ticket (T239): the engineer whose area matches the paths or labels it
   * carries, else any engineer who may work in every repo it touches, and the lead only when no
   * engineer can. Null when nobody can take it. `repos` are repo names.
   */
  assignee(ticket: TicketArea): Employee | null
  /**
   * Why this Employee should not take this ticket, or null when it may. Only one thing is refused:
   * a planner taking work an engineer could take, because a lead that codes the backlog is a lead
   * that reviews nothing (T239). An area that is somebody else's is a preference, not a refusal.
   */
  claimBlock(employeeId: string, ticket: TicketArea): string | null
  /** Whether the Employee holds `capability`; false for anyone who is not an Employee. */
  can(employeeId: string, capability: Capability): boolean
  /** Throws unless the Employee holds `capability`, e.g. `hire` before a hire request. */
  require(employeeId: string, capability: Capability): void
}

/** Routing over a Company's Employees, in hire order. */
export function createRouting(employees: () => Employee[]): Routing {
  const routing: Routing = {
    intake() {
      return intakeHolder(employees())
    },

    planner() {
      return employees().find((e) => e.capabilities.includes('plan')) ?? intakeHolder(employees())
    },

    reviewer(authorId) {
      const found = employees().find((e) => e.id !== authorId && e.capabilities.includes('review'))
      return found?.id ?? BOSS
    },

    tester(authorId) {
      return employees().find((e) => e.id !== authorId && e.capabilities.includes('test'))?.id ?? null
    },

    securityReviewer(authorId) {
      const found = employees().find(
        (e) => e.id !== authorId && e.roleId === SECURITY_ROLE_ID && e.capabilities.includes('review'),
      )
      return found?.id ?? null
    },

    assignee(ticket) {
      return preferredAssignee(employees(), ticket)
    },

    claimBlock(employeeId, ticket) {
      const who = employees().find((e) => e.id === employeeId)
      if (!who?.capabilities.includes('plan')) return null
      const engineers = rankAssignees(employees(), ticket).filter((e) => !e.capabilities.includes('plan'))
      const first = engineers[0]
      if (!first) return null
      const others = engineers.length > 1 ? ` (${engineers.length - 1} more could)` : ''
      return (
        `You plan and review this one: ${first.name} can take it${others}. ` +
        'Assign it to them; take it yourself only when no engineer can.'
      )
    },

    can(employeeId, capability) {
      return employees().some((e) => e.id === employeeId && e.capabilities.includes(capability))
    },

    require(employeeId, capability) {
      if (routing.can(employeeId, capability)) return
      const employee = employees().find((e) => e.id === employeeId)
      throw new Error(
        employee
          ? `${employee.name} does not hold the ${capability} capability`
          : `Only an Employee holding ${capability} can do this`,
      )
    },
  }
  return routing
}
