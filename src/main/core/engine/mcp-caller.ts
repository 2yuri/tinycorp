import type { Company } from '../../../shared/company'
import type { Mentionable } from '../../../shared/domain/chat'
import type { EnvRunResult } from '../../../shared/environments'
import type { Repo, StackConstraints } from '../../../shared/repos/repo'
import type { SubSessionInfo } from '../../../shared/sub-sessions'
import type { CompanyApprovals } from '../../features/approvals'
import type { Chat } from '../../features/chat'
import type { CodeFlow, EmployeeMerges } from '../../features/code'
import type { EnvRunRequest } from '../../features/environments'
import type { CompanyHiring } from '../../features/hiring'
import type { CompanyMemory, EmployeeNotes } from '../../features/memory'
import type { EmployeePlanning } from '../../features/planning'
import type { EmployeeReviews, EmployeeSecurity } from '../../features/review'
import type { ActingBoard, SubSessionRequest } from '../../features/sessions'
import type { AppRuns, EmployeeTests } from '../../features/testing'
import type { CompanyContext, OpenCompany } from '..'

/** An Employee calling the Company MCP server, with the chat of its own Company. */
export interface McpCaller {
  company: Company
  employee: Mentionable
  chat: Chat
  /** Its own Company's board, acting as the Employee. */
  board: ActingBoard
  /** Its own Company's repos. */
  repos(): Pick<Repo, 'id' | 'name' | 'stack'>[]
  /** Sets the given stack fields and Checks of one of its Company's repos; the others stay. */
  setRepoChecks(repoId: string, changes: Partial<StackConstraints>): Repo
  approvals: CompanyApprovals
  hiring: CompanyHiring
  /** Its own Company's ticket worktrees and PRs. */
  code: CodeFlow
  /** The calling Employee's own note log (T193). */
  notes: EmployeeNotes
  /** The Company's shared memory, which every Employee reads and writes (T175). */
  companyMemory: CompanyMemory
  /** Its own Company's reviews, acting as the Employee. */
  reviews: EmployeeReviews
  /** Its own Company's security passes, acting as the Employee (T241). */
  security: EmployeeSecurity
  /** Its own Company's planning, acting as the Employee. */
  planning: EmployeePlanning
  /** Its own Company's merge gate for repos without a remote, acting as the Employee. */
  merges: EmployeeMerges
  /** Its own Company's Testing stage, acting as the Employee (T174). */
  tests: EmployeeTests
  /** The ticket apps it may start and stop while it tests. */
  appRuns: Pick<AppRuns, 'runnable' | 'of' | 'start' | 'stop' | 'log'>
  /**
   * Runs one command with an Environment's values in it, acting as the Employee (T176). It is the
   * only way an Employee uses a secret, and the values never enter its own process.
   */
  envRun(request: EnvRunRequest): Promise<EnvRunResult>
  /** The Sessions the Employee starts of its own (T163). */
  subSessions: {
    start(request: SubSessionRequest): SubSessionInfo
    get(id: string): SubSessionInfo
    list(): SubSessionInfo[]
    stop(id: string): SubSessionInfo
  }
  /**
   * Set when the caller is one of those sub-sessions rather than the Employee's own Session: all
   * it can do is report back. Null for an Employee.
   */
  subSession: { id: string; report(result: string): SubSessionInfo } | null
}

/** Who the token belongs to: an Employee of an open Company, or one of its sub-sessions. */
export interface McpCallerIdentity {
  companyId: string
  employeeId: string
  subSessionId?: string | undefined
}

/**
 * The features an Employee reaches over MCP, each for the Company the caller belongs to.
 *
 * They arrive whole — the Company's reviews, not the Employee's — and are narrowed here, because
 * *acting as the caller* is what this file is about and nowhere else should have to remember it.
 */
