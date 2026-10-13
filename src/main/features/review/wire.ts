import { BOSS } from '../../../shared/domain/chat'
import type { CompanyContext, OpenCompany } from '../../core'
import type { GitService } from '../../platform'
import { type ActivityContext, recordingReviews, recordMerged, recordReviewRequested } from '../activity'
import type { OwnFace } from '../company'
import type { ReviewFacade } from './facade'
import { createReviewComments, type ReviewComments } from './review-comments'
import { createReviewDiff } from './review-diff'
import { type CompanyReviews, createReviewFlow, type ReviewFlowOptions } from './review-flow'
import { createReviewThreads, type ReviewThreads } from './review-threads'
import { type CompanySecurity, createSecurityFlow } from './security-flow'

/**
 * The Testing stage, as review reaches it (T174).
 *
 * Review and Testing call each other: an approved round hands the ticket to Testing instead of
 * merging, and a passed Testing hands the merge back. Each side names the other as an interface of
 * its own — this one, and `TestingDeps.onPassed` — so neither ever imports the other's internals.
 */
export interface ReviewTesting {
  /** True when the ticket went into Testing; false when it is the merge gate's turn as before. */
  enter(ticketId: number, approvedBy: string): boolean
  /** Why the merge waits, or null when Testing is not in the way. */
  refusal(ticketId: number): string | null
}

/**
 * What review reaches for, one Company at a time.
 *
 * Every one of these is a function of the Company, because review is wired once and then serves
 * whichever Companies the boss has open. The types are read off the factories' own options, so
 * this interface can never drift from what they actually take.
 */
export interface ReviewDeps {
  log(line: string): void
  /** That Company's worktrees and PRs: what a round is about and what an approval merges. */
  code(entry: OpenCompany): ReviewFlowOptions['code']
  chat(entry: OpenCompany): ReviewFlowOptions['chat']
  approvals(entry: OpenCompany): ReviewFlowOptions['approvals']
  /** Who holds `review` and who holds `merge`, so a round can be routed and a gate raised. */
  routing(entry: OpenCompany): ReviewFlowOptions['routing']
  /** The board acting as `actorId`, so a move wakes whoever it concerns. */
  boardAs(entry: OpenCompany, actorId: string): ReturnType<ReviewFlowOptions['board']>
  /** Files an inbox item for that Company. */
  deliver(companyId: string, item: Parameters<ReviewFlowOptions['deliver']>[0]): void
  /** That Company's Testing stage (T174). */
  tests(entry: OpenCompany): ReviewTesting
  /** Without one, nothing merges and no diff is read. */
  git?: GitService
  /** How the activity log names who acted: a round asked for and a merge are each a line in it. */
  activity(entry: OpenCompany): () => ActivityContext
  /** That Company's repos, to turn the repo ids on a ticket's change back into paths. */
  repos(entry: OpenCompany): { list(): { id: string; path: string }[] }
  now(): number
}

