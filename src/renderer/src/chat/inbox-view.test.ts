import { describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import type { BoardSnapshot, Ticket } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR, dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { askingInboxItems, askRowId, type BossInboxItem, messageRowId } from '../../../shared/inbox/boss-inbox'
import type { Plan } from '../../../shared/planning/planning'
import type { ChatData } from './chat-view'
import {
  FILTER_LABEL,
  filterCounts,
  INBOX_FILTERS,
  inboxGroups,
  inboxHeader,
  inboxTime,
  reviewTicketOf,
  rowTarget,
  rowTerminal,
  unreadCount,
} from './inbox-view'

const now = new Date('2026-03-04T10:00:00.000Z')
const today = (hhmm: string) => `2026-03-04T${hhmm}:00.000Z`
const yesterday = (hhmm: string) => `2026-03-03T${hhmm}:00.000Z`

const ada = { id: 'e-ada', name: 'Ada Byron', title: 'PM', capabilities: ['intake'] } as unknown as Employee
const bo = { id: 'e-bo', name: 'Bo Chen', title: 'Tech lead', capabilities: [] } as unknown as Employee

function item(overrides: Partial<BossInboxItem> = {}): BossInboxItem {
  return {
    id: messageRowId(overrides.messageId ?? 1),
    messageId: 1,
    kind: 'mention',
    channelId: 'tech',
    threadId: 1,
    fromId: ada.id,
    text: '@boss can you confirm the plan tiers?',
    createdAt: today('09:20'),
    unread: true,
    approvalId: null,
    planId: null,
    testRunId: null,
    ...overrides,
  }
}

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 7,
    action: 'merge',
    requesterId: bo.id,
    subject: '#128 Invoice pagination',
    ticketId: 128,
    pullRequest: null,
    reason: 'PR #128 on billing-api is reviewed and green.',
    status: 'pending',
    decisionReason: null,
    channelId: 'general',
    messageId: 40,
    createdAt: today('09:31'),
    decidedAt: null,
    ...overrides,
  }
}

function data(approvals: [number, Approval][] = [], plans: Plan[] = []): ChatData {
  return {
    employees: [ada, bo],
    companyKey: 'TC',
    board: null,
    code: [],
    repos: [],
    approvals: new Map(approvals),
    reviews: [],
    plans,
  }
}

/** A plan of TC-142 drafted by Bo and waiting on the boss. */
function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 3,
    version: 1,
    ticketId: 142,
    epicId: null,
    plannerId: bo.id,
    goal: 'Customers see what they used over a chosen range.',
    approach: '',
    acceptanceCriteria: [],
    repos: [],
    subtasks: [],
    risks: [],
    openQuestions: [],
    status: 'waiting',
    approvedBy: null,
    approvedAt: null,
    replanBy: null,
    replanReason: null,
    replanChanges: [],
    channelId: 'general',
    threadId: 40,
    messageId: 41,
    createdAt: today('09:31'),
    questions: [],
    ...overrides,
  }
}

describe('the Inbox filters', () => {
  const items = [
    item({ messageId: 1, kind: 'mention' }),
    item({ messageId: 2, kind: 'thread' }),
    item({ messageId: 3, kind: 'thread' }),
    item({ messageId: 4, kind: 'approval', approvalId: 7 }),
    item({ messageId: 5, kind: 'dm', channelId: dmChannelId(BOSS, ada.id) }),
    item({ messageId: 6, kind: 'waiting', fromId: COMPANY_AUTHOR }),
  ]

  it('reads All, Mentions, Threads, Approvals, DMs', () => {
    expect(INBOX_FILTERS.map((f) => FILTER_LABEL[f])).toEqual(['All', 'Mentions', 'Threads', 'Approvals', 'DMs'])
  })

  it('counts every chip, with All keeping the capacity notice too', () => {
    expect(filterCounts(items)).toEqual({ all: 6, mentions: 1, threads: 2, approvals: 1, dms: 1 })
  })

  it('keeps only the chosen kind', () => {
    expect(inboxGroups(items, data(), 'threads', now)[0]!.rows.map((r) => r.messageId)).toEqual([3, 2])
    expect(inboxGroups(items, data(), 'dms', now)[0]!.rows.map((r) => r.messageId)).toEqual([5])
  })
})

