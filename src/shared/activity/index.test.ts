import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_GROUPS,
  ACTIVITY_KINDS,
  type ActivityEvent,
  activityDays,
  activityGroupOf,
  activityLine,
  activitySegments,
  activityTime,
  isActivityGroup,
  isActivityKind,
} from './index'

function event(createdAt: string, summary = 'did a thing'): ActivityEvent {
  return {
    id: 1,
    kind: 'ticket_created',
    actorId: 'boss',
    actorName: 'Yuri',
    subject: null,
    summary,
    detail: null,
    code: [],
    badge: null,
    payload: {},
    createdAt,
  }
}

/** A local time on a given day, so the grouping is tested in the reader's own zone. */
function at(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute).toISOString()
}

describe('activity kinds and groups', () => {
  it('puts every kind in exactly one of the filter chips', () => {
    for (const kind of ACTIVITY_KINDS) expect(ACTIVITY_GROUPS).toContain(activityGroupOf(kind))
  })

  it('recognises its own kinds and groups, and nothing else', () => {
    expect(isActivityKind('ticket_moved')).toBe(true)
    expect(isActivityKind('ticket_teleported')).toBe(false)
    expect(isActivityGroup('code')).toBe(true)
    expect(isActivityGroup('spend')).toBe(false)
  })
})

describe('grouping the feed by day', () => {
  const now = new Date(2026, 8, 17, 15, 30)

  it('labels today and yesterday and keeps the order inside a day', () => {
    const days = activityDays(
      [
        event(at(2026, 9, 17, 15, 10), 'created TC-322'),
        event(at(2026, 9, 17, 14, 32), 'opened a PR'),
        event(at(2026, 9, 16, 18, 40), 'closed TC-311'),
      ],
      now,
    )

    expect(days.map((day) => day.label)).toEqual(['TODAY', 'YESTERDAY'])
    expect(days[0]!.events.map((e) => e.summary)).toEqual(['created TC-322', 'opened a PR'])
    expect(days[1]!.events).toHaveLength(1)
  })

  it('names an older day by its date', () => {
    const [day] = activityDays([event(at(2026, 9, 10, 9, 0))], now)

    expect(day!.label).not.toBe('TODAY')
    expect(day!.label).toMatch(/\d/)
  })

  it('has no days without events', () => {
    expect(activityDays([], now)).toEqual([])
  })
})

describe('the mono pieces of a row', () => {
  it('marks the code substrings and leaves the rest plain', () => {
    expect(activitySegments('moved TC-318 to Doing', ['TC-318', 'Doing'])).toEqual([
      { text: 'moved ', code: false },
      { text: 'TC-318', code: true },
      { text: ' to ', code: false },
      { text: 'Doing', code: true },
    ])
  })

  it('keeps the longest match whole', () => {
    expect(activitySegments('opened a pull request in web #482', ['web', 'web #482'])).toEqual([
      { text: 'opened a pull request in ', code: false },
      { text: 'web #482', code: true },
    ])
  })

  it('returns the text as one plain piece when nothing matches', () => {
    expect(activitySegments('started their Session', [])).toEqual([{ text: 'started their Session', code: false }])
  })
})

describe('the words of a row’s Line', () => {
  it('drops the spaces that separated the pieces, so the 5px gap is the only spacing', () => {
    expect(activityLine('moved TC-318 to Doing', ['TC-318', 'Doing'])).toEqual([
      [{ text: 'moved', code: false }],
      [{ text: 'TC-318', code: true }],
      [{ text: 'to', code: false }],
      [{ text: 'Doing', code: true }],
    ])
  })

  it('keeps a piece that touched the one before it in the same word, so the gap never opens inside it', () => {
    expect(activityLine('merged TC-1 in payments-web, billing-api', ['TC-1', 'payments-web', 'billing-api'])).toEqual([
      [{ text: 'merged', code: false }],
      [{ text: 'TC-1', code: true }],
      [{ text: 'in', code: false }],
      [
        { text: 'payments-web', code: true },
        { text: ',', code: false },
      ],
      [{ text: 'billing-api', code: true }],
    ])
  })

  it('keeps the spaces inside a plain piece, which the frame draws as one text node', () => {
    expect(activityLine('opened a pull request in web #482', ['web #482'])).toEqual([
      [{ text: 'opened a pull request in', code: false }],
      [{ text: 'web #482', code: true }],
    ])
  })

  it('is one word when the summary has no code marks', () => {
    expect(activityLine('started their Session', [])).toEqual([[{ text: 'started their Session', code: false }]])
  })
})

describe('the time column', () => {
  it('reads as a zero-padded local clock time', () => {
    expect(activityTime(at(2026, 9, 17, 9, 5))).toBe('09:05')
  })
})
