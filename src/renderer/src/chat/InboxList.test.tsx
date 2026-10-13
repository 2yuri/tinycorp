import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import { BOSS, COMPANY_AUTHOR, dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { askingInboxItems, type BossInboxItem, messageRowId } from '../../../shared/inbox/boss-inbox'
import { accentFor } from '../ui'
import type { ChatData } from './chat-view'
import type { InboxFilter } from './inbox-view'

// The Inbox reaches the approvals API through the thread panel's buttons; it never calls it while rendering.
let InboxList: typeof import('./InboxList').InboxList
beforeAll(async () => {
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { approvals: {} } }
  ;({ InboxList } = await import('./InboxList'))
})

const ada = { id: 'e-ada', name: 'Ada Byron', title: 'PM', capabilities: [] } as unknown as Employee
const bo = { id: 'e-bo', name: 'Bo Chen', title: 'Tech lead', capabilities: [] } as unknown as Employee
const noop = () => {}

function item(overrides: Partial<BossInboxItem> = {}): BossInboxItem {
  return {
    id: messageRowId(overrides.messageId ?? 1),
    messageId: 1,
    kind: 'mention',
    channelId: 'tech',
    threadId: 1,
    fromId: ada.id,
    text: 'can you confirm the plan tiers?',
    createdAt: new Date().toISOString(),
    unread: true,
    approvalId: null,
    planId: null,
    testRunId: null,
    ...overrides,
  }
}

const approval: Approval = {
  id: 7,
  action: 'merge',
  requesterId: bo.id,
  subject: '#128 Invoice pagination',
  ticketId: 128,
  pullRequest: null,
  reason: 'PR #128 is reviewed and green.',
  status: 'pending',
  decisionReason: null,
  channelId: 'general',
  messageId: 40,
  createdAt: new Date().toISOString(),
  decidedAt: null,
}

function data(approvals: [number, Approval][] = []): ChatData {
  return { employees: [ada, bo], board: null, code: [], repos: [], approvals: new Map(approvals), reviews: [] }
}

function render(items: BossInboxItem[], filter: InboxFilter = 'all', approvals: [number, Approval][] = []) {
  const html = renderToStaticMarkup(
    <InboxList
      items={items}
      data={data(approvals)}
      filter={filter}
      onFilter={noop}
      openThread={null}
      onOpen={noop}
      onMarkAllRead={noop}
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

describe('the Inbox list', () => {
  it('draws the filter chips with their counts and Mark all read', () => {
    const { text, html } = render([
      item({ messageId: 1, kind: 'mention' }),
      item({ messageId: 2, kind: 'dm', channelId: dmChannelId(BOSS, ada.id) }),
    ])

    expect(text).toContain('All 2')
    expect(text).toContain('Mentions 1')
    expect(text).toContain('Threads 0')
    expect(text).toContain('Approvals 0')
    expect(text).toContain('DMs 1')
    expect(text).toContain('Mark all read')
    // The chosen chip is the only one drawn in the primary colour.
    expect(html).toContain('bg-primary text-primary-foreground')
  })

  it('draws a row with who, its kind, where, the excerpt and an unread dot', () => {
    const { text, html } = render([item()])

    expect(text).toContain('Ada Byron')
    expect(text).toContain('Mention')
    expect(text).toContain('#tech')
    expect(text).toContain('can you confirm the plan tiers?')
    expect(html).toContain('aria-label="Unread"')
  })

  it('leaves the unread dot off a read row', () => {
    expect(render([item({ unread: false })]).html).not.toContain('aria-label="Unread"')
  })

  it('draws the Today and Earlier group labels', () => {
    const { text } = render([item({ messageId: 1 }), item({ messageId: 2, createdAt: '2020-01-01T09:00:00.000Z' })])

    expect(text).toContain('Today')
    expect(text).toContain('Earlier')
  })

  it('draws Approve and Send back inline on a pending Approval', () => {
    const { text } = render([item({ messageId: 40, kind: 'approval', channelId: 'general', approvalId: 7 })], 'all', [
      [40, approval],
    ])

    expect(text).toContain('PR #128 is reviewed and green.')
    expect(text).toContain('Approve &amp; merge')
    expect(text).toContain('Send back')
  })

  it('draws a Session that stopped in its terminal as a row waiting on you (T165)', () => {
    const items = askingInboxItems(
      [{ employeeId: ada.id, ask: { what: 'Write src/api/usage.ts', since: new Date().toISOString() } }],
      () => ada.name,
    )

    const { text, html } = render(items)

    expect(text).toContain('Ada Byron')
    expect(text).toContain('Asking you')
    expect(text).toContain('terminal')
    expect(text).toContain('Ada Byron is asking in their terminal: Write src/api/usage.ts')
    expect(html).toContain('aria-label="Unread"')
    // It is no Approval, so the row carries no Approve / Send back: the boss answers in the terminal.
    expect(text).not.toContain('Approve')
  })

  it('draws the Company’s waiting notice without initials', () => {
    const { text } = render([
      item({
        kind: 'waiting',
        fromId: COMPANY_AUTHOR,
        text: 'Waiting for capacity: Bo will answer when a slot frees.',
      }),
    ])

    expect(text).toContain('Waiting')
    expect(text).toContain('Waiting for capacity: Bo will answer when a slot frees.')
    expect(text).not.toContain('BO ')
  })

  it('draws each sender on their own accent, and the Company’s notice on the icon tile', () => {
    const { html } = render([
      item({ messageId: 1, fromId: ada.id }),
      item({ messageId: 2, fromId: bo.id }),
      item({ messageId: 3, kind: 'waiting', fromId: COMPANY_AUTHOR }),
    ])

    expect(html).toContain(`data-accent="${accentFor(ada.id)}"`)
    expect(html).toContain(`data-accent="${accentFor(bo.id)}"`)
    expect(html).toContain('--ui-avatar-size:32px')
    expect(html.match(/data-ui="Avatar"/g)).toHaveLength(2)
    // A capacity notice is nobody's: a square tile in place of the row's Avatar.
    expect(html).toContain('<span class="inline-flex size-32')
  })

  it('says so when nothing is waiting', () => {
    expect(render([]).text).toContain('Nothing waiting on you')
  })
})