export interface McpCallerDeps {
  chat(entry: OpenCompany): Chat
  /** The board every caller edits through, acting as the Employee. */
  actingBoard(entry: OpenCompany, actorId: string): ActingBoard
  repos(entry: OpenCompany): {
    list(): Repo[]
    update(repoId: string, changes: { stack: Partial<StackConstraints> }): Repo
  }
  /** An Employee set a repo's Checks, which is a change the Repositories screen shows. */
  repoChecksSet(): void
  approvals(entry: OpenCompany): CompanyApprovals
  hiring(entry: OpenCompany): CompanyHiring
  code(entry: OpenCompany): CodeFlow
  merges(entry: OpenCompany): { as(employeeId: string): EmployeeMerges }
  notes(entry: OpenCompany, employeeId: string): EmployeeNotes
  companyMemory(entry: OpenCompany): CompanyMemory
  reviews(entry: OpenCompany): { as(employeeId: string): EmployeeReviews }
  security(entry: OpenCompany): { as(employeeId: string): EmployeeSecurity }
  planning(entry: OpenCompany): { as(employeeId: string): EmployeePlanning }
  tests(entry: OpenCompany): { as(employeeId: string): EmployeeTests }
  appRuns(entry: OpenCompany): AppRuns
  /** That Company's `env_run` flow; the values never enter the Employee's own process (T176). */
  environments(entry: OpenCompany): { run(employeeId: string, request: EnvRunRequest): Promise<EnvRunResult> }
  subSessions: {
    start(companyId: string, employeeId: string, request: SubSessionRequest): SubSessionInfo
    get(companyId: string, employeeId: string, id: string): SubSessionInfo
    of(companyId: string, employeeId: string): SubSessionInfo[]
    stop(companyId: string, employeeId: string, id: string): SubSessionInfo
    report(subSessionId: string, result: string): SubSessionInfo
  }
}

/** Who the Company MCP server is talking to, by the token on the call. */
export interface McpTokens {
  mcpCaller(token: string): McpCallerIdentity | null
}

/**
 * The other process's way in (T188, T201).
 *
 * An Employee is a separate process talking to the Company MCP server, so everything it may do
 * arrives here as one object built for its own Company and its own id — never for the Company the
 * boss happens to be looking at. It is a composition and holds nothing: every member is some
 * feature's, acting as the Employee that called.
 */
export function mcpCallerOf(
  ctx: CompanyContext,
  sessions: McpTokens,
  companyId: string,
  token: string,
  deps: McpCallerDeps,
): McpCaller | null {
  const caller = sessions.mcpCaller(token)
  const entry = ctx.entryOf(companyId)
  if (!caller || !entry || caller.companyId !== companyId) return null
  const employee = deps
    .chat(entry)
    .people()
    .find((person) => person.id === caller.employeeId)
  if (!employee) return null
  const id = employee.id
  return {
    company: entry.company,
    employee,
    chat: deps.chat(entry),
    board: deps.actingBoard(entry, id),
    repos: () => deps.repos(entry).list(),
    setRepoChecks(repoId, changes) {
      const repo = deps.repos(entry).update(repoId, { stack: changes })
      deps.repoChecksSet()
      return repo
    },
    approvals: deps.approvals(entry),
    hiring: deps.hiring(entry),
    code: deps.code(entry),
    notes: deps.notes(entry, id),
    companyMemory: deps.companyMemory(entry),
    reviews: deps.reviews(entry).as(id),
    security: deps.security(entry).as(id),
    planning: deps.planning(entry).as(id),
    merges: deps.merges(entry).as(id),
    tests: deps.tests(entry).as(id),
    appRuns: deps.appRuns(entry),
    envRun: (request) => deps.environments(entry).run(id, request),
    subSessions: {
      start(request) {
        // Belt and braces: a sub-session's token never reaches `session_start` in the first place.
        if (caller.subSessionId) throw new Error('A sub-session cannot start Sessions: one level is all there is')
        return deps.subSessions.start(companyId, id, request)
      },
      get: (subId) => deps.subSessions.get(companyId, id, subId),
      list: () => deps.subSessions.of(companyId, id),
      stop: (subId) => deps.subSessions.stop(companyId, id, subId),
    },
    subSession: caller.subSessionId
      ? { id: caller.subSessionId, report: (result) => deps.subSessions.report(caller.subSessionId ?? '', result) }
      : null,
  }
}
