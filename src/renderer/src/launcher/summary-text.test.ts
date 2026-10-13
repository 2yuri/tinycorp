import { describe, expect, it } from 'vitest'
import type { CompanySummary } from '../../../shared/company'
import { companyMeta, relativeWhen, setupUnfinished, unavailableMessage } from './summary-text'

const now = new Date('2026-09-17T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function summary(patch: Partial<CompanySummary>): CompanySummary {
  return {
    id: 'a',
    name: 'Acme',
    key: 'AC',
    boss: { name: 'Ada', initials: 'AD' },
    folder: '/work/acme',
    createdAt: ago(100 * DAY),
    open: false,
    current: false,
    employees: 3,
    sessions: 0,
    lastOpenedAt: ago(2 * DAY),
    onboardingCompletedAt: ago(99 * DAY),
    missing: false,
    databaseElsewhere: false,
    ...patch,
  }
}

describe('Launcher row text', () => {
  it('says how long ago, the way the design does', () => {
    expect(relativeWhen(ago(20 * 1000), now)).toBe('now')
    expect(relativeWhen(ago(5 * MIN), now)).toBe('5m ago')
    expect(relativeWhen(ago(3 * HOUR), now)).toBe('3h ago')
    expect(relativeWhen(ago(DAY + HOUR), now)).toBe('yesterday')
    expect(relativeWhen(ago(3 * DAY), now)).toBe('3 days ago')
    expect(relativeWhen(ago(8 * DAY), now)).toBe('last week')
    expect(relativeWhen(ago(21 * DAY), now)).toBe('3 weeks ago')
    expect(relativeWhen(ago(40 * DAY), now)).toBe('last month')
    expect(relativeWhen(ago(100 * DAY), now)).toBe('3 months ago')
    expect(relativeWhen(ago(400 * DAY), now)).toBe('last year')
    expect(relativeWhen(ago(800 * DAY), now)).toBe('2 years ago')
    expect(relativeWhen(null, now)).toBeNull()
  })

  it('shows staff, sessions and when for an open Company', () => {
    expect(companyMeta(summary({ open: true, employees: 8, sessions: 5 }), now)).toBe('8 employees · 5 sessions · now')
    expect(companyMeta(summary({ open: true, employees: 1, sessions: 1 }), now)).toBe('1 employee · 1 session · now')
  })

  it('shows idle and the last visit for a Company with no running session', () => {
    expect(companyMeta(summary({}), now)).toBe('3 employees · idle · 2 days ago')
    expect(companyMeta(summary({ employees: 1, lastOpenedAt: ago(21 * DAY) }), now)).toBe(
      '1 employee · idle · 3 weeks ago',
    )
    expect(companyMeta(summary({ open: true, employees: 0 }), now)).toBe('0 employees · idle · now')
    expect(companyMeta(summary({ lastOpenedAt: ago(10 * 1000) }), now)).toBe('3 employees · idle · just now')
  })

  it('says only that the folder is missing when it is gone', () => {
    expect(companyMeta(summary({ missing: true, employees: null }), now)).toBe('Folder missing')
    expect(companyMeta(summary({ missing: true, employees: 3, sessions: 2 }), now)).toBe('Folder missing')
  })

  it('answers a pick of a missing row with where the folder went, and lets every other row open', () => {
    expect(unavailableMessage(summary({ missing: true }))).toBe('Acme is no longer in /work/acme')
    expect(unavailableMessage(summary({}))).toBeNull()
  })

  /**
   * A Company folder in WSL keeps its database on this PC, so the folder can be right there and
   * the Company still have nothing to open: another PC's AppData holds it (T256).
   */
  it('answers a pick of a Company whose database this PC does not hold, and says only that', () => {
    expect(unavailableMessage(summary({ databaseElsewhere: true }))).toBe("This Company's database is on another PC.")
    expect(companyMeta(summary({ databaseElsewhere: true, employees: 3, sessions: 2 }), now)).toBe(
      'Database on another PC',
    )
    expect(setupUnfinished(summary({ onboardingCompletedAt: null, databaseElsewhere: true }))).toBe(false)
  })

  it('leaves out what is unknown', () => {
    expect(companyMeta(summary({ employees: null, lastOpenedAt: null }), now)).toBe('idle')
  })

  it('badges only a Company that still owes its setup wizard, and can still be opened', () => {
    expect(setupUnfinished(summary({ onboardingCompletedAt: null }))).toBe(true)
    expect(setupUnfinished(summary({}))).toBe(false)
    expect(setupUnfinished(summary({ onboardingCompletedAt: null, missing: true }))).toBe(false)
  })
})
