/**
 * Review's slice of the IPC contract (T187). `src/shared/ipc/index.ts` composes the slices into
 * `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { Review } from './index'
import type { FileSides, NewReviewComment, RepoDiff, ReviewComment } from './review-diff'
import type { NewReviewThread, ReviewThread, ThreadState } from './review-threads'
import type { SecurityPass, SecurityScope } from './security'

/**
 * The current Company's review rounds, decided as the boss: approving merges the ticket's PRs.
 * Exposed as `window.tinyCorp.reviews`.
 */
export interface ReviewApi {
  /** The latest round of every ticket that has one. */
  list(): Promise<Result<Review[]>>
  approve(ticketId: number, comments?: string): Promise<Result<Review>>
  requestChanges(ticketId: number, comments: string): Promise<Result<Review>>
  /** A ticket's changed files per repo: the list alone, which is what the screen draws first. */
  diff(ticketId: number): Promise<Result<RepoDiff[]>>
  /** The two sides of one of those files, read when the boss opens it (T243). */
  fileSides(ticketId: number, repoId: string, path: string): Promise<Result<FileSides>>
  /** Every line comment on a ticket, oldest first. */
  comments(ticketId: number): Promise<Result<ReviewComment[]>>
  /** Writes a line comment as the boss; it posts to the PR and wakes the ticket's assignee. */
  comment(input: NewReviewComment): Promise<Result<ReviewComment>>
  /** A ticket's review conversation, oldest thread first, each with its messages (T170). */
  threads(ticketId: number): Promise<Result<ReviewThread[]>>
  /** Opens a thread as the boss; it posts on the PR through the boss's own CLI login. */
  openThread(input: NewReviewThread): Promise<Result<ReviewThread>>
  /** Answers a thread as the boss. */
  replyInThread(threadId: number, body: string): Promise<Result<ReviewThread>>
  /** Resolves a thread as the boss, marks it a note, or reopens it. */
  setThreadState(threadId: number, state: ThreadState): Promise<Result<ReviewThread>>
  /** Whether the ticket's forges carry the conversation; false means the panel says it stays here. */
  threadsOnForge(ticketId: number): Promise<Result<boolean>>
  /** How many rounds the agents get before the ticket becomes the boss's call. */
  roundLimit(): Promise<Result<number>>
  setRoundLimit(rounds: number): Promise<Result<number>>
  /** The latest security pass of every ticket that has one (T241). */
  securityPasses(): Promise<Result<SecurityPass[]>>
  /** Lets a merge through over an open high finding, with the reason on the record. */
  overrideSecurity(ticketId: number, reason: string): Promise<Result<SecurityPass>>
  /** Which PRs get a security pass in this Company. */
  securityScope(): Promise<Result<SecurityScope>>
  setSecurityScope(scope: SecurityScope): Promise<Result<SecurityScope>>
  /** Fires after any review, merge or line comment change and on Company switch. */
  onChanged(listener: () => void): () => void
}
