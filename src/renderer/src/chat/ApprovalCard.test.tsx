import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Approval, GatedAction } from '../../../shared/approvals'
import type { BoardSnapshot, Ticket } from '../../../shared/domain/board'
import type { Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { EMPTY_STACK, type Repo } from '../../../shared/repos/repo'
import type { ChatData } from './chat-view'

let cards: typeof import('./ApprovalCard')
let view: typeof import('./chat-view')

beforeAll(async () => {
  // The module reads the preload API when it loads; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { approvals: {} } }
  cards = await import('./ApprovalCard')
  view = await import('./chat-view')
})

const bo: Employee = {
  id: 'e-bo',
  name: 'Bo',
  roleId: 'tech-lead',
  title: 'Tech Lead',
  persona: '',
  capabilities: ['code'],
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  overrides: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  desk: 0,
  sprite: 0,
  createdAt: '',
}

const web: Repo = {
  id: 'r-web',
  name: 'web-app',
  path: '/w',
  brief: '',
  rung: 'merge',
  stack: EMPTY_STACK,
  addedAt: '',
}

const ticket: Ticket = {
  id: 5,
  epicId: null,
  title: 'Invoice pagination',
  description: '',
  column: 'review',
  assigneeId: bo.id,
  repos: ['r-web'],
  blocked: false,
  blockedReason: '',
  blockedBy: [],
  blocks: [],
  subtasks: [],
  priority: 'normal',
  labels: [],
  baseBranch: null,
}

const board: BoardSnapshot = {
  columns: [{ id: 'review', title: 'Review', wipLimit: null, count: 1, overLimit: false }],
  targets: [],
  epics: [],
  tickets: [ticket],
}

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 7,
    action: 'hire',
    requesterId: bo.id,
    subject: 'a new QA named Iris',
    ticketId: null,
    pullRequest: null,
    reason: 'Nobody can review the invoices epic.',
    status: 'pending',
    decisionReason: null,
    channelId: 'general',
    messageId: 41,
    createdAt: '2026-09-17T09:40:00',
    decidedAt: null,
    ...overrides,
  }
}

const data: ChatData = {
  employees: [bo],
  board,
  code: [],
  repos: [web],
  approvals: new Map(),
  reviews: [],
}

function message(replyCount = 0): Message {
  return {
    id: 41,
    kind: 'post',
    channelId: 'general',
    threadId: null,
    authorId: bo.id,
    text: 'Billing is short a reviewer.',
    mentions: ['boss'],
    mentionsChannel: false,
    replyCount,
    createdAt: '2026-09-17T09:40:00',
  }
}

function renderCard(a: Approval, replies = 0) {
  return renderToStaticMarkup(
    <cards.ApprovalCard card={view.approvalCard(a, message(replies), data)} onOpenThread={() => {}} />,
  )
}

describe('the approval card under a message', () => {
  it('shows the kind, the subject, the reason and inline Approve / Send back while pending', () => {
    const html = renderCard(approval())

    expect(html).toContain('Hire · a new QA named Iris')
    expect(html).toContain('Nobody can review the invoices epic.')
    expect(html).toContain('Approve hire')
    expect(html).toContain('Send back')
    expect(html).toContain('Open thread')
    expect(html).not.toContain('Approval needed')
  })

  it('labels Approve per kind, for every kind', () => {
    const labels: Partial<Record<GatedAction, string>> = {
      merge: 'Approve &amp; merge',
      open_pr: 'Approve PR',
      hire: 'Approve hire',
      fire: 'Approve firing',
      other: 'Approve',
    }
    for (const [action, label] of Object.entries(labels)) {
      const html = renderCard(approval({ action: action as GatedAction, ticketId: null, subject: 'it' }))
      expect(html).toContain(label)
    }
  })

  it('names the ticket’s repos and counts the replies', () => {
    const html = renderCard(approval({ action: 'merge', subject: '#5 Invoice pagination', ticketId: 5 }), 2)

    // The fixture's ticket has no PR, so this is the local merge of decision 44.
    expect(html).toContain('Merge locally · #5 Invoice pagination')
    expect(html).toContain('web-app')
    expect(html).toContain('2 replies')
  })

  it('carries Review beside Approve and Send back on a local merge (T82)', () => {
    const html = renderCard(approval({ action: 'merge', subject: '#5 Invoice pagination', ticketId: 5 }))

    expect(html).toContain('data-ui="Review"')
    expect(html).toContain('Review')
    expect(html).toContain('Approve &amp; merge')
    expect(html).toContain('Send back')
  })

  it('offers no Review on a request that is not about a ticket’s branch', () => {
    expect(renderCard(approval({ action: 'hire' }))).not.toContain('data-ui="Review"')
    expect(renderCard(approval({ action: 'merge', ticketId: null }))).not.toContain('data-ui="Review"')
  })

  it('shows the decision, and no buttons, once it is decided', () => {
    const approved = renderCard(
      approval({ status: 'approved', decidedAt: '2026-09-17T18:02:00', decisionReason: 'Go ahead' }),
    )
    expect(approved).toContain('border-l-brand-success')
    expect(approved).toContain('Approved by you · 18:02')
    expect(approved).toContain('Go ahead')
    expect(approved).not.toContain('Approve hire')

    const sentBack = renderCard(approval({ status: 'rejected', decidedAt: '2026-09-17T18:02:00' }))
    expect(sentBack).toContain('border-l-status-error-foreground')
    expect(sentBack).toContain('Sent back by you · 18:02')
    expect(sentBack).toContain('No reason given')
    expect(sentBack).not.toContain('Send back<')
  })
})

