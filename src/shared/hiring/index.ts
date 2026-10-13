import type { Column } from '../domain/board'
import type { Areas, Capability, Employee, RepoFilter } from '../domain/staff'

/** One Employee's share of the board: every ticket they hold that is not done. */
export interface EmployeeLoad {
  id: string
  name: string
  title: string
  capabilities: Capability[]
  repoFilter: RepoFilter
  /** How many of their tickets are not done. */
  wip: number
  tickets: { id: number; title: string; column: Column; blocked: boolean }[]
}

/** Something the team cannot do today, with the catalog roles that could do it. */
export type SkillGap =
  | { kind: 'capability'; capability: Capability; detail: string; roles: string[] }
  | { kind: 'repo'; repo: string; detail: string; roles: string[] }

/** What a hirer reads before proposing a hire: who holds what, what nobody holds, what nobody can do. */
export interface TeamLoad {
  employees: EmployeeLoad[]
  /** Tickets that are not done and have no assignee, in board order. */
  unassigned: { id: number; title: string; column: Column; repos: string[] }[]
  columns: { id: Column; wipLimit: number | null; count: number; overLimit: boolean }[]
  skillGaps: SkillGap[]
  /** What a hire can be made into: the Company's own roles and the built-ins it has not taken. */
  roles: { id: string; name: string; capabilities: Capability[]; repoFilter: RepoFilter }[]
  /** Per catalog role: how many work on it and the open tickets they hold. Every role listed. */
  roleLoad: RoleLoad[]
  /** Tickets in Todo per repo name, assigned or not; repos with none are left out. Busiest first. */
  todoByRepo: { repo: string; count: number }[]
  /** Open tickets marked blocked. */
  blocked: number
  /** How long tickets stay in Review, from the times they entered and left it. */
  review: ReviewWait
  headcount: Headcount
}

export interface RoleLoad {
  roleId: string
  name: string
  employees: number
  /** Open tickets held by Employees on this role. */
  wip: number
}

export interface ReviewWait {
  /** Average over the stays in Review that have ended; null when none has. */
  averageMs: number | null
  /** How many ended stays the average is over. */
  stays: number
}

/** Employees on staff against the Company's maximum; `max` null means unlimited. */
export interface Headcount {
  current: number
  max: number | null
}

/** True when one more hire would go above the maximum headcount. */
export function hireExceedsHeadcount({ current, max }: Headcount): boolean {
  return max !== null && current + 1 > max
}

/**
 * The Employee a new-hire request would create, fixed when it is requested and editable by the boss
 * until the request is decided.
 */
export interface ProposedEmployee {
  name: string
  roleId: string
  persona: string
  capabilities: Capability[]
  repoFilter: RepoFilter
  /** The paths inside a repo the hire would work in; `[]` is all of them (T239). */
  areas: Areas
  /** The model the hire would run on; null for the provider's default. */
  model: string | null
}

export type ProposalPatch = Partial<ProposedEmployee>

export type StaffingKind = 'hire' | 'fire'

/** An Employee's proposal to hire or fire, and what came of it. */
export interface StaffingRequest {
  id: number
  kind: StaffingKind
  requesterId: string
  /** For a hire, the catalog role; for a fire, null. */
  roleId: string | null
  /** For a fire, who goes; for a rehire, who comes back; for a new hire, who was hired once approved. */
  employeeId: string | null
  /** For a new hire, the name it was proposed under; null when the engine picks one at hire time. */
  name: string | null
  reason: string
  /**
   * For a new hire, who approval creates; null for fires, rehires and requests filed before
   * proposals were stored (those hire from the role as it is at approval).
   */
  proposal: ProposedEmployee | null
  /** For a hire, the proposed model; null keeps the provider's default (or a rehire's own model). */
  model: string | null
  /** Null when the autonomy level let it through without asking. */
  approvalId: number | null
  /** `failed`: approved, but it could not be carried out (e.g. the Employee was already gone). */
  status: 'pending' | 'done' | 'rejected' | 'failed'
  createdAt: string
}

/** What a hire or fire request came to: done right away, or waiting on the boss. */
export type StaffingOutcome =
  | { status: 'done'; request: StaffingRequest; employee: Employee }
  | { status: 'pending'; request: StaffingRequest; approvalId: number }
