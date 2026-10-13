import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'

let Chat: typeof import('./Chat').Chat

const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

beforeAll(async () => {
  // The chat modules read the preload API when they load; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = {
    tinyCorp: {
      chat: {
        channels: () => ok([]),
        read: () => ok([]),
        bossInbox: () => ok([]),
        markRead: () => ok(true),
        onChanged: never,
      },
      staff: { employees: () => ok([]), onChanged: never },
      board: { snapshot: () => Promise.resolve(null), onChanged: never },
      code: { list: () => ok([]), onChanged: never },
      repos: { list: () => ok([]) },
      reviews: { list: () => ok([]), onChanged: never },
      planning: { list: () => ok([]), onChanged: never },
      tests: { list: () => ok([]), onChanged: never },
      approvals: { list: () => ok([]), onChanged: never },
      answerer: { get: () => ok({ answererId: null, waitingForId: null }), onChanged: never },
      company: { current: () => Promise.resolve(null), onChanged: never },
      digest: { schedule: () => ok(null), onChanged: never },
    },
  }
  ;({ Chat } = await import('./Chat'))
})

const chat = (channelId: string) => renderToStaticMarkup(<Chat companyId="c1" channelId={channelId} />)

describe('a conversation the boss is not in', () => {
  it('is read-only: the note in place of the composer (T77)', () => {
    const html = chat(dmChannelId('e-nova', 'e-vega'))

    expect(html).toContain('Their conversation.')
    expect(html).toContain('to join in.')
    expect(html).not.toContain('<textarea')
  })

  it('leaves the boss’s own DM alone, with its composer', () => {
    const html = chat(dmChannelId(BOSS, 'e-nova'))

    expect(html).toContain('<textarea')
    expect(html).not.toContain('to join in.')
  })
})