describe('the approval card in the thread panel', () => {
  it('opens the card up: kind, waiting badge, title, reason and the fact rows', () => {
    const html = renderToStaticMarkup(
      <cards.ApprovalDetailCard
        approval={approval({ action: 'merge', subject: '#5 Invoice pagination', ticketId: 5 })}
        data={data}
      />,
    )

    expect(html).toContain('Waiting on you')
    expect(html).toContain('Merge locally · #5 Invoice pagination')
    expect(html).toContain('Nobody can review the invoices epic.')
    expect(html).toContain('Asked by Bo')
    expect(html).toContain('Ticket · #5 Invoice pagination')
    expect(html).toContain('Repos · web-app')
  })

  it('carries Review beside an Inbox row’s Approve and Send back (T82)', () => {
    const merge = approval({ action: 'merge', subject: '#5 Invoice pagination', ticketId: 5 })
    const html = renderToStaticMarkup(<cards.ApprovalButtons approval={merge} />)

    expect(html).toContain('data-ui="Review"')
    expect(html).toContain('Approve &amp; merge')
    expect(renderToStaticMarkup(<cards.ApprovalButtons approval={approval()} />)).not.toContain('data-ui="Review"')
  })

  it('keeps the panel’s row to its two decisions and puts Review in the card’s head (T151)', () => {
    const merge = approval({ action: 'merge', subject: '#5 Invoice pagination', ticketId: 5 })
    const row = renderToStaticMarkup(<cards.ApprovalButtons approval={merge} withReview={false} />)
    expect(row).toContain('Approve &amp; merge')
    expect(row).toContain('Send back')
    expect(row).not.toContain('data-ui="Review"')

    const card = renderToStaticMarkup(<cards.ApprovalDetailCard approval={merge} data={data} />)
    // In the head: after the kind that opens the card, and before the body under the title. The
    // slice used to be taken between two class names this ticket deleted.
    expect(card).toContain('data-ui="Review"')
    expect(card.indexOf('data-ui="Review"')).toBeGreaterThan(card.indexOf('Merge locally'))
    expect(card.indexOf('data-ui="Review"')).toBeLessThan(card.indexOf('Nobody can review'))
    expect(renderToStaticMarkup(<cards.ApprovalDetailCard approval={approval()} data={data} />)).not.toContain(
      'data-ui="Review"',
    )
  })

  it('drops the waiting badge and states the outcome once decided', () => {
    const decided = approval({ status: 'rejected', decisionReason: 'Not this week', decidedAt: '2026-09-17T18:02:00' })
    const html = renderToStaticMarkup(<cards.ApprovalDetailCard approval={decided} data={data} />)
    expect(html).not.toContain('Waiting on you')
    expect(html).toContain('Sent back by you · 18:02')

    expect(renderToStaticMarkup(<cards.ApprovalOutcome approval={decided} />)).toContain('Not this week')
  })
})
