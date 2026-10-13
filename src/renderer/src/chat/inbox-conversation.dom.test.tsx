// @vitest-environment jsdom
// The Inbox's right-hand panel shows the conversation a row lives in, not the one message it is
// (T251). Before this, every row opened `COALESCE(thread_id, id)`, so a DM showed one line.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, type Channel, dmChannelId, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const never = () => () => {}

const vega = { id: 'e-vega', name: 'Vega', title: 'Backend', sprite: 1, capabilities: ['code'] } as Employee
const nova = { id: 'e-nova', name: 'Nova', title: 'Tech Lead', sprite: 2, capabilities: ['plan'] } as Employee
const DM = dmChannelId(BOSS, vega.id)
const DAY = '2026-09-17'

function message(id: number, channelId: string, authorId: string, text: string, threadId: number | null = null) {
  return {
    id,
    kind: 'post',
    channelId,
    threadId,
    authorId,
    text,
    mentions: [],
    mentionsChannel: false,
    replyCount: 0,
    createdAt: `${DAY}T09:0${id}:00`,
  } as Message
}

/** The DM: two the boss has read, two they have not. The read mark is on the second. */
const dmHistory = [
  message(1, DM, BOSS, 'Can you take the invoice export next?'),
  message(2, DM, vega.id, 'On it — after the pagination PR lands.'),
  message(3, DM, vega.id, 'Pagination landed. Starting the export now.'),
  message(4, DM, vega.id, 'Are refunds in scope this week, or only invoices?'),
]

/** A mention in `#general` that nobody has answered, and a thread in it that somebody has. */
const general = [
  message(5, 'general', nova.id, '@boss can you confirm the three plan tiers?'),
  message(6, 'general', nova.id, 'Contract matches the web-app ticket.'),
]
const generalThread = [general[1]!, message(7, 'general', vega.id, 'Safe to merge before it lands.', 6)]

const channels: Channel[] = [
  { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
  { id: DM, kind: 'dm', name: '', members: [BOSS, vega.id], topic: '' },
]

function row(fields: Partial<BossInboxItem> & Pick<BossInboxItem, 'kind' | 'channelId' | 'messageId'>): BossInboxItem {
  return {
    id: `m${fields.messageId}`,
    threadId: fields.messageId,
    fromId: vega.id,
    text: '',
    createdAt: `${DAY}T09:00:00`,
    unread: true,
    approvalId: null,
    planId: null,
    testRunId: null,
    ...fields,
  }
}

const items: BossInboxItem[] = [
  row({ kind: 'dm', channelId: DM, messageId: 4, text: 'Are refunds in scope this week, or only invoices?' }),
  row({
    kind: 'mention',
    channelId: 'general',
    messageId: 5,
    fromId: nova.id,
    text: 'can you confirm the plan tiers?',
  }),
  row({ kind: 'thread', channelId: 'general', messageId: 7, threadId: 6, text: 'Safe to merge before it lands.' }),
]

// One bridge for the file, because a screen takes its own corner of it at import time: a fresh
// `window.tinyCorp` per test would leave `Chat`'s `api` pointing at the first one's stubs.
const markRead = vi.fn(() => ok(true))
const post = vi.fn(() => ok(dmHistory[0]))
const reply = vi.fn(() => ok(dmHistory[0]))
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  for (const mock of [markRead, post, reply]) mock.mockClear()
  // jsdom has no layout, so nothing to scroll into view.
  Element.prototype.scrollIntoView = () => {}
  window.tinyCorp = {
    chat: {
      channels: () => ok(channels),
      read: ({ channelId, threadId }: { channelId: string; threadId?: number }) =>
        ok(threadId !== undefined ? (threadId === 6 ? generalThread : []) : channelId === DM ? dmHistory : general),
      // The boss stopped reading at message 2, so 3 is the first under the New line.
      unread: () => ok({ counts: { [DM]: 2 }, readMarks: { [DM]: 2, general: 4 } }),
      bossInbox: () => ok(items),
      pins: () => ok([]),
      markRead,
      markAllRead: () => ok(true),
      post,
      reply,
      draft: () => ok(null),
      saveDraft: () => ok(null),
      clearDraft: () => ok(null),
      onChanged: never,
    },
    staff: { employees: () => ok([vega, nova]), roles: () => ok([]), onChanged: never },
    board: { snapshot: () => Promise.resolve(null), onChanged: never },
    code: { list: () => ok([]), details: () => ok([]), onChanged: never },
    repos: { list: () => ok([]), onChanged: never },
    reviews: { list: () => ok([]), threads: () => ok([]), securityPasses: () => ok([]), onChanged: never },
    planning: { list: () => ok([]), onChanged: never },
    tests: { list: () => ok([]), onChanged: never },
    approvals: { list: () => ok([]), level: () => ok('managed'), onChanged: never },
    answerer: { get: () => ok({ answererId: null, waitingForId: null }), onChanged: never },
    digest: { schedule: () => ok({ timezone: null }), onChanged: never },
    company: { current: () => Promise.resolve(null), onChanged: never },
    paths: { links: () => ok([]) },
  } as unknown as typeof window.tinyCorp
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Mounts the Inbox and clicks the row whose excerpt contains `excerpt`. */
async function openRow(excerpt: string): Promise<void> {
  const { Chat } = await import('./Chat')
  await act(async () => {
    root.render(<Chat companyId="c1" inbox />)
  })
  const button = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Inbox"] button')].find((one) =>
    one.textContent?.includes(excerpt),
  )
  if (!button) throw new Error(`no Inbox row saying ${excerpt}`)
  await act(async () => {
    button.click()
  })
}

