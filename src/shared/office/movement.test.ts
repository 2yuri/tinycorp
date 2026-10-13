import { describe, expect, it } from 'vitest'
import { BOSS, CHANNEL_MENTION, dmChannelId } from '../domain/chat'
import { type ChatPost, EXCHANGE_MS, MIN_TRIP_MS, officeTrips, POST_MEMORY_MS, TAIL_MS, TRIP_GAP_MS } from './movement'

const NOW = Date.parse('2026-09-17T12:00:00.000Z')
const ADA = 'id-Ada'
const BOB = 'id-Bob'
const CY = 'id-Cy'
const TEAM = new Set([ADA, BOB, CY])

const post = (at: number, channelId: string, extra: Partial<ChatPost> = {}): ChatPost => ({
  at,
  channelId,
  threadId: null,
  mentions: [],
  ...extra,
})

const trips = (posts: Record<string, ChatPost[]>, now = NOW) => officeTrips(posts, TEAM, now)

describe('a channel exchange', () => {
  it('keeps an Employee posting alone at their desk, however recent the post', () => {
    expect(trips({ [ADA]: [post(NOW, 'tech')] }).size).toBe(0)
    expect(trips({ [ADA]: [post(NOW - 1000, 'tech'), post(NOW, 'tech')] }).size).toBe(0)
  })

  it('sits two Employees of one exchange together in the meeting room', () => {
    const map = trips({ [ADA]: [post(NOW - 5_000, 'tech')], [BOB]: [post(NOW - 1_000, 'tech')] })

    expect(map.get(ADA)).toMatchObject({ place: 'meeting', withIds: [BOB] })
    expect(map.get(BOB)).toMatchObject({ place: 'meeting', withIds: [ADA] })
  })

  it('starts the meeting at the post that made it a conversation, not at the first post', () => {
    const map = trips({ [ADA]: [post(NOW - 5_000, 'tech')], [BOB]: [post(NOW - 1_000, 'tech')] })

    expect(map.get(ADA)!.startedAt).toBe(NOW - 1_000)
    expect(map.get(BOB)!.startedAt).toBe(NOW - 1_000)
  })

  it('names everyone in the room when a third joins', () => {
    const map = trips({
      [ADA]: [post(NOW - 9_000, 'tech')],
      [BOB]: [post(NOW - 6_000, 'tech')],
      [CY]: [post(NOW - 3_000, 'tech')],
    })

    expect(map.get(CY)).toMatchObject({ place: 'meeting', withIds: [ADA, BOB] })
    expect(map.get(ADA)!.withIds).toEqual([BOB, CY])
  })

  it('keeps them there while the exchange is live, plus a tail, then walks them back', () => {
    const posts = { [ADA]: [post(NOW, 'tech')], [BOB]: [post(NOW, 'tech')] }
    const ends = NOW + EXCHANGE_MS + TAIL_MS

    expect(trips(posts, ends - 1).get(ADA)).toMatchObject({ place: 'meeting', endsAt: ends })
    expect(trips(posts, ends).size).toBe(0)
  })

  it('ends the meeting when the exchange does, and starts a new one when they speak again', () => {
    const quiet = NOW + EXCHANGE_MS + 1
    const map = trips(
      {
        [ADA]: [post(NOW, 'tech'), post(quiet, 'tech')],
        [BOB]: [post(NOW, 'tech'), post(quiet + 1_000, 'tech')],
      },
      quiet + 2_000,
    )

    expect(map.get(ADA)).toMatchObject({ startedAt: quiet + 1_000, endsAt: quiet + 1_000 + EXCHANGE_MS + TAIL_MS })
  })

  it('keeps two threads of one channel apart', () => {
    const map = trips({
      [ADA]: [post(NOW - 2_000, 'tech', { threadId: 1 })],
      [BOB]: [post(NOW - 1_000, 'tech', { threadId: 2 })],
    })

    expect(map.size).toBe(0)
  })

  it('meets over a thread the same way it meets over a channel', () => {
    const map = trips({
      [ADA]: [post(NOW - 2_000, 'tech', { threadId: 7 })],
      [BOB]: [post(NOW - 1_000, 'tech', { threadId: 7 })],
    })

    expect(map.get(ADA)).toMatchObject({ place: 'meeting', withIds: [BOB] })
  })

  it('forgets posts older than the office remembers', () => {
    const old = NOW - POST_MEMORY_MS
    expect(trips({ [ADA]: [post(old, 'tech')], [BOB]: [post(old, 'tech')] }).size).toBe(0)
  })

  it('ignores posts from someone who is no longer an Employee', () => {
    const posts = { [ADA]: [post(NOW, 'tech')], gone: [post(NOW, 'tech')] }

    expect(officeTrips(posts, TEAM, NOW).size).toBe(0)
  })
})

