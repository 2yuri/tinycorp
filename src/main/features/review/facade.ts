import type { FileSides, NewReviewComment, RepoDiff, ReviewComment } from '../../../shared/review/review-diff'
import type { NewReviewThread, ReviewThread, ThreadState } from '../../../shared/review/review-threads'
import type { SecurityPass, SecurityScope } from '../../../shared/review/security'
import type { CompanyChanged } from '../company'
import type { Reviews } from './review-flow'

/**
 * The review screen's face on the engine (T188).
 *
 * Everything the boss does here they do as themselves: an approve merges, a thread is posted on the
 * PR under their own CLI login. The Employees' side of review is reached over MCP and is not here.
 */
export interface ReviewFacade extends CompanyChanged {
  /** The current Company's review rounds, and the boss's approve (which merges) and request changes. */
  reviews: Reviews & {
    /** Called after any review round, merge or line comment changes, in any open Company. */
    onChange(listener: () => void): () => void
    /** A ticket's changed files per repo. Cached against the commit they are of (T243). */
    diff(ticketId: number): Promise<RepoDiff[]>
    /** The two sides of one of those files, for the diff editor. */
    fileSides(request: { ticketId: number; repoId: string; path: string }): Promise<FileSides>
    /** Every line comment on a ticket, oldest first. */
    comments(ticketId: number): ReviewComment[]
    /** Writes a line comment as the boss: kept here, posted on the PR, and woken to the assignee. */
    comment(input: NewReviewComment): ReviewComment
    /** A ticket's review threads, oldest first, each with its messages (T170). */
    threads(ticketId: number): ReviewThread[]
    /** Opens a thread as the boss; it posts on the PR through the boss's own CLI login. */
    openThread(input: NewReviewThread): ReviewThread
    /** Answers a thread as the boss. */
    replyInThread(input: { threadId: number; body: string }): ReviewThread
    /** Resolves a thread as the boss, or reopens it. */
    setThreadState(threadId: number, state: ThreadState): ReviewThread
    /** Whether the ticket's forges can carry the conversation; false means the app keeps it. */
    threadsOnForge(ticketId: number): boolean
    /** The Company's review round limit, and setting it. */
    roundLimit(): number
    setRoundLimit(rounds: number): number
  }
  /** The security pass (T241), as the boss reads it and overrides it. */
  security: {
    /** The latest pass of every ticket that has one. */
    list(): SecurityPass[]
    /** A ticket's latest pass, or null. */
    of(ticketId: number): SecurityPass | null
    /** Lets the merge through over an open high finding, with the reason on the record. */
    override(ticketId: number, reason: string): SecurityPass
    /** Which PRs get a pass in this Company. */
    scope(): SecurityScope
    setScope(scope: SecurityScope): SecurityScope
  }
}
