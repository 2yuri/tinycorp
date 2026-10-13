import { describe, expect, it } from 'vitest'
import { ACTIVITY_KINDS, type ActivityEvent } from '../../../shared/activity'
import { BOSS } from '../../../shared/domain/chat'
import { activityCsv, activityLook, actorLabel, todayStats } from './activity-view'

const NOW = new Date(2026, 8, 17, 16, 0)

function event(patch: Partial<ActivityEvent> & Pick<ActivityEvent, 'id'>): ActivityEvent {
  return {
    kind: 'ticket_created',
    actorId: 'e-ada',
    actorName: 'Ada',
    subject: null,
    summary: 'created TC-322',
    detail: null,
    code: [],
    badge: null,
    payload: {},
    createdAt: new Date(2026, 8, 17, 15, 10).toISOString(),
    ...patch,
  }
}

describe('how a row looks', () => {
  it('gives every kind an icon and a tint', () => {
    for (const kind of ACTIVITY_KINDS) {
      const look = activityLook(kind)
      expect(look.icon, kind).toBeTruthy()
      expect(look.tone, kind).toBeTruthy()
    }
  })

  it('names the boss You and everyone else by the name in the log', () => {
    expect(actorLabel(event({ id: 1, actorId: BOSS, actorName: 'Yuri' }))).toBe('You')
    expect(actorLabel(event({ id: 2 }))).toBe('Ada')
  })
})

describe('today’s counts', () => {
  it('counts only today’s events, per tile', () => {
    const stats = todayStats(
      [
        event({ id: 4, kind: 'pull_request_opened' }),
        event({ id: 3, kind: 'ticket_created' }),
        event({ id: 2, kind: 'merged' }),
        event({ id: 1, kind: 'ticket_created', createdAt: new Date(2026, 8, 16, 9, 0).toISOString() }),
      ],
      NOW,
    )

    expect(Object.fromEntries(stats.map((stat) => [stat.key, stat.value]))).toEqual({
      'tickets-opened': 1,
      'prs-opened': 1,
      merges: 1,
      approvals: 0,
    })
  })

  it('reads zero with an empty log', () => {
    expect(todayStats([], NOW).every((stat) => stat.value === 0)).toBe(true)
  })
})

describe('the exported log', () => {
  it('writes a header and one line per event, oldest first, quoting commas', () => {
    const csv = activityCsv([
      event({ id: 2, summary: 'moved TC-318 to Doing' }),
      event({ id: 1, summary: 'created TC-318', detail: 'Login, with a comma' }),
    ])

    const [header, first, second] = csv.split('\n')
    expect(header).toBe('when,kind,actor,summary,detail,subject')
    expect(first).toContain('created TC-318')
    expect(first).toContain('"Login, with a comma"')
    expect(second).toContain('moved TC-318 to Doing')
  })
})
