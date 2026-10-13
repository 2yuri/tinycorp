/**
 * A review round, as both processes name it: who it was routed to, what they said, and where its
 * merge got to. The engine is `src/main/features/review`.
 */

/** `pending` waits for the reviewer; the others are the reviewer's verdict. */
export const REVIEW_STATUSES = ['pending', 'approved', 'changes_requested'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** What a reviewer says about a ticket's PRs. */
export type ReviewVerdict = 'approve' | 'request_changes'

/**
 * How far a ticket's review has got towards the boss (T170).
 *
 * `agents` is the reviewer and the assignee still talking on the PR: the boss sees the round go by
 * and is asked nothing. `ready` is the reviewer's approval, which raises the merge gate. `your_call`
 * is the round limit reached with the two of them still apart, which raises the same gate and says
 * so — the argument is now the boss's to settle.
 */
export type ReviewHandoff = 'agents' | 'ready' | 'your_call'

/** How many rounds a Company gives its agents before the argument becomes the boss's (T170). */
export const DEFAULT_ROUND_LIMIT = 3

/**
 * Where an approved review's merge stands: `waiting` for the boss's merge Approval, `merging` now,
 * `merged` into every repo, `failed` in one of them (the boss may retry), `rejected` by the boss,
 * `refused` by a repo that TinyCorp may not merge in (decision 61), or whose forge it can no longer
 * merge through (decision 59). A refused merge leaves the PRs open: nobody is asked, nothing is
 * closed, and the reason is on the round.
 */
export type MergeState = 'waiting' | 'merging' | 'merged' | 'failed' | 'rejected' | 'refused'

/**
 * One review round of a ticket's PRs. A ticket gets a new round each time it comes back to Review
 * with every PR open. The reviewer is an Employee holding `review`, or the boss when nobody does.
 */
export interface Review {
  id: number
  ticketId: number
  /** Which round of the ticket this is, counting from 1 — not the row id, which is Company-wide. */
  round: number
  /** How many rounds the ticket has had, so a round can say `round 2 of 2`. */
  rounds: number
  /** `BOSS` or an Employee id. */
  reviewerId: string
  status: ReviewStatus
  /** Who gave the verdict: the reviewer, or the boss stepping in. Null while pending. */
  decidedBy: string | null
  comments: string
  merge: MergeState | null
  /** The boss's `merge` Approval, when the autonomy level asked for one. */
  approvalId: number | null
  /** Repo ids whose PR is merged. */
  mergedRepoIds: string[]
  /** Why the last merge attempt failed, or null. */
  mergeError: string | null
  /** The round's `#prs` message; its thread carries the verdict and merge events. */
  messageId: number
  requestedAt: string
  decidedAt: string | null
  /** How far this round has got towards the boss (T170). */
  handoff: ReviewHandoff
  /** The Company's round limit, so a round can say `round 3 of 3` and mean the last one. */
  roundLimit: number
}

/** `In review` / `Ready for you` / `Your call`, the badge the `#prs` card carries (frame `F2HxCz`). */
export function handoffBadge(handoff: ReviewHandoff): string {
  if (handoff === 'ready') return 'Ready for you'
  if (handoff === 'your_call') return 'Your call'
  return 'In review'
}
