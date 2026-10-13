import { describe, expect, it } from 'vitest'
import {
  type DailyDigest,
  DEFAULT_DIGEST_SCHEDULE,
  type DigestSchedule,
  daysLabel,
  daysPreset,
  digestDay,
  digestFooter,
  digestSummary,
  digestTitle,
  dueRun,
  isQuietDigest,
  lastRunAt,
  MISSED_RUN_GRACE_MS,
  nextRunAt,
  QUIET_DAY,
  requireSchedule,
  sinceLabel,
} from './daily-digest'

const LISBON = 'Europe/Lisbon'
const TOKYO = 'Asia/Tokyo'

function schedule(overrides: Partial<DigestSchedule> = {}): DigestSchedule {
  return { ...DEFAULT_DIGEST_SCHEDULE, timezone: LISBON, ...overrides }
}

function digest(overrides: Partial<DailyDigest> = {}): DailyDigest {
  return {
    day: '2026-09-22',
    since: '2026-09-21T17:00:00.000Z',
    until: '2026-09-22T17:00:00.000Z',
    shipped: [],
    inReview: [],
    blocked: [],
    waiting: [],
    usage: [],
    tomorrow: [],
    footer: '',
    ...overrides,
  }
}

describe('when a digest is owed', () => {
  it('is the day’s scheduled time, read on a clock in the Company’s own zone', () => {
    // 18:00 in Lisbon is 17:00 UTC in September; 18:00 in Tokyo is 09:00 UTC.
    const at = lastRunAt(schedule(), new Date('2026-09-22T20:00:00Z'))
    const tokyo = lastRunAt(schedule({ timezone: TOKYO }), new Date('2026-09-22T20:00:00Z'))

    expect(at?.toISOString()).toBe('2026-09-22T17:00:00.000Z')
    expect(tokyo?.toISOString()).toBe('2026-09-22T09:00:00.000Z')
  })

  it('skips the days the schedule does not name', () => {
    // Sunday 2026-09-20, weekdays only: the latest run is Friday the 18th.
    const at = lastRunAt(schedule(), new Date('2026-09-20T20:00:00Z'))

    expect(at?.toISOString()).toBe('2026-09-18T17:00:00.000Z')
    expect(nextRunAt(schedule(), new Date('2026-09-20T20:00:00Z'))?.toISOString()).toBe('2026-09-21T17:00:00.000Z')
  })

  it('names no run at all while it is off, or while it names no day', () => {
    const now = new Date('2026-09-22T20:00:00Z')

    expect(lastRunAt(schedule({ enabled: false }), now)).toBeNull()
    expect(lastRunAt(schedule({ days: [] }), now)).toBeNull()
    expect(nextRunAt(schedule({ enabled: false }), now)).toBeNull()
  })

  it('crosses a daylight-saving change without moving the clock time', () => {
    // Lisbon leaves summer time on 2026-10-25: 18:00 is 17:00 UTC before it and 18:00 UTC after.
    const before = lastRunAt(schedule(), new Date('2026-10-23T20:00:00Z'))
    const after = lastRunAt(schedule(), new Date('2026-10-26T20:00:00Z'))

    expect(before?.toISOString()).toBe('2026-10-23T17:00:00.000Z')
    expect(after?.toISOString()).toBe('2026-10-26T18:00:00.000Z')
  })
})

describe('a run the app was closed for', () => {
  const at = '2026-09-22T17:00:00.000Z'

  it('still posts when the Company opens inside the grace window', () => {
    const now = new Date(Date.parse(at) + MISSED_RUN_GRACE_MS - 60_000)

    expect(dueRun(schedule(), now, new Set())).toEqual({ at: new Date(at), day: '2026-09-22' })
  })

  it('is skipped once it is more than 12 hours late', () => {
    const now = new Date(Date.parse(at) + MISSED_RUN_GRACE_MS + 60_000)

    expect(dueRun(schedule(), now, new Set())).toBeNull()
  })

  it('never posts twice for the same day', () => {
    const now = new Date('2026-09-22T19:00:00Z')

    expect(dueRun(schedule(), now, new Set(['2026-09-22']))).toBeNull()
  })

  it('files the day on a clock in the Company’s zone, not in UTC', () => {
    // 22:00 in Tokyo on the 22nd is still 13:00 UTC on the 22nd; 09:00 Tokyo on the 23rd is not.
    expect(digestDay(new Date('2026-09-22T22:00:00Z'), { timezone: TOKYO })).toBe('2026-09-23')
    expect(digestDay(new Date('2026-09-22T22:00:00Z'), { timezone: LISBON })).toBe('2026-09-22')
  })
})