describe('the Inbox grouping', () => {
  it('groups Today then Earlier, unread first and newest first inside each', () => {
    const items = [
      item({ messageId: 1, createdAt: today('09:31'), unread: true }),
      item({ messageId: 2, createdAt: today('09:35'), unread: false }),
      item({ messageId: 3, createdAt: today('09:20'), unread: true }),
      item({ messageId: 4, createdAt: yesterday('16:00'), unread: false }),
      item({ messageId: 5, createdAt: yesterday('08:00'), unread: true }),
    ]

    expect(inboxGroups(items, data(), 'all', now).map((g) => [g.label, g.rows.map((r) => r.messageId)])).toEqual([
      ['Today', [1, 3, 2]],
      ['Earlier', [5, 4]],
    ])
  })

  it('lifts a pending Approval above the other unread rows of its day', () => {
    const items = [
      item({ messageId: 40, kind: 'approval', approvalId: 7, createdAt: today('09:31') }),
      item({ messageId: 41, kind: 'thread', createdAt: today('09:35') }),
    ]

    expect(inboxGroups(items, data([[40, approval()]]), 'all', now)[0]!.rows.map((r) => r.messageId)).toEqual([40, 41])
  })

  it('leaves a decided Approval in its place in time', () => {
    const items = [
      item({ messageId: 40, kind: 'approval', approvalId: 7, createdAt: today('09:31') }),
      item({ messageId: 41, kind: 'thread', createdAt: today('09:35') }),
    ]
    const decided = data([[40, approval({ status: 'approved' })]])

    expect(inboxGroups(items, decided, 'all', now)[0]!.rows.map((r) => r.messageId)).toEqual([41, 40])
  })

  it('leaves out a group with no rows', () => {
    expect(inboxGroups([item()], data(), 'all', now).map((g) => g.label)).toEqual(['Today'])
    expect(inboxGroups([], data(), 'all', now)).toEqual([])
  })

  it('times a row by its day: the clock today, Yesterday, then a short date', () => {
    expect(inboxTime(today('09:31'), now)).toMatch(/^\d\d:31$/)
    expect(inboxTime(yesterday('16:00'), now)).toBe('Yesterday')
    expect(inboxTime('2026-02-20T16:00:00.000Z', now)).toBe('Feb 20')
  })
})

describe('an Inbox row', () => {
  it('reads who, the kind, where, the excerpt and its unread dot', () => {
    const [row] = inboxGroups([item()], data(), 'all', now)[0]!.rows

    expect(row).toMatchObject({
      who: 'Ada Byron',
      fromId: 'e-ada',
      kindLabel: 'Mention',
      icon: 'mention',
      where: '#tech',
      excerpt: '@boss can you confirm the plan tiers?',
      unread: true,
    })
  })

  it('names a DM by its kind, not by the channel id', () => {
    const dm = item({ kind: 'dm', channelId: dmChannelId(BOSS, ada.id) })

    expect(inboxGroups([dm], data(), 'all', now)[0]!.rows[0]).toMatchObject({
      kindLabel: 'Direct message',
      where: 'DM',
    })
  })

  it('reads a pending Approval as the sentence its requester wrote, and carries its actions', () => {
    const pending = approval()
    const row = inboxGroups(
      [
        item({
          messageId: 40,
          kind: 'approval',
          channelId: 'general',
          approvalId: 7,
          planId: null,
          text: '@boss Approval needed: may I merge? #128',
        }),
      ],
      data([[40, pending]]),
      'all',
      now,
    )[0]!.rows[0]!

    expect(row.kindLabel).toBe('Approval')
    expect(row.icon).toBe('approval')
    expect(row.excerpt).toBe('PR #128 on billing-api is reviewed and green.')
    expect(row.approval).toBe(pending)
  })

  // TI-6: the plan landed as a line in an epic channel and the boss never had a decision to make.
  it('carries a drafted plan with its own Approve / Ask for changes, under the Approvals chip', () => {
    const waiting = plan()
    const row = inboxGroups(
      [
        item({
          messageId: 41,
          kind: 'plan',
          channelId: 'general',
          planId: waiting.id,
          fromId: bo.id,
          text: 'Drafted the plan for TC-142. Approve it and it goes to Ready.',
        }),
      ],
      data([], [waiting]),
      'approvals',
      now,
    )[0]!.rows[0]!

    expect(row.kindLabel).toBe('Plan to approve')
    expect(row.icon).toBe('plan')
    expect(row.plan).toBe(waiting)
    expect(row.excerpt).toBe('Plan v1 is ready: approve it, or send it back')
  })

  it('reads a decided Approval as its outcome, with no actions left', () => {
    const decided = approval({ status: 'approved', decidedAt: today('09:40') })
    const row = inboxGroups(
      [item({ messageId: 40, kind: 'approval', approvalId: 7 })],
      data([[40, decided]]),
      'all',
      now,
    )[0]!.rows[0]!

    expect(row.kindLabel).toBe('Approved')
    expect(row.icon).toBe('decided')
    expect(row.approval).toBeNull()
  })

  it('folds a multi-line message into one line', () => {
    const row = inboxGroups([item({ text: 'first line\n\nsecond   line' })], data(), 'all', now)[0]!.rows[0]!

    expect(row.excerpt).toBe('first line second line')
  })

  it('opens its channel and thread', () => {
    expect(rowTarget(item({ channelId: 'general', threadId: 12 }))).toEqual({ channelId: 'general', threadId: 12 })
    expect(rowTerminal(item({ channelId: 'general', threadId: 12 }))).toBeNull()
  })

  /**
   * A Session stopped in its terminal (T165). It belongs to no channel and no thread, so the row
   * says where it really is and goes to that Employee's drawer rather than to a conversation.
   */
  it('sends an asking row to the Employee’s terminal, not to a thread', () => {
    const ask = askingInboxItems(
      [{ employeeId: ada.id, ask: { what: 'Write src/api/usage.ts', since: today('09:31') } }],
      () => 'Ada Byron',
    )[0]!
    const [row] = inboxGroups([ask], data(), 'all', now)[0]!.rows

    expect(rowTerminal(ask)).toBe(ada.id)
    expect(row).toMatchObject({
      id: askRowId(ada.id),
      who: 'Ada Byron',
      kindLabel: 'Asking you',
      icon: 'asking',
      where: 'terminal',
      excerpt: 'Ada Byron is asking in their terminal: Write src/api/usage.ts',
      unread: true,
      approval: null,
      reviewTicketId: null,
    })
  })

  it('keeps an asking row in All, and out of every other chip', () => {
    const ask = askingInboxItems(
      [{ employeeId: ada.id, ask: { what: 'rm -rf build', since: today('09:31') } }],
      () => 'Ada Byron',
    )

    expect(filterCounts(ask)).toEqual({ all: 1, mentions: 0, threads: 0, approvals: 0, dms: 0 })
  })
})

