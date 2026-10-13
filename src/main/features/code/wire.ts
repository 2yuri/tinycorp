import type { Provider } from '../../../shared/domain/providers'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import type { CompanyContext, OpenCompany } from '../../core'
import { createPullRequestDetails } from '../../forges'
import type { GitService } from '../../platform'
import { type ActivityContext, recordLocalMerge, recordPullRequestOpened, recordWorktreeOpened } from '../activity'
import type { OwnFace } from '../company'
import { type CodeFlowOptions, type CompanyCodeFlow, createCodeFlow } from './code-flow'
import type { CodeFacade } from './facade'
import { type CompanyMerges, createMergeGate } from './merge-gate'

/**
 * What the code flow reaches for, one Company at a time.
 *
 * Every one of these is a function of the Company, because the flow is wired once and then serves
 * whichever Companies the boss has open. The types are read off the two factories' own options, so
 * this interface can never drift from what they actually take.
 */
export interface CodeDeps {
  /** The board with its wakes, which is what a worktree and a PR hang off. */
  wakes(entry: OpenCompany): CodeFlowOptions['wakes']
  chat(entry: OpenCompany): CodeFlowOptions['chat']
  approvals(entry: OpenCompany): CodeFlowOptions['approvals']
  /** Files an inbox item for that Company. */
  deliver(companyId: string, item: Parameters<CodeFlowOptions['deliver']>[0]): void
  /** Without one, tickets move without touching any repo and nothing merges. */
  git?: GitService
  /** Why Testing is still in the way of a local merge (T174), or null. */
  tests(entry: OpenCompany): { refusal(ticketId: number): string | null }
  /** A ticket in Review has a PR open for every worktree: review's turn. */
  reviews(entry: OpenCompany): { readyForReview(ticketId: number): void }
  /** How the activity log names who acted: a worktree, a PR and a local merge are each a line. */
  activity(entry: OpenCompany): () => ActivityContext
  /** That Company's repos, to turn the repo ids on a PR back into paths on this machine. */
  repos(entry: OpenCompany): { list(): { id: string; path: string }[] }
  /** That Company's roster, to find which Provider the Employee holding a ticket is on. */
  staff(entry: OpenCompany): { employees: { list(): { id: string; provider: Provider }[] } }
  /**
   * Where a Provider runs on this machine (T167). The worktree paths an Employee's brief names are
   * spelled the way that runtime spells them (T259), so a Session inside a distro is told a Linux path.
   */
  providerRuntime?(provider: Provider): ProviderRuntime | null
  log(line: string): void
  now(): number
  /** A PR opened, which is a notification as well as a line in the log. */
  onPullRequestOpened(
    entry: OpenCompany,
    opened: Parameters<NonNullable<CodeFlowOptions['onPullRequestOpened']>>[0],
  ): void
  /** A ticket's worktree was created in a repo: the boss's restore point and its granted skills. */
  onWorktreeCreated(entry: OpenCompany, created: Parameters<NonNullable<CodeFlowOptions['onWorktreeCreated']>>[0]): void
}

/** The code feature, once it is wired. */
export interface CodeFeature {
  /** That Company's code flow, made the first time it is asked for. */
  code(entry: OpenCompany): CompanyCodeFlow
  /** That Company's merge gate, for the repos with no remote (decision 44). */
  merges(entry: OpenCompany): CompanyMerges
  /** The Company the boss is looking at, for the screens and the IPC module. */
  currentCode(): CompanyCodeFlow
  facade: OwnFace<CodeFacade>
}

/**
 * Wires tickets' worktrees, branches, PRs and the merge gate to the open Companies (T187).
 *
 * The flow and the gate are one feature because they are two halves of the same question — how a
 * ticket's code reaches the base branch — answered differently by a repo with a remote and one
 * without (decision 44). Each is made per Company and lazily. The composition root goes on handing
 * each of them the Approvals it decided, in the order it added those listeners in.
 */
export function register(ctx: CompanyContext, deps: CodeDeps): CodeFeature {
  const changed = ctx.listeners()
  const flows = ctx.perCompany((entry) => {
    const companyId = entry.company.id
    return createCodeFlow({
      db: entry.db,
      folder: entry.company.folder,
      wakes: deps.wakes(entry),
      chat: deps.chat(entry),
      approvals: deps.approvals(entry),
      deliver: (item) => deps.deliver(companyId, item),
      ...(deps.git && { git: deps.git }),
      onChange: () => changed.notify(),
      log: deps.log,
      runtimeOf(employeeId) {
        const employee = deps
          .staff(entry)
          .employees.list()
          .find((row) => row.id === employeeId)
        return employee ? (deps.providerRuntime?.(employee.provider) ?? null) : null
      },
      onPullRequestOpened(opened) {
        recordPullRequestOpened(deps.activity(entry), opened)
        deps.onPullRequestOpened(entry, opened)
      },
      onWorktreeCreated(created) {
        recordWorktreeOpened(deps.activity(entry), created)
        deps.onWorktreeCreated(entry, created)
      },
      onReadyForReview: (ticketId) => deps.reviews(entry).readyForReview(ticketId),
    })
  })

  const gates = ctx.perCompany((entry) =>
    createMergeGate({
      db: entry.db,
      chat: deps.chat(entry),
      approvals: deps.approvals(entry),
      code: flows.of(entry),
      board: (actorId) => deps.wakes(entry).boardAs(actorId),
      ...(deps.git && { git: deps.git }),
      testRefusal: (ticketId) => deps.tests(entry).refusal(ticketId),
      log: deps.log,
      onMerged: (result) => recordLocalMerge(deps.activity(entry), result),
    }),
  )

  const current = () => flows.current()
  /** What the forge says about each PR. Cached across Companies: it is keyed by PR, not by row. */
  const details = createPullRequestDetails({
    ...(deps.git !== undefined && { git: deps.git }),
    log: deps.log,
    now: deps.now,
  })

  return {
    code: (entry) => flows.of(entry),
    merges: (entry) => gates.of(entry),
    currentCode: current,
    facade: {
      code: {
        of: (ticketId) => current().of(ticketId),
        list: () => current().list(),
        brief: (ticketId) => current().brief(ticketId),
        details(ticketId) {
          const repos = deps.repos(ctx.currentEntry()).list()
          return details.read(current().of(ticketId).pullRequests, (id) => repos.find((r) => r.id === id)?.path ?? null)
        },
        onChange: (listener) => changed.add(listener),
      },
    },
  }
}
