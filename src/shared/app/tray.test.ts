import { describe, expect, it } from 'vitest'
import type { SessionStatus } from '../session'
import { NOTHING_OPEN, type TrayFacts, traySummary, traySummaryLabel, trayTooltip } from './tray'

function facts(overrides: Partial<TrayFacts> = {}): TrayFacts {
  return {
    sessions: {},
    pendingRequesterIds: [],
    askingIds: [],
    outOfBudget: false,
    paused: false,
    companies: [{ id: 'acme', name: 'Acme', current: true }],
    ...overrides,
  }
}

const sessions = (statuses: Record<string, SessionStatus>) => statuses

describe('the menu-bar summary', () => {
  it('counts the Employees at work and those an Approval of theirs waits on the boss for', () => {
    const summary = traySummary(
      facts({
        sessions: sessions({ ada: 'busy', bo: 'idle', cy: 'parked', di: 'off' }),
        pendingRequesterIds: ['bo'],
      }),
    )

    expect(summary).toMatchObject({ company: 'Acme', atWork: 2, waitingOnYou: 1, outOfBudget: false })
  })

  it('offers Pause all while any Session is on, parked included, as the header does', () => {
    expect(traySummary(facts({ sessions: sessions({ ada: 'parked' }) })).canPause).toBe(true)
    expect(traySummary(facts({ sessions: sessions({ ada: 'off' }) })).canPause).toBe(false)
  })

  it('carries the pause and the budget through, so the item offers what the app offers', () => {
    const summary = traySummary(facts({ paused: true, outOfBudget: true }))

    expect(summary).toMatchObject({ paused: true, outOfBudget: true })
  })

  it('names no Company when none is open', () => {
    const summary = traySummary(facts({ companies: [] }))

    expect(summary.company).toBeNull()
    expect(traySummaryLabel(summary)).toBe(NOTHING_OPEN)
  })
})

describe('what the item says of itself', () => {
  it('says how many are at work, and adds whoever waits on the boss', () => {
    expect(traySummaryLabel(traySummary(facts({ sessions: sessions({ ada: 'busy' }) })))).toBe('1 at work')
    expect(
      traySummaryLabel(
        traySummary(facts({ sessions: sessions({ ada: 'busy', bo: 'idle' }), pendingRequesterIds: ['bo'] })),
      ),
    ).toBe('2 at work · 1 waiting on you')
  })

  it('says Out of budget instead of the count, as the header wears the badge instead', () => {
    const summary = traySummary(facts({ sessions: sessions({ ada: 'out_of_budget' }), outOfBudget: true }))

    expect(traySummaryLabel(summary)).toBe('Out of budget')
  })

  it('names the floor in the tooltip', () => {
    expect(trayTooltip(traySummary(facts({ sessions: sessions({ ada: 'busy' }) })))).toBe('Acme · 1 at work')
  })
})
