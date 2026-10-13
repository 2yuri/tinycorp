/**
 * The code flow's slice of the IPC contract (T187). `src/shared/ipc/index.ts` composes the slices
 * into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { PullRequestDetails, TicketCode } from './index'

/** The current Company's ticket worktrees and PRs. Exposed as `window.tinyCorp.code`. */
export interface CodeApi {
  /** Every ticket that has a worktree or a PR. */
  list(): Promise<Result<TicketCode[]>>
  /** What GitHub says about each of a ticket's PRs: size, mergeability and checks. Cached briefly. */
  details(ticketId: number): Promise<Result<PullRequestDetails[]>>
  /** Fires after any worktree or PR change and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}
