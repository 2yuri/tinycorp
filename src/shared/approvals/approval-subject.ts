import { ticketCode } from '../ticket-id'
import type { GatedAction } from './index'

/** Actions that are always about a ticket: their Approval names it, so the app can show its PRs. */
export const TICKET_ACTIONS: readonly GatedAction[] = ['open_pr', 'merge']

/** A PR an Approval is about: the repo it is in and its number there. */
export interface ApprovalPullRequest {
  repoId: string
  number: number
}

/** The one subject format for an Approval about a ticket, written by the engine: `TC-142 Login page`. */
export function ticketSubject(companyKey: string, ticketId: number, title: string): string {
  return `${ticketCode(companyKey, ticketId)} ${title}`
}

/** How an Employee names what an Approval is about; the approval_request tool and the instructions both say it. */
export const APPROVAL_SUBJECT_RULE =
  'For open_pr and merge, name the ticket (ticket: 142 or TC-142) or, for merge, the PR (pr: repo and number) ' +
  'instead of describing it: the app writes the subject as "TC-142 <title>" and shows the PRs to the boss. ' +
  'For anything else, say what it is about in subject.'