/** The review feature, once it is wired. */
export interface ReviewFeature {
  /** That Company's review flow, made the first time it is asked for. */
  reviews(entry: OpenCompany): CompanyReviews
  /** That Company's review conversation. */
  threads(entry: OpenCompany): ReviewThreads
  /** That Company's security passes (T241). */
  security(entry: OpenCompany): CompanySecurity
  /** That Company's line comments. */
  comments(entry: OpenCompany): ReviewComments
  /** The Company the boss is looking at, for the screens and the IPC module. */
  currentReviews(): CompanyReviews
  currentThreads(): ReviewThreads
  currentComments(): ReviewComments
  /** Called after any round, thread or line comment changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
  facade: OwnFace<ReviewFacade>
}

/**
 * Wires review rounds, their conversation and their line comments to the open Companies (T187).
 *
 * The four are one feature because they are one screen and one flow: a round is asked for, argued
 * in threads and line comments, and ends in a merge. Each is made per Company and lazily, so none
 * has to exist before another.
 */
export function register(ctx: CompanyContext, deps: ReviewDeps): ReviewFeature {
  /**
   * Any round, thread or line comment changed, in any open Company. The review screen reads
   * whichever Company is current, so the listeners are not per Company.
   */
  const changed = ctx.listeners()
  const notify = () => changed.notify()

  /**
   * The patch behind the review screen, cached across Companies: it is keyed by PR and worktree,
   * reads nothing of a Company's tables, and so is made once rather than per Company. The security
   * pass reads it too, to know which paths a change touches.
   */
  const diff = createReviewDiff({ ...(deps.git && { git: deps.git }), log: deps.log, now: deps.now })

  /**
   * The same patch, read without the cache, for the one question that must not be answered out of
   * date: whether the change a round has just started on is worth a security pass. The screen may
   * ask again a second later and be served the same patch; a round asked about a push it cannot
   * see would skip the pass over the very lines that were added.
   */
  const freshDiff = createReviewDiff({
    ...(deps.git && { git: deps.git }),
    log: deps.log,
    now: deps.now,
    cached: false,
  })

  const threadsByCompany = ctx.perCompany((entry) =>
    createReviewThreads({
      db: entry.db,
      code: deps.code(entry),
      ...(deps.git && { git: deps.git }),
      onChange: notify,
      log: deps.log,
    }),
  )

  const commentsByCompany = ctx.perCompany((entry) => {
    const companyId = entry.company.id
    return createReviewComments({
      db: entry.db,
      code: deps.code(entry),
      deliver: (item) => deps.deliver(companyId, item),
      ...(deps.git && { git: deps.git }),
      onChange: notify,
      log: deps.log,
    })
  })

  /**
   * The security pass and the review flow name each other: a round that starts asks for a pass,
   * and a pass that clears lets the round's merge go. Neither is made before the other, so each
   * reaches the other through the map it is kept in rather than through a reference.
   */
  const securityByCompany = ctx.perCompany((entry) => {
    const companyId = entry.company.id
    return createSecurityFlow({
      db: entry.db,
      chat: deps.chat(entry),
      routing: deps.routing(entry),
      threads: threadsByCompany.of(entry),
      paths: async (ticketId) => {
        const repos = deps.repos(entry).list()
        const read = await freshDiff.read(
          deps.code(entry).of(ticketId),
          (id) => repos.find((r) => r.id === id)?.path ?? null,
        )
        // A rename is risky from both ends: the path it left and the path it landed on.
        return read.flatMap((repo) =>
          repo.files.flatMap((file) => [file.path, ...(file.previousPath ? [file.previousPath] : [])]),
        )
      },
      deliver: (item) => deps.deliver(companyId, item),
      onCleared: (ticketId) => flows.of(entry).securityCleared(ticketId),
      onChange: notify,
      log: deps.log,
    })
  })

  const flows = ctx.perCompany((entry) => {
    const companyId = entry.company.id
    return recordingReviews(
      createReviewFlow({
        db: entry.db,
        chat: deps.chat(entry),
        approvals: deps.approvals(entry),
        routing: deps.routing(entry),
        code: deps.code(entry),
        threads: threadsByCompany.of(entry),
        board: (actorId) => deps.boardAs(entry, actorId),
        deliver: (item) => deps.deliver(companyId, item),
        ...(deps.git && { git: deps.git }),
        tests: deps.tests(entry),
        security: securityByCompany.of(entry),
        onChange: notify,
        log: deps.log,
        onReviewEvent: (event) =>
          event.kind === 'requested'
            ? recordReviewRequested(deps.activity(entry), event)
            : recordMerged(deps.activity(entry), event),
      }),
      deps.activity(entry),
    )
  })

  const rounds = () => flows.current()
  const threads = () => threadsByCompany.current()
  const comments = () => commentsByCompany.current()
  const security = () => securityByCompany.current()

  return {
    reviews: (entry) => flows.of(entry),
    threads: (entry) => threadsByCompany.of(entry),
    security: (entry) => securityByCompany.of(entry),
    comments: (entry) => commentsByCompany.of(entry),
    currentReviews: rounds,
    currentThreads: threads,
    currentComments: comments,
    onChange: (listener) => changed.add(listener),

    facade: {
      reviews: {
        of: (ticketId) => rounds().of(ticketId),
        list: () => rounds().list(),
        approve: (ticketId, line) => rounds().approve(ticketId, line),
        requestChanges: (ticketId, line) => rounds().requestChanges(ticketId, line),
        diff(ticketId) {
          const entry = ctx.currentEntry()
          const repos = deps.repos(entry).list()
          return diff.read(deps.code(entry).of(ticketId), (id) => repos.find((r) => r.id === id)?.path ?? null)
        },
        fileSides({ ticketId, repoId, path }) {
          const entry = ctx.currentEntry()
          const repos = deps.repos(entry).list()
          return diff.sides(deps.code(entry).of(ticketId), (id) => repos.find((r) => r.id === id)?.path ?? null, {
            repoId,
            path,
          })
        },
        comments: (ticketId) => comments().list(ticketId),
        comment: (input) => comments().add(input),
        threads: (ticketId) => threads().list(ticketId),
        openThread(input) {
          const thread = threads().open(input, BOSS)
          // The boss is not writing a round: what they say goes on the PR now, under their own login.
          threads().publish({ ticketId: input.ticketId, threadIds: [thread.id], summary: '', verdict: 'comment' })
          return threads().get(thread.id) ?? thread
        },
        replyInThread: ({ threadId, body }) => threads().reply({ threadId, body }, BOSS),
        setThreadState(threadId, state) {
          const thread = threads().setState(threadId, state, BOSS)
          // The boss settling a finding's thread from the panel is the finding settled: if it was
          // the last high one, the merge it was holding may go ahead now (T241).
          security().recheck(thread.ticketId)
          return thread
        },
        threadsOnForge: (ticketId) => threads().onForge(ticketId),
        roundLimit: () => threads().roundLimit(),
        setRoundLimit: (limit) => threads().setRoundLimit(limit),
        onChange: (listener) => changed.add(listener),
      },
      security: {
        list: () => security().list(),
        of: (ticketId) => security().of(ticketId),
        override: (ticketId, reason) => security().override(ticketId, reason),
        scope: () => security().scope(),
        setScope: (scope) => security().setScope(scope),
      },
    },
  }
}
