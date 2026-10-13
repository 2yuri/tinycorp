import { describe, expect, it } from 'vitest'
import { SESSION_STATUSES } from '../session'
import { countAtWork, countWaitingOnYou, isAtWork, NOT_AT_WORK } from './at-work'
import { STATE_PRECEDENCE } from './reading'

describe('who counts as at work', () => {
  it('reads a Session that is off, parked or out of budget as not at work', () => {
    expect(SESSION_STATUSES.filter(isAtWork)).toEqual(['starting', 'idle', 'busy'])
  })

  it('reads the sprite states of the same three names the same way', () => {
    const states = STATE_PRECEDENCE.map((row) => row.state)
    expect(states.filter((state) => !isAtWork(state)).toSorted()).toEqual([...NOT_AT_WORK].toSorted())
  })

  it('counts Employees at work, and nobody for an Employee with no Session', () => {
    expect(countAtWork({ ada: 'busy', bo: 'idle', cy: 'off', di: 'parked' })).toBe(2)
    expect(countAtWork({})).toBe(0)
  })
})

describe('who is waiting on the boss', () => {
  it('counts each requester once', () => {
    expect(countWaitingOnYou({ ada: 'busy' }, ['ada', 'ada'])).toBe(1)
  })

  it('leaves out a requester whose Session is off, parked or out of budget', () => {
    // The office reads those three before the `!`, so their sprite never stands at the boss desk.
    const sessions = { ada: 'busy', bo: 'parked', cy: 'out_of_budget', di: 'off' } as const
    expect(countWaitingOnYou(sessions, ['ada', 'bo', 'cy', 'di'])).toBe(1)
  })

  it('leaves out a requester the Company does not know', () => {
    expect(countWaitingOnYou({ ada: 'busy' }, ['zed'])).toBe(0)
  })
})
