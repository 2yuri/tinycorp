import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import type { TicketCode } from '../../../shared/code'
import type { Ticket } from '../../../shared/domain/board'

beforeAll(() => {
  ;(globalThis as { window?: unknown }).window ??= { tinyCorp: {} }
})

const { canOpenReview, reviewTicketOfApproval } = await import('../../../shared/review/review-entry')
const { REVIEW_OPEN, ReviewButton } = await import('./ReviewButton')

const ticket = (column: Ticket['column']) => ({ column }) as Pick<Ticket, 'column'>

const code = (over: Partial<TicketCode> = {}): TicketCode => ({
  ticketId: 9,
  worktrees: [],
  pullRequests: [],
  ...over,
})

const worktree = { ticketId: 9, repoId: 'r', path: '/c/w', branch: 'ticket-9-x', base: 'main', createdAt: '' }
const pullRequest = { ticketId: 9, repoId: 'r', url: 'https://x/pull/3', number: 3, openedAt: '' }

describe('where Review can be opened from', () => {
  it('opens for a ticket with a branch and no PR at all', () => {
    expect(canOpenReview(ticket('doing'), code({ worktrees: [worktree] }))).toBe(true)
  })

  it('opens for every ticket in Review, branch or not', () => {
    expect(canOpenReview(ticket('review'), code())).toBe(true)
    expect(canOpenReview(ticket('review'), null)).toBe(true)
  })

  it('opens for a ticket that still has a PR after it left Review', () => {
    expect(canOpenReview(ticket('done'), code({ pullRequests: [pullRequest] }))).toBe(true)
  })

  it('stays shut for a ticket with nothing to read, and for no ticket', () => {
    expect(canOpenReview(ticket('todo'), code())).toBe(false)
    expect(canOpenReview(ticket('doing'), null)).toBe(false)
    expect(canOpenReview(null, code({ worktrees: [worktree] }))).toBe(false)
  })
})

describe('the ticket a merge approval reviews', () => {
  const approval = (over: Partial<Approval>) => ({ action: 'merge', ticketId: 9, ...over }) as Approval

  it('is the merge’s own ticket, whether or not it has a PR', () => {
    expect(reviewTicketOfApproval(approval({}))).toBe(9)
  })

  it('is nothing for a merge about no ticket, or for another kind of request', () => {
    expect(reviewTicketOfApproval(approval({ ticketId: null }))).toBe(null)
    expect(reviewTicketOfApproval(approval({ action: 'hire' }))).toBe(null)
  })
})

describe('the Review button', () => {
  it('reads `Review` and carries the pill every entry point draws it as', () => {
    const html = renderToStaticMarkup(<ReviewButton ticketId={9} />)

    expect(html).toContain(REVIEW_OPEN)
    expect(html).toContain('Review')
  })
})
