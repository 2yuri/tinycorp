import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import type { Employee } from '../../../shared/domain/staff'
import { type BossInboxItem, messageRowId } from '../../../shared/inbox/boss-inbox'
import type { ChatData } from '../chat'
import { deskView } from './desk-view'

// The panel reaches the approvals API through the card's buttons; it never calls it while rendering.
let DeskPanel: typeof import('./BossDesk').DeskPanel
beforeAll(async () => {
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { approvals: {}, chat: {} } }
  ;({ DeskPanel } = await import('./BossDesk'))
})

const ada = { id: 'e-ada', name: 'Ada Byron', title: 'DevOps', sprite: 1, capabilities: [] } as unknown as Employee
const bo = { id: 'e-bo', name: 'Bo Chen', title: 'PM', sprite: 2, capabilities: ['intake'] } as unknown as Employee

const data: ChatData = {
  employees: [ada, bo],
  board: null,
  code: [],
  repos: [],
  approvals: new Map(),
  reviews: [],
  answererId: bo.id,
  bossName: 'Yuri Miguel',
  bossInitials: 'YM',
  bossSprite: 3,
}

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 1,
    action: 'merge',
    requesterId: ada.id,
    subject: '#131 Currency + locale helper',
    ticketId: 131,
    pullRequest: null,
    reason: 'Iris approved it and the checks are green.',
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
    text: 'can you confirm the three plan tiers before Vega builds the switcher?',
    createdAt: new Date().toISOString(),
    unread: true,
    approvalId: null,
    planId: null,
    testRunId: null,
    ...overrides,
  }
}

const never = async () => true

function render(approvals: Approval[] = [], inbox: BossInboxItem[] = []) {
  const html = renderToStaticMarkup(
    <DeskPanel
      view={deskView(approvals, inbox, data)}
      data={data}
      onClose={() => {}}
      onOpen={() => {}}
      onSend={never}
    />,
  )
  return {
    html,
    text: html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }
}

describe('Your desk', () => {
  it('heads the panel with the boss, the title, the counts and a way out', () => {
    const { html, text } = render([approval()], [item()])

    expect(html).toContain('aria-label="Your desk"')
    expect(html).toContain('aria-label="Yuri Miguel"')
    // T79: the head draws the character the boss picked, their initials standing in until it decodes.
    expect(html).toContain('data-sprite="3"')
    expect(html).toContain('<span data-slot="avatar-initials">YM</span>')
    expect(text).toContain('Your desk')
    expect(text).toContain('1 waiting on you · 1 unread')
    expect(html).toContain('aria-label="Close your desk"')
  })

  it('puts each waiting Approval on its own card, with Approve and Send back inline', () => {
    const { html, text } = render([approval()])

    expect(html).toContain('aria-label="Waiting on you"')
    expect(text).toContain('Ada Byron')
    expect(text).toContain('DEVOPS')
    expect(text).toContain('09:31')
    expect(text).toContain('Merge locally · #131 Currency + locale helper')
    expect(text).toContain('Iris approved it and the checks are green.')
    expect(text).toContain('Approve &amp; merge')
    expect(text).toContain('Send back')
    // The Company has no remote, so the merge card is a way into the Review screen too (T82).
    expect(html).toContain('data-ui="Review"')
    expect(text).toContain('Review')
  })

  it('lists what is unread as the Inbox rows, compact', () => {
    const { html, text } = render([], [item()])

    expect(html).toContain('aria-label="Unread for you"')
    // Compact: the desk's rows carry no padding of their own, and the panel scrolls, not the list.
    expect(html).toContain('flex-none flex-col gap-16 overflow-visible p-0')
    expect(text).toContain('Bo Chen')
    expect(text).toContain('Mention')
    expect(text).toContain('#ep-usage-invoices')
    expect(text).toContain('can you confirm the three plan tiers before Vega builds the switcher?')
  })

  it('always offers the composer, with its affordances and who answers', () => {
    const { html, text } = render()

    expect(html).toContain('aria-label="Set a goal, or ask the team something…"')
    expect(html).toContain('aria-label="Attach a file"')
    expect(html).toContain('aria-label="Mention someone"')
    expect(html).toContain('aria-label="Run a command"')
    expect(text).toContain('Bo Chen answers')
  })

  it('says so when nothing waits and nothing is unread', () => {
    const { html, text } = render([], [item({ unread: false })])

    expect(text).toContain('Nothing is waiting on you')
    expect(html).not.toContain('aria-label="Waiting on you"')
    expect(html).not.toContain('aria-label="Unread for you"')
  })
})
