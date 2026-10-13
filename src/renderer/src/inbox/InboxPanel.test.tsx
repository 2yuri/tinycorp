import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Employee } from '../../../shared/domain/staff'
import type { InboxItem } from '../../../shared/inbox'
import { accentFor } from '../ui'

vi.hoisted(() => {
  Object.assign(globalThis, { window: { tinyCorp: { inbox: {}, staff: {}, company: {} } } })
})
const { InboxPanel } = await import('./InboxPanel')

const item: InboxItem = {
  id: 7,
  employeeId: 'ada',
  kind: 'thread',
  fromId: 'boss',
  channelId: 'tech',
  threadId: 3,
  messageId: 9,
  ticketId: null,
  text: 'try batching them',
  prompt: '[company] thread reply from boss in #tech, thread 3',
  status: 'pending',
  attempts: 0,
  createdAt: '2026-09-17T10:00:00.000Z',
  handledAt: null,
}

const ada = { id: 'ada', name: 'Ada Byron', sprite: 2 } as Employee
const people = { employees: [ada] }

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('InboxPanel', () => {
  it('shows a thread reply with the thread label and where it was said', () => {
    const html = renderToStaticMarkup(
      <InboxPanel
        inbox={{ pending: [item], unread: [], handled: [], error: null, nameOf: (id) => id, people, companyKey: 'TC' }}
      />,
    )

    expect(html).toMatch(/<span[^>]*>thread<\/span>/)
    expect(text(html)).toContain('from boss in #tech, in a thread')
    expect(text(html)).toContain('try batching them')
  })

  it('lists what someone else answers under Unread', () => {
    const unread = { ...item, id: 2, kind: 'general' as const, status: 'unread' as const, text: 'We ship on Friday.' }
    const html = renderToStaticMarkup(
      <InboxPanel
        inbox={{
          pending: [],
          unread: [unread],
          handled: [],
          error: null,
          nameOf: (id) => id,
          people,
          companyKey: 'TC',
        }}
      />,
    )

    expect(text(html)).toContain('Unread')
    expect(text(html)).toContain('We ship on Friday.')
    expect(text(html)).toContain('Nothing waiting.')
  })

  it('draws the sender: an Employee on their accent, the boss on the neutral tile', () => {
    const fromAda = { ...item, id: 3, fromId: ada.id }
    const html = renderToStaticMarkup(
      <InboxPanel
        inbox={{
          pending: [fromAda, item],
          unread: [],
          handled: [],
          error: null,
          nameOf: (id) => id,
          people,
          companyKey: 'TC',
        }}
      />,
    )

    expect(html).toContain(`data-accent="${accentFor(ada.id)}"`)
    expect(html.match(/data-ui="Avatar"/g)).toHaveLength(2)
  })

  // T79: an item from the boss draws the character they chose, not only their initials.
  it("draws the boss's own character once they have picked one", () => {
    const html = renderToStaticMarkup(
      <InboxPanel
        inbox={{
          pending: [item],
          unread: [],
          handled: [],
          error: null,
          nameOf: () => 'Yuri Miguel',
          companyKey: 'TC',
          people: { ...people, bossInitials: 'YM', bossSprite: 5 },
        }}
      />,
    )

    expect(html).toContain('data-sprite="5"')
    expect(html).toContain('<span data-slot="avatar-initials">YM</span>')
  })
})
