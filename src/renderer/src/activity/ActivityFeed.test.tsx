import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../../shared/activity'
import { BOSS } from '../../../shared/domain/chat'
import { ActivityFeed, type ActivityFeedProps } from './ActivityFeed'
import { ActivityRail } from './ActivityRail'

const NOW = new Date(2026, 8, 17, 16, 0)

function at(day: number, hour: number, minute: number): string {
  return new Date(2026, 8, day, hour, minute).toISOString()
}

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
    createdAt: at(17, 15, 10),
    ...patch,
  }
}

function render(patch: Partial<ActivityFeedProps> = {}) {
  return renderToStaticMarkup(
    <ActivityFeed
      events={[]}
      group={null}
      onGroup={() => {}}
      actors={[]}
      actorId={null}
      onActor={() => {}}
      peopleOpen={false}
      search=""
      onSearch={() => {}}
      now={NOW}
      {...patch}
    />,
  )
}

describe('the Activity feed', () => {
  it('draws the design’s kind chips with All pressed', () => {
    const html = render()

    for (const label of ['All', 'Code', 'Tickets', 'People', 'Capacity', 'System']) expect(html).toContain(label)
    expect(html).toMatch(/aria-pressed="true"[^>]*>All/)
    expect(html).toContain('Search activity')
  })

  it('presses the chip that is on', () => {
    expect(render({ group: 'code' })).toMatch(/aria-pressed="true"[^>]*>Code/)
  })

  it('groups the rows by day, newest day first, with the time and the actor', () => {
    const html = render({
      events: [
        event({ id: 3, createdAt: at(17, 15, 10) }),
        event({ id: 2, createdAt: at(17, 14, 32), summary: 'opened a pull request in web #482' }),
        event({ id: 1, createdAt: at(16, 18, 40), summary: 'closed TC-311' }),
      ],
    })

    expect(html).toContain('TODAY')
    expect(html).toContain('YESTERDAY')
    expect(html.indexOf('TODAY')).toBeLessThan(html.indexOf('YESTERDAY'))
    expect(html).toContain('15:10')
    expect(html).toContain('Ada')
  })

  it('calls the boss You and draws the code pieces in the mono style', () => {
    const html = render({
      events: [
        event({ id: 1, actorId: BOSS, actorName: 'Yuri', summary: 'moved TC-318 to Doing', code: ['TC-318', 'Doing'] }),
      ],
    })

    expect(html).toContain('>You<')
    // A `code` element at all is the claim: it is what carries the mono face.
    expect(html).toMatch(/<code[^>]*>TC-318<\/code>/)
    expect(html).toMatch(/<code[^>]*>Doing<\/code>/)
  })

  it('shows the detail line and the badge when the event carries them', () => {
    const html = render({
      events: [
        event({
          id: 1,
          summary: 'opened a pull request in web #482',
          detail: 'Silent token refresh before submit',
          badge: { label: 'Needs review', tone: 'primary' },
        }),
      ],
    })

    expect(html).toContain('Silent token refresh before submit')
    expect(html).toContain('Needs review')
  })

  // T152: the frame draws a dotless 11px status pill, not the kit's dotted 12px one, and the
  // filter bar's search is the 30px pill that lines up with the 30px chips beside it.
  it('draws the frame’s row pill and the frame’s filter-bar search', () => {
    const html = render({
      events: [event({ id: 1, badge: { label: 'Needs review', tone: 'primary' } })],
    })

    expect(html).toContain('data-size="sm"')
    expect(html).not.toContain('data-slot="badge-dot"')
    expect(html).toContain('data-size="sm"')
    expect(html).not.toContain('data-size="compact"')
  })

  // T152: the frame's Line is a flex row with a 5px gap, so no piece may carry a literal space
  // at its edge — that would spend the gap twice.
  it('leaves no literal space between the words of a row’s line', () => {
    const html = render({
      events: [
        event({
          id: 1,
          actorId: BOSS,
          actorName: 'Yuri',
          summary: 'merged TC-1 in web, api',
          code: ['TC-1', 'web', 'api'],
        }),
      ],
    })

    // The row's line is the first `p` of the row's text column.
    const line = html.slice(html.indexOf('<p class='), html.indexOf('</p>'))
    expect(line).not.toMatch(/>[^<]*\s</)
    // `web` and the comma after it touched in the summary, so they stay inside one word.
    expect(line).toMatch(/<code[^>]*>web<\/code><span>,<\/span>/)
  })

  it('lists the Employees to filter by only while the filter is open', () => {
    const actors = [{ id: 'e-ada', name: 'Ada' }]

    expect(render({ actors })).not.toContain('Everyone')
    const open = render({ actors, peopleOpen: true })
    expect(open).toContain('Everyone')
    expect(open).toContain('Ada')
  })

  it('says the log is empty, and says so differently when a filter hides it', () => {
    expect(render()).toContain('No activity yet')
    expect(render({ search: 'nothing' })).toContain('Nothing matches those filters')
  })

  it('shows an error from the engine', () => {
    expect(render({ error: 'No Company is open' })).toContain('No Company is open')
  })
})

describe('the Activity rail', () => {
  it('counts today’s events and lists the Sessions that are up', () => {
    const html = renderToStaticMarkup(
      <ActivityRail
        now={NOW}
        nameOf={(id) => (id === 'e-ada' ? 'Ada' : 'Vega')}
        people={{ employees: [] }}
        events={[
          event({ id: 3, kind: 'pull_request_opened' }),
          event({ id: 2, kind: 'ticket_created' }),
          event({ id: 1, kind: 'ticket_created', createdAt: at(16, 9, 0) }),
        ]}
        sessions={[
          {
            employeeId: 'e-ada',
            status: 'busy',
            providerSessionId: null,
            lastHook: null,
            lastHookAt: null,
            startedAt: null,
            providerReady: true,
            subagents: [],
            subSessions: [],
            asking: null,
            routedTo: null,
          },
          {
            employeeId: 'e-vega',
            status: 'off',
            providerSessionId: null,
            lastHook: null,
            lastHookAt: null,
            startedAt: null,
            providerReady: true,
            subagents: [],
            subSessions: [],
            asking: null,
            routedTo: null,
          },
        ]}
      />,
    )

    expect(html).toContain('tickets opened')
    expect(html).toContain('PRs opened')
    expect(html).toContain('Ada')
    expect(html).not.toContain('Vega')
    expect(html).toContain('append-only')
  })

  it('says when no Session is running', () => {
    const html = renderToStaticMarkup(
      <ActivityRail now={NOW} nameOf={() => 'Ada'} people={{ employees: [] }} events={[]} sessions={[]} />,
    )

    expect(html).toContain('No Session is running.')
  })
})
