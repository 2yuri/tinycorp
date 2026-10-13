import type { DatabaseSync } from 'node:sqlite'
import type { ApprovalInput } from '../../../shared/approvals'
import { type ApprovalPullRequest, TICKET_ACTIONS, ticketSubject } from '../../../shared/approvals/approval-subject'
import type { Migration } from '../../core'
import { companyKeyOf, ticketCodeIn } from '../../core'

/** What an Approval is about, as stored: the subject, plus the ticket and PR when it names them. */
export interface ApprovalAbout {
  subject: string
  ticketId: number | null
  pullRequest: ApprovalPullRequest | null
}

/** Adds what an Approval is about as columns, and fills the ticket of older `#<id> …` subjects. */
export const APPROVAL_SUBJECT_MIGRATION: Migration = {
  name: 'approvals-ticket-and-pull-request',
  sql: `
  ALTER TABLE approval ADD COLUMN ticket_id INTEGER;
  ALTER TABLE approval ADD COLUMN pr_repo_id TEXT;
  ALTER TABLE approval ADD COLUMN pr_number INTEGER;
  UPDATE approval SET ticket_id = CAST(substr(subject, 2) AS INTEGER) WHERE subject GLOB '#[0-9]*';
`,
}

/**
 * Resolves a request to what it is about. A named ticket or PR is checked against the board and the
 * ticket's PRs, and the subject is written as `TC-142 <title>`; otherwise the requester's words are kept.
 */
export function approvalAbout(db: DatabaseSync, input: ApprovalInput): ApprovalAbout {
  const { action, ticketId, pullRequest } = input
  let id = ticketId ?? null
  let pr: ApprovalPullRequest | null = null

  if (pullRequest) {
    const row = db
      .prepare('SELECT ticket_id FROM pull_request WHERE repo_id = ? AND number = ?')
      .get(String(pullRequest.repoId), Number(pullRequest.number)) as { ticket_id: number } | undefined
    if (!row) throw new Error(`There is no PR ${pullRequest.number} in that repo on any ticket`)
    if (id !== null && id !== row.ticket_id) {
      throw new Error(
        `PR ${pullRequest.number} belongs to ${ticketCodeIn(db, row.ticket_id)}, not ${ticketCodeIn(db, id)}`,
      )
    }
    id = row.ticket_id
    pr = { repoId: pullRequest.repoId, number: pullRequest.number }
  }

  if (id !== null) {
    const ticket = db.prepare('SELECT title FROM ticket WHERE id = ?').get(id) as { title: string } | undefined
    if (!ticket) throw new Error(`There is no ticket ${ticketCodeIn(db, id)}`)
    return { subject: ticketSubject(companyKeyOf(db), id, ticket.title), ticketId: id, pullRequest: pr }
  }

  if (TICKET_ACTIONS.includes(action)) {
    throw new Error(`Asking to ${action === 'merge' ? 'merge' : 'open a PR'} needs the ticket (or the PR) it is about`)
  }
  const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
  if (!subject) throw new Error('An approval request needs a subject')
  return { subject, ticketId: null, pullRequest: null }
}
