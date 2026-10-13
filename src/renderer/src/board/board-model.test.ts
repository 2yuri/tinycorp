import { describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import type { TicketCode } from '../../../shared/code'
import type { BoardSnapshot, Ticket } from '../../../shared/domain/board'
import type { Review } from '../../../shared/review'
import {
  type BoardFacts,
  boardMeta,
  cardFacts,
  routeOf,
  scopeTitle,
  selectionOf,
  ticketStatus,
  visibleTickets,
} from './board-model'

function ticket(id: number, changes: Partial<Ticket> = {}): Ticket {
  return {
    id,
    epicId: null,
    title: `Ticket ${id}`,
    description: '',
    column: 'todo',
    assigneeId: null,
    repos: [],
    blocked: false,
    blockedReason: '',
    blockedBy: [],
    blocks: [],
    subtasks: [],
    priority: 'normal',
    labels: [],
    baseBranch: null,
    ...changes,
  }
}

function snapshot(tickets: Ticket[]): BoardSnapshot {
  return {
    columns: [
      { id: 'todo', title: 'Todo', wipLimit: null, count: 0, overLimit: false },
      { id: 'doing', title: 'Doing', wipLimit: 3, count: 0, overLimit: false },
      { id: 'review', title: 'Review', wipLimit: 4, count: 0, overLimit: false },
      { id: 'done', title: 'Done', wipLimit: null, count: 0, overLimit: false },
    ],
    targets: [
      { id: 1, title: 'Billing', description: '', dueAt: null },
      { id: 2, title: 'Onboarding', description: '', dueAt: null },
    ],
    epics: [
      { id: 10, targetId: 1, title: 'Invoices', description: '', color: 'indigo' },
      { id: 11, targetId: 1, title: 'Plans', description: '', color: 'indigo' },
      { id: 20, targetId: 2, title: 'Signup', description: '', color: 'indigo' },
      { id: 30, targetId: null, title: 'Loose', description: '', color: 'indigo' },
    ],
    tickets,
  }
}

function approval(id: number, subject: string, status: Approval['status'] = 'pending'): Approval {
  return {
    id,
    action: 'merge',
    requesterId: 'e1',
    subject,
    ticketId: null,
    pullRequest: null,
    reason: '',
    status,
    decisionReason: null,
    channelId: 'general',
    messageId: id,
    createdAt: '',
    decidedAt: null,
  }
}

function review(ticketId: number, changes: Partial<Review> = {}): Review {
  return {
    id: ticketId * 100,
    round: 1,
    rounds: 1,
    handoff: 'agents',
    roundLimit: 3,
    ticketId,
    reviewerId: 'e2',
    status: 'pending',
    decidedBy: null,
    comments: '',
    merge: null,
    approvalId: null,
    mergedRepoIds: [],
    mergeError: null,
    messageId: 1,
    requestedAt: '',
    decidedAt: null,
    ...changes,
  }
}

function code(ticketId: number, prNumber: number | null, worktree = true): TicketCode {
  return {
    ticketId,
    worktrees: worktree
      ? [{ ticketId, repoId: 'r1', path: '/wt', branch: `ticket-${ticketId}-x`, base: 'main', createdAt: '' }]
      : [],
    pullRequests:
      prNumber === null
        ? []
        : [{ ticketId, repoId: 'r1', url: `https://x/pull/${prNumber}`, number: prNumber, openedAt: '' }],
  }
}

function facts(changes: Partial<BoardFacts> = {}): BoardFacts {
  return { sessions: {}, approvals: [], reviews: [], code: [], plans: [], tests: [], security: [], ...changes }
}

describe('ticketStatus', () => {
  it('is Working while the assignee works a ticket in Doing', () => {
    const t = ticket(1, { column: 'doing', assigneeId: 'e1' })
    expect(ticketStatus(t, facts({ sessions: { e1: 'busy' } }))).toBe('working')
    expect(ticketStatus(t, facts({ sessions: { e1: 'idle' } }))).toBeNull()
    expect(ticketStatus({ ...t, column: 'todo' }, facts({ sessions: { e1: 'busy' } }))).toBeNull()
  })

  it('is Blocked for a blocked ticket, over Working', () => {
    const t = ticket(1, { column: 'doing', assigneeId: 'e1', blocked: true })
    expect(ticketStatus(t, facts({ sessions: { e1: 'busy' } }))).toBe('blocked')
  })

  it('is Waiting on you while a pending approval names the ticket', () => {
    const t = ticket(12, { column: 'review' })
    expect(ticketStatus(t, facts({ approvals: [approval(1, '#12 Login page')] }))).toBe('waiting')
    expect(ticketStatus(t, facts({ approvals: [approval(1, '#120 Other')] }))).toBeNull()
    expect(ticketStatus(t, facts({ approvals: [approval(1, '#12 Login', 'approved')] }))).toBeNull()
  })

  it('is In review while the latest review round is pending', () => {
    const t = ticket(3, { column: 'review' })
    expect(ticketStatus(t, facts({ reviews: [review(3)] }))).toBe('review')
    const decided = review(3, { id: 301, status: 'changes_requested' })
    expect(ticketStatus(t, facts({ reviews: [review(3), decided] }))).toBeNull()
  })

  it('is Merged once the latest round merged, over everything else', () => {
    const t = ticket(4, { column: 'done', blocked: true })
    const merged = review(4, { status: 'approved', merge: 'merged' })
    expect(ticketStatus(t, facts({ reviews: [merged], approvals: [approval(1, '#4')] }))).toBe('merged')
  })
})

describe('cardFacts', () => {
  it('gives the PR numbers of a ticket, and its worktree chip while in Doing', () => {
    expect(cardFacts(ticket(7, { column: 'doing' }), facts({ code: [code(7, 128)] }))).toEqual({
      worktree: 'wt/#7',
      pullRequests: [128],
      canReview: true,
    })
    expect(cardFacts(ticket(7, { column: 'review' }), facts({ code: [code(7, 128)] }))).toEqual({
      worktree: null,
      pullRequests: [128],
      canReview: true,
    })
    expect(cardFacts(ticket(7), facts({ code: [code(7, null, false)] }))).toEqual({
      worktree: null,
      pullRequests: [],
      canReview: false,
    })
  })

  it('opens Review for a ticket with a branch and no PR, and for one the board holds in Review', () => {
    expect(cardFacts(ticket(7, { column: 'doing' }), facts({ code: [code(7, null)] })).canReview).toBe(true)
    expect(cardFacts(ticket(7, { column: 'review' }), facts({ code: [] })).canReview).toBe(true)
    expect(cardFacts(ticket(7, { column: 'todo' }), facts({ code: [] })).canReview).toBe(false)
  })
})

describe('scopes and views', () => {
  const tickets = [
    ticket(1, { epicId: 10 }),
    ticket(2, { epicId: 11, blocked: true }),
    ticket(3, { epicId: 20, column: 'review' }),
    ticket(4, { epicId: 30 }),
    ticket(5, { column: 'done' }),
  ]
  const board = snapshot(tickets)
  const f = facts({
    approvals: [approval(1, '#3 Signup form'), approval(2, 'hire someone')],
    code: [code(3, 9), code(5, 8)],
    reviews: [review(5, { status: 'approved', merge: 'merged' })],
  })
  const ids = (list: Ticket[]) => list.map((t) => t.id)

  it('scopes to a target through its epics, or to one epic', () => {
    expect(ids(visibleTickets(board, f, { scope: { kind: 'all' }, view: null }))).toEqual([1, 2, 3, 4, 5])
    expect(ids(visibleTickets(board, f, { scope: { kind: 'target', id: 1 }, view: null }))).toEqual([1, 2])
    expect(ids(visibleTickets(board, f, { scope: { kind: 'epic', id: 20 }, view: null }))).toEqual([3])
  })

  it('filters by view: my approvals, blocked, open PRs (done tickets have none open)', () => {
    const all = { kind: 'all' } as const
    expect(ids(visibleTickets(board, f, { scope: all, view: 'my-approvals' }))).toEqual([3])
    expect(ids(visibleTickets(board, f, { scope: all, view: 'blocked' }))).toEqual([2])
    expect(ids(visibleTickets(board, f, { scope: all, view: 'open-prs' }))).toEqual([3])
  })

  it('filters by assignee', () => {
    const b = snapshot([ticket(1, { assigneeId: 'e1' }), ticket(2)])
    const all = { kind: 'all' } as const
    expect(ids(visibleTickets(b, f, { scope: all, view: null, assignee: 'e1' }))).toEqual([1])
    expect(ids(visibleTickets(b, f, { scope: all, view: null, assignee: null }))).toEqual([2])
  })

  it('reads and writes the shell route', () => {
    expect(selectionOf({ view: 'board' })).toEqual({ scope: { kind: 'all' }, view: null })
    expect(selectionOf({ view: 'board', targetId: 1 })).toEqual({ scope: { kind: 'target', id: 1 }, view: null })
    expect(selectionOf({ view: 'board', epicId: 10 })).toEqual({ scope: { kind: 'epic', id: 10 }, view: null })
    expect(selectionOf({ view: 'board', filter: 'blocked' })).toEqual({ scope: { kind: 'all' }, view: 'blocked' })
    expect(routeOf({ kind: 'target', id: 1 })).toEqual({ view: 'board', targetId: 1 })
    expect(routeOf({ kind: 'epic', id: 10 })).toEqual({ view: 'board', epicId: 10 })
    expect(routeOf({ kind: 'all' })).toEqual({ view: 'board' })
  })

  it('titles the scope', () => {
    expect(scopeTitle(board, { scope: { kind: 'target', id: 1 }, view: null })).toEqual({
      title: 'Billing',
      badge: 'Target',
    })
    expect(scopeTitle(board, { scope: { kind: 'epic', id: 20 }, view: null })).toEqual({
      title: 'Signup',
      badge: 'Epic',
    })
    expect(scopeTitle(board, { scope: { kind: 'all' }, view: null })).toEqual({ title: 'All tickets', badge: null })
    expect(scopeTitle(board, { scope: { kind: 'all' }, view: 'open-prs' })).toEqual({
      title: 'Open PRs',
      badge: 'View',
    })
    // A target that no longer exists falls back to every ticket.
    expect(scopeTitle(board, { scope: { kind: 'target', id: 99 }, view: null })).toEqual({
      title: 'All tickets',
      badge: null,
    })
  })

  it('describes the visible tickets and the WIP limits', () => {
    expect(boardMeta(board, [tickets[0]!, tickets[1]!])).toBe(
      '2 tickets · 2 epics · WIP limits enforced on Doing and Review',
    )
    const noLimits = { ...board, columns: board.columns.map((c) => ({ ...c, wipLimit: null })) }
    expect(boardMeta(noLimits, [tickets[0]!])).toBe('1 ticket · 1 epic · No WIP limits')
    const oneLimit = { ...board, columns: board.columns.map((c) => ({ ...c, wipLimit: c.id === 'doing' ? 2 : null })) }
    expect(boardMeta(oneLimit, [])).toBe('0 tickets · 0 epics · WIP limit enforced on Doing')
  })
})
