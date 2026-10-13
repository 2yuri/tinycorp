import { describe, expect, it } from 'vitest'
import { clockTime, countdown, resetLine } from './budget-text'

const at = (hhmm: string, day = 17) => new Date(2026, 8, day, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)))
const now = at('11:48')

describe('out-of-budget text', () => {
  it('writes the reset time as a clock, with the date when it is not today', () => {
    expect(clockTime(at('14:00'), now)).toBe('14:00')
    expect(clockTime(at('09:05', 18), now)).toBe('Sep 18, 09:05')
  })

  it('counts down to the reset', () => {
    expect(countdown(at('14:00'), now)).toBe('in 2h 12m')
    expect(countdown(at('12:00'), now)).toBe('in 12m')
    expect(countdown(new Date(now.getTime() + 20_000), now)).toBe('in under a minute')
    expect(countdown(at('11:00'), now)).toBe('any moment now')
    expect(countdown(at('13:00', 19), now)).toBe('in 2d 1h')
  })

  it('reads like the design when the reset time is known', () => {
    const budget = { exhaustedAt: at('11:00').toISOString(), resetsAt: at('14:00').toISOString() }

    expect(resetLine(budget, now)).toBe('Resets at 14:00 · in 2h 12m')
  })

  it('names the retry time when the provider gave no reset time', () => {
    const budget = { exhaustedAt: at('11:30').toISOString(), resetsAt: null }

    expect(resetLine(budget, now)).toBe('Reset time unknown · trying again at 12:30 · in 42m')
  })
})