describe('the schedule Company settings writes', () => {
  it('sorts the days, drops duplicates and strips the channel’s hash', () => {
    const next = requireSchedule({ days: [5, 1, 1, 3], channelId: '#tech' }, schedule())

    expect(next.days).toEqual([1, 3, 5])
    expect(next.channelId).toBe('tech')
  })

  it('refuses a time that is not a clock time, a day outside the week and an empty channel', () => {
    expect(() => requireSchedule({ time: '6pm' }, schedule())).toThrow(/clock time/)
    expect(() => requireSchedule({ time: '24:00' }, schedule())).toThrow(/clock time/)
    expect(() => requireSchedule({ days: [7] }, schedule())).toThrow(/Sunday/)
    expect(() => requireSchedule({ channelId: '  ' }, schedule())).toThrow(/needs a channel/)
  })

  it('leaves what it was not asked to change', () => {
    expect(requireSchedule({ enabled: false }, schedule()).time).toBe('18:00')
  })
})

describe('the words the card and the banner use', () => {
  it('titles the digest with the day it covers, in the Company’s zone', () => {
    expect(digestTitle('2026-09-22T17:00:00.000Z', LISBON)).toBe('Daily digest · Tue 22 Sep · 18:00')
  })

  it('says how far back it reaches', () => {
    expect(sinceLabel({ since: '2026-09-21T17:00:00Z', until: '2026-09-22T17:00:00Z' }, LISBON)).toBe(
      'Since yesterday 18:00',
    )
    expect(sinceLabel({ since: '2026-09-22T08:00:00Z', until: '2026-09-22T17:00:00Z' }, LISBON)).toBe('Since 09:00')
    expect(sinceLabel({ since: '2026-09-18T17:00:00Z', until: '2026-09-22T17:00:00Z' }, LISBON)).toBe('Since Fri 18:00')
    // A gap wider than a week: "Since Tue" would name the wrong Tuesday.
    expect(sinceLabel({ since: '2026-09-08T17:00:00Z', until: '2026-09-22T17:00:00Z' }, LISBON)).toBe(
      'Since 8 Sep 18:00',
    )
  })

  it('names the schedule in the footer', () => {
    expect(digestFooter(schedule())).toBe('Posted by TinyCorp · no usage spent · every weekday at 18:00')
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('every day')
    expect(daysLabel([1, 3, 5])).toBe('on Mon, Wed and Fri')
    expect(daysPreset([1, 2, 3, 4, 5])).toBe('WEEKDAYS')
    expect(daysPreset([1, 3])).toBe('CUSTOM')
  })

  it('sums a day up in one sentence, for the message and the banner', () => {
    const summary = digestSummary(
      digest({
        shipped: [{ ticketId: 1, title: 'A', where: 'api #1', url: '', who: 'Orion' }],
        inReview: [
          { ticketId: 2, title: 'B', where: '', readyForYou: true },
          { ticketId: 3, title: 'C', where: '', readyForYou: false },
        ],
        waiting: [{ id: 'm1', ticketId: null, text: 'Approve', kind: 'Merge', channelId: 'general', threadId: 1 }],
        usage: [{ id: 'claude', name: 'Claude', percent: 68, window: '5h', resets: '21:00', problem: '' }],
      }),
    )

    expect(summary).toBe('1 shipped, 2 in review. 1 thing waits on you. Claude at 68%, resets 21:00.')
  })

  it('says one line on a day with nothing in it', () => {
    expect(isQuietDigest(digest())).toBe(true)
    expect(digestSummary(digest())).toBe(QUIET_DAY)
    // Usage alone is not a day's work: a quiet day stays quiet.
    expect(
      isQuietDigest(
        digest({ usage: [{ id: 'claude', name: 'Claude', percent: 4, window: '5h', resets: '', problem: '' }] }),
      ),
    ).toBe(true)
  })
})
