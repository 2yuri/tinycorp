import { describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import type { Employee } from '../../../shared/domain/staff'
import { type BossInboxItem, messageRowId } from '../../../shared/inbox/boss-inbox'
import type { ChatData } from '../chat'
import { deskView } from './desk-view'

const ada = { id: 'e-ada', name: 'Ada Byron', title: 'DevOps', capabilities: [] } as unknown as Employee
const bo = { id: 'e-bo', name: 'Bo Chen', title: 'PM', capabilities: ['intake'] } as unknown as Employee

const data: ChatData = {
  employees: [ada, bo],
  board: null,
  code: [],
  repos: [],
  approvals: new Map(),
  reviews: [],
}

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 1,
    action: 'merge',
    requesterId: ada.id,
    subject: '#131 Currency + locale helper',
    ticketId: 131,
    pullRequest: null,
    reason: 'Iris approved it.',
    status: 'pending',
    decisionReason: null,
    channelId: 'general',
    messageId: 10,
    createdAt: '2026-09-17T09:31:00',
    decidedAt: null,
    ...overrides,
  }
}

function item(overrides: Partial<BossInboxItem> = {}): BossInboxItem {
  return {
    id: messageRowId(overrides.messageId ?? 20),
    messageId: 20,
    kind: 'mention',
    channelId: 'ep-usage-invoices',
    threadId: 20,
    fromId: bo.id,
    text: 'can you confirm the three plan tiers?',
    createdAt: '2026-09-17T09:20:00',
    unread: true,
    approvalId: null,
    planId: null,
    testRunId: null,
    ...overrides,
  }
}

describe('deskView', () => {
  it('counts what waits and what is unread, as the head writes it', () => {
    const view = deskView([approval(), approval({ id: 2, messageId: 11 })], [item(), item({ messageId: 21 })], data)

    expect(view.summary).toBe('2 waiting on you · 2 unread')
    expect(view.empty).toBe(false)
  })

  it('keeps only the Approvals the boss still owes a decision, oldest first', () => {
    const decided = approval({ id: 3, status: 'approved', decidedAt: '2026-09-17T09:40:00' })
    const later = approval({ id: 2, messageId: 11, createdAt: '2026-09-17T09:40:00' })

    const view = deskView([approval(), decided, later], [], data)

    expect(view.waiting.map((w) => w.approval.id)).toEqual([1, 2])
  })

  it('writes who asked, their role tag and the time on each card', () => {
    const view = deskView([approval()], [], data)

    expect(view.waiting[0]!.who).toBe('Ada Byron')
    expect(view.waiting[0]!.role).toBe('DEVOPS')
    expect(view.waiting[0]!.time).toBe('09:31')
    expect(view.waiting[0]!.card.kind).toBe('approval')
    expect(view.waiting[0]!.card.waiting).toBe(true)
  })

  it('leaves read rows out of Unread for you', () => {
    const view = deskView([], [item(), item({ messageId: 21, unread: false })], data)

    expect(view.unread.map((i) => i.messageId)).toEqual([20])
    expect(view.summary).toBe('0 waiting on you · 1 unread')
  })

  it('asks for a decision once: an Approval that is also an unread row stays a card', () => {
    const view = deskView([approval()], [item({ messageId: 10, kind: 'approval', approvalId: 1 })], data)

    expect(view.waiting).toHaveLength(1)
    expect(view.unread).toEqual([])
  })

  it('is empty when nothing waits and nothing is unread', () => {
    const view = deskView([approval({ status: 'rejected' })], [item({ unread: false })], data)

    expect(view.empty).toBe(true)
    expect(view.summary).toBe('0 waiting on you · 0 unread')
  })
})
