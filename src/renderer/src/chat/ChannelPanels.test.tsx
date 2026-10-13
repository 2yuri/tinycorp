import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PinnedMessage } from '../../../shared/channel-extras'
import { BOSS, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { AboutPanel, PinnedPanel, SearchPanel } from './ChannelPanels'
import type { ChatData } from './chat-view'

const ada = { id: 'e-ada', name: 'Ada Byron', title: 'PM', capabilities: [] } as unknown as Employee
const bo = { id: 'e-bo', name: 'Bo Chen', title: 'Tech lead', capabilities: [] } as unknown as Employee
const noop = () => {}

/** The attributes of each member checkbox, in the order the panel draws them. */
function boxes(html: string): string[] {
  return [...html.matchAll(/data-slot="choice-input"[^>]*?class="[^"]*"([^>/]*)/g)].map((m) => m[1]!.trim())
}

const data: ChatData = {
  employees: [ada, bo],
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

function pin(overrides: Partial<PinnedMessage> = {}): PinnedMessage {
  return { ...message(), pinnedBy: BOSS, pinnedAt: '2026-09-17T09:13:00', ...overrides }
}

describe('The pinned messages panel', () => {
  it('lists every pin with its author, and offers to unpin each one', () => {
    const html = renderToStaticMarkup(
      <PinnedPanel
        pins={[pin(), pin({ id: 2, authorId: bo.id, text: 'the plan' })]}
        data={data}
        onJump={noop}
        onUnpin={noop}
        onClose={noop}
      />,
    )

    expect(html).toContain('2 pinned messages')
    expect(html).toContain('we always use named migrations')
    expect(html).toContain('Ada Byron')
    expect(html).toContain('Unpin Ada Byron’s message')
    expect(html).toContain('Unpin Bo Chen’s message')
  })

  it('says what pinning is for when nothing is pinned', () => {
    const html = renderToStaticMarkup(<PinnedPanel pins={[]} data={data} onJump={noop} onUnpin={noop} onClose={noop} />)

    expect(html).toContain('No pinned messages')
    expect(html).toContain('Nothing pinned yet')
  })

  it('says which pins are replies, so a jump into a thread is no surprise', () => {
    const html = renderToStaticMarkup(
      <PinnedPanel pins={[pin({ threadId: 9 })]} data={data} onJump={noop} onUnpin={noop} onClose={noop} />,
    )

    expect(html).toContain('in a thread')
  })
})

describe('The in-channel search panel', () => {
  it('counts what it found and highlights the match in each line', () => {
    const html = renderToStaticMarkup(
      <SearchPanel
        text="migration"
        results={[message(), message({ id: 2, text: 'no migration yet' })]}
        data={data}
        onText={noop}
        onJump={noop}
        onClose={noop}
      />,
    )

    expect(html).toContain('2 messages match “migration”')
    expect(html).toMatch(/<mark[^>]*>migration<\/mark>/)
  })

  it('asks for something to look for before it has one', () => {
    const html = renderToStaticMarkup(
      <SearchPanel text="" results={[]} data={data} onText={noop} onJump={noop} onClose={noop} />,
    )

    expect(html).toContain('Search this channel')
    expect(html).toContain('placeholder="Search this channel…"')
  })
})

describe('The About this channel panel', () => {
  it('shows the topic to edit and every Employee, all in when the list is empty', () => {
    const html = renderToStaticMarkup(
      <AboutPanel
        title="# tech"
        topic="How we build it."
        memberIds={[]}
        employees={[ada, bo]}
        onTopic={noop}
        onMembers={noop}
        onClose={noop}
      />,
    )

    expect(html).toContain('About # tech')
    expect(html).toContain('How we build it.')
    expect(html).toContain('Everyone in the Company')
    expect(html).toContain('Ada Byron · PM')
    expect(html).toContain('Bo Chen · Tech lead')
    // Everyone is on, so the per-Employee boxes are checked and cannot be changed one at a time.
    expect(boxes(html)).toEqual(['checked=""', 'disabled="" checked=""', 'disabled="" checked=""'])
  })

  it('checks only the members a narrowed channel has', () => {
    const html = renderToStaticMarkup(
      <AboutPanel
        title="# tech"
        topic=""
        memberIds={[bo.id]}
        employees={[ada, bo]}
        onTopic={noop}
        onMembers={noop}
        onClose={noop}
      />,
    )

    expect(boxes(html)).toEqual(['', '', 'checked=""'])
  })

  it('says so when nobody works here yet', () => {
    const html = renderToStaticMarkup(
      <AboutPanel
        title="# tech"
        topic=""
        memberIds={[]}
        employees={[]}
        onTopic={noop}
        onMembers={noop}
        onClose={noop}
      />,
    )

    expect(html).toContain('Nobody works here yet.')
  })
})