const panel = () => host.querySelector<HTMLElement>('aside')

describe('the Inbox’s conversation panel', () => {
  it('shows the whole DM, with the New line at the mark the boss left and the row highlighted', async () => {
    await openRow('refunds')

    const aside = panel()!
    expect(aside.getAttribute('aria-label')).toBe('Vega')
    for (const one of dmHistory) expect(aside.textContent).toContain(one.text)
    // The row's own message is the one drawn on the muted fill, and it is the fourth of four.
    expect(aside.querySelector('[data-ui="Opened Message"]')?.textContent).toContain('refunds')
    // The New line is placed from the mark as it stood *before* the row was opened — opening one
    // marks its channel read, and a divider read off the fresh mark would never be drawn at all.
    const body = aside.textContent ?? ''
    expect(aside.querySelectorAll('[data-ui="New Divider"]')).toHaveLength(1)
    expect(body.indexOf('On it')).toBeLessThan(body.indexOf('New'))
    expect(body.indexOf('New')).toBeLessThan(body.indexOf('Pagination landed'))
  })

  it('posts into the DM rather than replying to the row’s message', async () => {
    await openRow('refunds')

    const box = panel()!.querySelector<HTMLTextAreaElement>('textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(box, 'only invoices')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(post).toHaveBeenCalledWith(DM, 'only invoices', [])
    expect(reply).not.toHaveBeenCalled()
  })

  it('shows the channel’s history for a mention nobody has answered', async () => {
    await openRow('plan tiers')

    expect(panel()?.getAttribute('aria-label')).toBe('#general')
    for (const one of general) expect(panel()?.textContent).toContain(one.text)
  })

  it('shows the thread, from its root, for a reply', async () => {
    await openRow('Safe to merge')

    expect(panel()?.getAttribute('aria-label')).toBe('Thread in #general')
    for (const one of generalThread) expect(panel()?.textContent).toContain(one.text)
  })

  // The regression: opening a row is still what reads its channel (decision 43).
  it('marks the row’s channel read', async () => {
    await openRow('refunds')

    expect(markRead).toHaveBeenCalledWith(DM)
  })
})
