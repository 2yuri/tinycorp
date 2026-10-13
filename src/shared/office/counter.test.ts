/**
 * What the coffee corner says about itself (T100). A pause or a usage limit sends the whole Company
 * to the counter, where the spots are a few pixels apart; the corner says how many are there and why
 * in one line, and nobody standing in it carries a label of their own.
 */
import { describe, expect, it } from 'vitest'
import type { Employee } from '../domain/staff'
import { counterLabel } from './counter'
import { officeLayout } from './layout'
import { NO_DESK_REASON, type OfficeInput, projectOffice } from './projection'

const NOW = Date.parse('2026-09-17T12:00:00.000Z')

const employee = (name: string, desk: number): Employee => ({
  id: `id-${name}`,
  name,
  desk,
  roleId: 'backend',
  title: 'Backend',
  persona: '',
  capabilities: ['code'],
  repoFilter: [],
  areas: [],
  mcpServers: [],
  skills: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  sprite: 0,
  createdAt: '2026-09-17T00:00:00.000Z',
})

const NAMES = ['Ada', 'Bo', 'Cy', 'Flo', 'Gus', 'Hal']

/** `count` Employees, all of them parked: the whole Company waits at the counter. */
function parked(count: number): OfficeInput {
  const employees = Array.from({ length: count }, (_, i) => employee(NAMES[i]!, i))
  return {
    employees,
    sessions: Object.fromEntries(employees.map((e) => [e.id, 'parked' as const])),
    now: NOW,
  }
}

describe('the line the counter carries', () => {
  it('says nothing while nobody is standing there', () => {
    expect(counterLabel([])).toBeNull()
  })

  it('counts the group and names what put them there', () => {
    expect(counterLabel(['parked', 'parked', 'parked'])).toBe('At the counter · 3 parked')
    expect(counterLabel(['blocked'])).toBe('At the counter · 1 blocked')
    expect(counterLabel(['out_of_budget', 'out_of_budget'])).toBe('At the counter · 2 out of budget')
  })

  it('names the largest group where they are mixed, and still counts them all', () => {
    expect(counterLabel(['parked', 'parked', 'parked', 'blocked', 'blocked', 'out_of_budget'])).toBe(
      'At the counter · 6 parked',
    )
    expect(counterLabel(['parked', 'blocked', 'blocked'])).toBe('At the counter · 3 blocked')
  })

  it('breaks a tie the way the room reads its states, so the same crowd always says the same thing', () => {
    // `out_of_budget` sits above `blocked` in `STATE_PRECEDENCE`, whatever order they arrive in.
    expect(counterLabel(['blocked', 'out_of_budget'])).toBe('At the counter · 2 out of budget')
    expect(counterLabel(['out_of_budget', 'blocked'])).toBe('At the counter · 2 out of budget')
  })
})

describe('the counter in a projected office', () => {
  it('carries one label for a Company that is all at it', () => {
    // As big as the default room's own painting seats, so every one of them is parked rather than
    // waiting for a desk the room never had (T111).
    const all = officeLayout().seats.length
    const scene = projectOffice(parked(all))

    expect(scene.counterLabel).toBe(`At the counter · ${all} parked`)
    expect(scene.sprites.filter((s) => s.away?.place === 'coffee')).toHaveLength(all)
  })

  it('says nothing while everyone is at their own desk', () => {
    const ada = employee('Ada', 0)
    const scene = projectOffice({ employees: [ada], sessions: { [ada.id]: 'busy' }, now: NOW })

    expect(scene.counterLabel).toBeNull()
  })

  it('counts a mixed corner: a pause, a blocked ticket and a usage limit are all standing there', () => {
    const [ada, bo, cy] = [employee('Ada', 0), employee('Bo', 1), employee('Cy', 2)]
    const scene = projectOffice({
      employees: [ada, bo, cy],
      sessions: { [ada.id]: 'parked', [bo.id]: 'idle', [cy.id]: 'out_of_budget' },
      tickets: [{ assigneeId: bo.id, blocked: true, column: 'doing' }],
      now: NOW,
    })

    expect(scene.sprites.every((s) => s.away?.place === 'coffee')).toBe(true)
    expect(scene.counterLabel).toBe('At the counter · 3 out of budget')
  })
})

describe('what the counter says about a queue with no desks', () => {
  it('says what they are waiting for, not what their Sessions happen to be doing', () => {
    const waiting = { state: 'working' as const, reason: NO_DESK_REASON }

    expect(counterLabel([waiting, waiting, waiting])).toBe('At the counter · 3 waiting for a desk')
  })

  it('still names the state where the reason is the state', () => {
    expect(counterLabel([{ state: 'parked', reason: 'Parked' }])).toBe('At the counter · 1 parked')
  })
})
