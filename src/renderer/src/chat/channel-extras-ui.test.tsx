import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { ChatData } from './chat-view'

let MessageList: typeof import('./Messages').MessageList

beforeAll(async () => {
  // The chat modules read the preload API when they load; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { approvals: {} } }
  ;({ MessageList } = await import('./Messages'))
})

const ada = { id: 'e-ada', name: 'Ada Byron', title: 'PM', capabilities: [] } as unknown as Employee
const noop = () => {}

const data: ChatData = {
  employees: [ada],
  board: null,
  code: [],
  repos: [],
  approvals: new Map(),
  reviews: [],
  bossName: 'Yuri',
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    kind: 'post',
    channelId: 'tech',
    threadId: null,
    authorId: ada.id,
    text: 'we always use named migrations',
    mentions: [],
    mentionsChannel: false,
    replyCount: 0,
    createdAt: '2026-09-17T09:12:00',
    ...overrides,
  }
}

function list(props: Partial<Parameters<typeof MessageList>[0]> = {}) {
  return renderToStaticMarkup(
    <MessageList
      messages={[message()]}
      data={data}
      people={[{ id: ada.id, name: ada.name }]}
      refs={{ tickets: [], channelIds: ['tech'], companyKey: 'TC', onChannel: noop }}
      activeThread={null}
      onOpenThread={noop}
      {...props}
    />,
  )
}

describe('A message in the list (T44)', () => {
  it('offers to pin it when the boss may, and says which are pinned', () => {
    const html = list({ onPin: noop, pinnedIds: new Set([1]) })

    expect(html).toContain('Unpin Ada Byron’s message')
    expect(html).toContain('>Pinned</span>')
  })

  it('offers to pin one that is not pinned', () => {
    const html = list({ onPin: noop, pinnedIds: new Set<number>() })

    expect(html).toContain('Pin Ada Byron’s message')
    expect(html).not.toContain('>Pinned</span>')
  })

  it('leaves the row as it was where nothing can pin', () => {
    expect(list()).not.toContain('’s message')
  })

  it('marks the message a pin or a search result jumped to', () => {
    // The mark is the inset rule down the row's left edge; nothing else in the list draws one.
    expect(list({ focusId: 1 })).toContain('shadow-[inset_2px_0_0_var(--color-warning-foreground)]')
    expect(list({ focusId: 99 })).not.toContain('shadow-[inset_2px_0_0_var(--color-warning-foreground)]')
  })
})
