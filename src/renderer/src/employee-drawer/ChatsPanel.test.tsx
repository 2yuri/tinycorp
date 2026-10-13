import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { EmployeeConversation } from '../../../shared/employee-chats'
import type { InboxItem } from '../../../shared/inbox'
import type { ChatsState } from './ChatsPanel'

vi.hoisted(() => {
  Object.assign(globalThis, { window: { tinyCorp: { chat: {}, staff: {}, inbox: {} } } })
})
const { ChatsPanel } = await import('./ChatsPanel')

const person = (id: string, name: string, title: string) =>
  ({ id, name, title, sprite: 1, capabilities: [] }) as unknown as Employee
const nova = person('nova', 'Nova', 'Tech Lead')
const vega = person('vega', 'Vega', 'Frontend')
const employees = [nova, vega]

const withVega = dmChannelId(nova.id, vega.id)
const withBoss = dmChannelId(BOSS, nova.id)

function conversation(fields: Partial<EmployeeConversation> = {}): EmployeeConversation {
  return {
    channelId: withVega,
    kind: 'dm',
    name: '',
    members: [nova.id, vega.id],
    counterpartId: vega.id,
    last: { id: 9, authorId: vega.id, text: 'Pushing the locale guard now.', createdAt: '2026-09-17T09:47:00' },
    unread: 2,
    postable: false,
    ...fields,
  }
}

const bossDm = conversation({
  channelId: withBoss,
  members: [BOSS, nova.id],
  counterpartId: BOSS,
  last: { id: 4, authorId: BOSS, text: 'Nice work.', createdAt: '2026-09-17T09:12:00' },
  unread: 0,
  postable: true,
})

function message(id: number, authorId: string, text: string, at: string): Message {
  return {
    id,
    kind: 'post',
    channelId: withVega,
    threadId: null,
    authorId,
    text,
    mentions: [],
    mentionsChannel: false,
    replyCount: 0,
    createdAt: `2026-09-17T${at}:00`,
  }
}

const wake: InboxItem = {
  id: 7,
  employeeId: nova.id,
  kind: 'dm',
  fromId: BOSS,
  channelId: withBoss,
  threadId: null,
  messageId: 4,
  ticketId: null,
  text: 'Nice work.',
  prompt: '[company] DM from boss',
  status: 'pending',
  attempts: 0,
  createdAt: '2026-09-17T09:12:00.000Z',
  handledAt: null,
}

const inbox = {
  pending: [wake],
  unread: [],
  handled: [],
  error: null,
  nameOf: (id: string) => id,
  people: { employees },
  companyKey: 'TC',
}

function state(fields: Partial<ChatsState> = {}): ChatsState {
  const conversations = fields.conversations ?? [conversation(), bossDm]
  return {
    conversations,
    selected: conversations[0] ?? null,
    messages: [],
    employees,
    people: { employees },
    error: null,
    select: () => {},
    post: () => {},
    ...fields,
  }
}

const noWakes = { ...inbox, pending: [] }

