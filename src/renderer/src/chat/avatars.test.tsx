import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { BOSS, COMPANY_AUTHOR, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { accentFor } from '../ui'
import type { ChatData } from './chat-view'

let MessageList: typeof import('./Messages').MessageList
let ReplyRow: typeof import('./Messages').ReplyRow
let ChannelMembers: typeof import('./ChannelHeader').ChannelMembers

beforeAll(async () => {
  // The chat modules read the preload API when they load; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { approvals: {} } }
  ;({ MessageList, ReplyRow } = await import('./Messages'))
  ;({ ChannelMembers } = await import('./ChannelHeader'))
})

const employee = (id: string, name: string, title: string, sprite: number) =>
  ({ id, name, title, sprite, capabilities: [] }) as unknown as Employee

const atlas = employee('e-atlas', 'Atlas', 'PM', 0)
const nova = employee('e-nova', 'Nova', 'Tech lead', 2)

const data: ChatData = {
  employees: [atlas, nova],
  board: null,
  code: [],
  repos: [],
  approvals: new Map(),
  reviews: [],
  bossName: 'Yuri Miguel',
  bossInitials: 'Y',
  bossSprite: 4,
}

function message(authorId: string, id = 1): Message {
  return {
    id,
    channelId: 'general',
    authorId,
    text: 'Claimed TC-142.',
    replyCount: 0,
    createdAt: '2026-03-04T09:14:00.000Z',
  } as Message
}

const refs = { tickets: [], channelIds: ['general'], companyKey: 'TC', onChannel: () => {} }
const noop = () => {}

function messages(...authorIds: string[]) {
  return renderToStaticMarkup(
    <MessageList
      messages={authorIds.map((id, i) => message(id, i + 1))}
      data={data}
      people={[]}
      refs={refs}
      activeThread={null}
      onOpenThread={noop}
    />,
  )
}

describe('chat messages', () => {
  it('give every Employee their character tile and their accent', () => {
    const html = messages(atlas.id, nova.id)

    expect(html).toContain(`data-accent="${accentFor(atlas.id)}"`)
    expect(html).toContain(`data-accent="${accentFor(nova.id)}"`)
    expect(html.match(/data-ui="Avatar"/g)).toHaveLength(2)
  })

  it('tint the role tag with the same accent and leave the name alone', () => {
    const html = messages(atlas.id)

    expect(html).toMatch(new RegExp(`<span[^>]*data-accent="${accentFor(atlas.id)}"[^>]*>PM</span>`))
    expect(html).toMatch(/<strong[^>]*>Atlas<\/strong>/)
  })

  it('leave the boss and the Company on the neutral tile, with no accent on the tag', () => {
    const html = messages(BOSS, COMPANY_AUTHOR)

    expect(html).toContain('data-tone="neutral"')
    expect(html).toContain('>Y<')
    expect(html).toContain('>TC<')
    expect(html).toMatch(/<span(?![^>]*data-accent=)[^>]*>BOSS<\/span>/)
    expect(html).toMatch(/<span(?![^>]*data-accent=)[^>]*>SYSTEM<\/span>/)
  })

  // T79: the boss picks a character in Your profile, and it draws wherever they appear.
  it('draw the boss as the character they picked, initials standing in until it decodes', () => {
    const html = messages(BOSS)

    expect(html).toContain('data-sprite="4"')
    expect(html).toContain('data-tone="neutral"')
    expect(html).toContain('>Y<')
  })

  it('no longer draw the flat initials tile of the old avatar path', () => {
    expect(messages(atlas.id)).not.toContain('chat-avatar')
  })
})

describe('a thread reply', () => {
  it('draws the same Employee with the same accent, one size down', () => {
    const html = renderToStaticMarkup(<ReplyRow message={message(nova.id)} data={data} people={[]} refs={refs} />)

    expect(html).toContain(`data-accent="${accentFor(nova.id)}"`)
    expect(html).toContain('--ui-avatar-size:26px')
    expect(html).toMatch(new RegExp(`<span[^>]*data-accent="${accentFor(nova.id)}"[^>]*>TECH LEAD</span>`))
  })
})

describe('the channel member stack', () => {
  const stack = (memberIds: string[]) =>
    renderToStaticMarkup(
      <ChannelMembers
        memberIds={memberIds}
        employees={data.employees}
        nameOf={(id) => data.employees.find((e) => e.id === id)?.name ?? id}
        bossName={data.bossName}
        bossInitials={data.bossInitials}
        bossSprite={data.bossSprite}
      />,
    )

  it('shows the boss, then every member on their own accent', () => {
    const html = stack([BOSS, atlas.id, nova.id])

    expect(html).toContain(`data-accent="${accentFor(atlas.id)}"`)
    expect(html).toContain(`data-accent="${accentFor(nova.id)}"`)
    expect(html.match(/data-ui="Avatar"/g)).toHaveLength(3)
    expect(html).toContain('--ui-avatar-size:30px')
    expect(html).toContain('>Y<')
    expect(html).toContain('data-sprite="4"')
  })

  it('folds the rest into +N', () => {
    const html = stack([BOSS, atlas.id, nova.id, 'e-c', 'e-d', 'e-e'])

    expect(html.match(/data-ui="Avatar"/g)).toHaveLength(5)
    expect(html).toContain('>+2<')
  })
})
