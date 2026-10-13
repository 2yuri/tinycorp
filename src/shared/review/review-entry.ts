// Where the Review screen can be opened from, and for which ticket: a question about an Approval
// and a ticket, which are both words the two processes share. `renderer/review`'s own front door is
// React, and `src/integration` reads this in the node project, so it lives on this side of the line;
// `renderer/review/ReviewButton.tsx` draws the action itself.
import type { Approval } from '../approvals'
import type { TicketCode } from '../code'
import type { Ticket } from '../domain/board'

/** What `canOpenReview` needs of a ticket's code: a branch is enough, a PR is not required. */
export type ReviewableCode = Pick<TicketCode, 'worktrees' | 'pullRequests'> | null | undefined

/**
 * Whether the Review screen has anything to show for a ticket (T82). A PR is not the gate: the
 * screen reads a branch's own diff, so any ticket with a worktree opens it, as does one the board
 * already holds in Review — in a Company whose repos have no remote, no PR is ever opened.
 */
export function canOpenReview(ticket: Pick<Ticket, 'column'> | null | undefined, code: ReviewableCode): boolean {
  if (!ticket) return false
  if ((code?.worktrees.length ?? 0) > 0 || (code?.pullRequests.length ?? 0) > 0) return true
  return ticket.column === 'review'
}

/**
 * The ticket whose Review a merge Approval opens. A merge is always about a ticket's branch, PR or
 * not, so the card and the thread panel can carry the diff beside Approve and Send back.
 */
export function reviewTicketOfApproval(approval: Pick<Approval, 'action' | 'ticketId'>): number | null {
  return approval.action === 'merge' ? approval.ticketId : null
}