describe('visiting a colleague and the boss', () => {
  it('sends whoever opened a DM to the other desk, and leaves the other one sitting', () => {
    const dm = dmChannelId(ADA, BOB)
    const map = trips({ [ADA]: [post(NOW - 2_000, dm)], [BOB]: [post(NOW - 1_000, dm)] })

    expect(map.get(ADA)).toMatchObject({ place: 'desk', withIds: [BOB] })
    expect(map.has(BOB)).toBe(false)
  })

  it('makes the visit last the exchange, not a flat few seconds', () => {
    const dm = dmChannelId(ADA, BOB)
    const late = NOW + 60_000
    const map = trips({ [ADA]: [post(NOW, dm)], [BOB]: [post(late, dm)] }, late + 1_000)

    expect(map.get(ADA)!.endsAt).toBe(late + EXCHANGE_MS + TAIL_MS)
  })

  it('sends an `@Name` in a channel to that desk even though nobody answered', () => {
    const map = trips({ [ADA]: [post(NOW, 'tech', { mentions: [BOB] })] })

    expect(map.get(ADA)).toMatchObject({ place: 'desk', withIds: [BOB] })
  })

  it('ignores `@channel` and an Employee mentioning themselves', () => {
    const map = trips({ [ADA]: [post(NOW, 'tech', { mentions: [CHANNEL_MENTION, ADA] })] })

    expect(map.size).toBe(0)
  })

  it('sends a DM to the boss and an `@boss` to the boss desk', () => {
    const dm = trips({ [ADA]: [post(NOW, dmChannelId(ADA, BOSS))] })
    const mention = trips({ [BOB]: [post(NOW, 'tech', { mentions: [BOSS] })] })

    expect(dm.get(ADA)).toMatchObject({ place: 'boss', withIds: [] })
    expect(mention.get(BOB)).toMatchObject({ place: 'boss' })
  })

  it('lets a conversation in a channel win over the mention inside it', () => {
    const map = trips({
      [ADA]: [post(NOW - 2_000, 'tech', { mentions: [BOB] })],
      [BOB]: [post(NOW - 1_000, 'tech')],
    })

    expect(map.get(ADA)!.place).toBe('meeting')
  })
})

describe('cadence', () => {
  it('never makes a trip shorter than the minimum', () => {
    const posts = { [ADA]: [post(NOW, 'tech', { mentions: [BOB] })] }
    // Even with the exchange long dead, the walk is worth watching.
    const short = officeTrips(posts, TEAM, NOW)

    expect(short.get(ADA)!.endsAt - short.get(ADA)!.startedAt).toBeGreaterThanOrEqual(MIN_TRIP_MS)
  })

  it('lets an Employee start only one trip a minute', () => {
    const soon = NOW + TRIP_GAP_MS - 1_000
    const map = trips(
      {
        [ADA]: [post(NOW, dmChannelId(ADA, BOB)), post(soon, 'tech', { mentions: [CY] })],
      },
      soon + 1_000,
    )

    expect(map.get(ADA)).toMatchObject({ place: 'desk', withIds: [BOB], startedAt: NOW })
  })

  it('allows the next trip once a minute has passed', () => {
    const later = NOW + TRIP_GAP_MS
    const map = trips(
      {
        [ADA]: [post(NOW, dmChannelId(ADA, BOB)), post(later, 'tech', { mentions: [CY] })],
      },
      later + 1_000,
    )

    expect(map.get(ADA)).toMatchObject({ place: 'desk', withIds: [CY], startedAt: later })
  })

  it('has no trip before its post', () => {
    expect(trips({ [ADA]: [post(NOW + 1_000, 'tech', { mentions: [BOB] })] }).size).toBe(0)
  })
})