function boardWith(column: Ticket['column']): BoardSnapshot {
  const ticket = {
    id: 142,
    epicId: null,
    title: 'Currency helper',
    description: '',
    column,
    assigneeId: bo.id,
    repos: [],
    blocked: false,
    blockedReason: '',
    blockedBy: [],
    blocks: [],
    subtasks: [],
    priority: 'normal',
    labels: [],
    baseBranch: null,
  } as Ticket
  return { columns: [], targets: [], epics: [], tickets: [ticket] }
}

describe('an Inbox row about a review (T75)', () => {
  const prs = item({ channelId: 'prs', text: 'Review requested from @boss for #142 Currency helper: billing-api …' })

  it('opens the Review screen for a ticket the board still has in review', () => {
    expect(reviewTicketOf(prs, { ...data(), board: boardWith('review') })).toBe(142)
    expect(inboxGroups([prs], { ...data(), board: boardWith('review') }, 'all', now)[0]!.rows[0]!.reviewTicketId).toBe(
      142,
    )
  })

  // Decision 33: the engine now writes `TC-142` in `#prs`, and `#142` stays a reference too.
  it('reads the ticket from the display id the engine writes', () => {
    const byCode = item({ channelId: 'prs', text: 'Review requested from @boss for TC-142 Currency helper: …' })

    expect(reviewTicketOf(byCode, { ...data(), board: boardWith('review') })).toBe(142)
  })

  // The boss read a "may I open the PR" request as a PR to review, before any PR existed (T233).
  it('offers no Review on the row that is asking whether to open the PR at all', () => {
    const asking = item({
      messageId: 40,
      kind: 'approval',
      channelId: 'prs',
      approvalId: 7,
      text: 'TC-142 Currency helper is done and pushed, so I\u2019d like to open its pull request.',
    })
    const openPr = approval({ action: 'open_pr', reason: '', subject: 'TC-142 Currency helper' })
    const chat = { ...data([[40, openPr]]), board: boardWith('review') }

    expect(reviewTicketOf(asking, chat)).toBeNull()
    expect(inboxGroups([asking], chat, 'all', now)[0]!.rows[0]!.excerpt).toBe('Open the PR for TC-142 Currency helper?')
  })

  it('offers nothing once the ticket has left review, or outside #prs', () => {
    expect(reviewTicketOf(prs, { ...data(), board: boardWith('done') })).toBeNull()
    expect(reviewTicketOf(prs, data())).toBeNull()
    expect(
      reviewTicketOf(item({ channelId: 'tech', text: 'about #142' }), { ...data(), board: boardWith('review') }),
    ).toBeNull()
    expect(
      reviewTicketOf(item({ channelId: 'prs', text: 'no ticket here' }), { ...data(), board: boardWith('review') }),
    ).toBeNull()
  })
})

describe('the Inbox header', () => {
  it('counts what is unread and says what the list is', () => {
    const items = [item({ messageId: 1 }), item({ messageId: 2, unread: false })]

    expect(unreadCount(items)).toBe(1)
    expect(inboxHeader(items)).toEqual({
      title: 'Inbox',
      members: '1 unread',
      memberIds: [],
      topic: 'Everything waiting on you, newest first. Click a row to open its thread.',
    })
  })
})