const render = (fields: Partial<ChatsState> = {}, wakes = inbox) =>
  renderToStaticMarkup(<ChatsPanel chats={state(fields)} employee={nova} inbox={wakes} />)

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('the drawer’s Chats tab', () => {
  it('lists every conversation with its counterpart, role, last message and time', () => {
    const body = text(render())

    expect(body).toContain('Conversations')
    expect(body).toContain('Vega FRONTEND')
    expect(body).toContain('Pushing the locale guard now.')
    expect(body).toContain('09:47')
    expect(body).toContain('You BOSS')
    expect(body).toContain('Nice work.')
  })

  it('gives every row the frame’s shape: avatar, name, role, one-line preview, time', () => {
    const html = render()
    const row = html.slice(html.indexOf('<button'), html.indexOf('</button>'))

    // The counterpart's character, then the text column: head line over the last message.
    expect(row.indexOf('drawer-conv__avatar')).toBeLessThan(row.indexOf('drawer-conv__text'))
    expect(row.indexOf('drawer-conv__who')).toBeLessThan(row.indexOf('drawer-conv__role'))
    expect(row.indexOf('drawer-conv__spacer')).toBeLessThan(row.indexOf('drawer-conv__time'))
    expect(row.indexOf('drawer-conv__head')).toBeLessThan(row.indexOf('drawer-conv__last'))
    // VE is the avatar's fallback where a test has no character sheet to draw from.
    expect(text(row)).toBe('VE Vega FRONTEND 09:47 Pushing the locale guard now.')
  })

  it('draws a channel’s hash tile where a DM draws the counterpart, and names the author', () => {
    const epic = conversation({
      channelId: 'ep-usage-invoices',
      kind: 'channel',
      name: 'ep-usage-invoices',
      counterpartId: null,
      unread: 0,
    })
    const html = render({ conversations: [epic] })

    expect(html).toContain('drawer-conv__hash')
    expect(html).not.toContain('drawer-conv__avatar')
    expect(text(html)).toContain('#ep-usage-invoices')
    expect(text(html)).toContain('Vega: Pushing the locale guard now.')
  })

  it('draws the unread dot only where the boss has messages left to read', () => {
    const html = render()

    expect(html.match(/drawer-conv__dot/g)).toHaveLength(1)
    expect(html).toContain('drawer-conv--unread')
  })

  it('fills only the open row, and tells assistive tech which one it is', () => {
    const html = render()
    const rows = html.split('<button').slice(1)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('drawer-conv--open')
    expect(rows[0]).toContain('aria-current="true"')
    expect(rows[1]).not.toContain('drawer-conv--open')
  })

  it('moves the fill to whichever conversation is being read along', () => {
    const open = render({ selected: bossDm }).split('<button').slice(1)

    expect(open[0]).not.toContain('drawer-conv--open')
    expect(open[1]).toContain('drawer-conv--open')
  })

  it('marks the selected conversation, and reads its messages along', () => {
    const html = render({
      messages: [
        message(8, nova.id, 'Can you hold the switcher?', '09:41'),
        message(9, vega.id, 'Pushing the locale guard now.', '09:47'),
      ],
    })

    expect(html).toContain('drawer-conv--open')
    expect(text(html)).toContain('Nova and Vega')
    expect(text(html)).toContain('Can you hold the switcher?')
    expect(text(html)).toContain('Nova TECH LEAD 09:41')
  })

  it('keeps a DM the boss is not in read-only, with the way to join it', () => {
    const html = render()

    expect(text(html)).toContain('You can read along')
    expect(text(html)).toContain('Their conversation. DM Nova to join in.')
    expect(html).not.toContain('drawer-post')
  })

  it('pins the read-only bar under the thread, past the spacer that pushes it down', () => {
    const html = render({ messages: [message(8, nova.id, 'Can you hold the switcher?', '09:41')] })
    const pane = html.slice(html.indexOf('drawer-read-along'))

    expect(pane.indexOf('drawer-read-along__messages')).toBeLessThan(pane.indexOf('drawer-chats__push'))
    expect(pane.indexOf('drawer-chats__push')).toBeLessThan(pane.indexOf('drawer-read-only'))
    // It is the last thing the pane draws: nothing of the tab follows it.
    expect(pane.indexOf('drawer-read-only')).toBeGreaterThan(pane.lastIndexOf('drawer-msg__text'))
  })

  it('gives the boss a composer in their own DM', () => {
    const html = render({ conversations: [bossDm, conversation()] })

    expect(html).toContain('drawer-post')
    expect(html).toContain('Message Nova and you…')
    expect(text(html)).not.toContain('Their conversation.')
  })

  it('files the wake list under a Wakes disclosure, so nothing is lost', () => {
    const html = render()

    // The hook leads the class list, with the disclosure's utilities behind it (T210e).
    expect(html).toContain('<details class="drawer-wakes ')
    expect(text(html)).toContain('Wakes')
    expect(text(html)).toContain('Pending')
    expect(html).toContain('drawer-wakes__count')
  })

  it('leaves the Wakes disclosure out while the Employee has none, as the frame draws it', () => {
    expect(render({}, noWakes)).not.toContain('drawer-wakes')
  })

  it('puts the Wakes disclosure above the read-along, so the read-only bar keeps the foot', () => {
    const html = render()

    expect(html.indexOf('drawer-wakes')).toBeLessThan(html.indexOf('drawer-read-along'))
    expect(html.indexOf('drawer-read-along')).toBeLessThan(html.indexOf('drawer-read-only'))
  })

  it('says so when the Employee has talked to nobody', () => {
    const html = render({ conversations: [], selected: null })

    expect(text(html)).toContain('Nova has not talked to anyone.')
    expect(html).not.toContain('drawer-read-along')
  })

  it('reports an error from the engine', () => {
    expect(text(render({ error: 'No Company is open' }))).toContain('No Company is open')
  })
})
