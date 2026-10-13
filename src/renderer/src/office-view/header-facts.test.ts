import { describe, expect, it } from 'vitest'
import { NO_DESK_REASON, type OfficeSprite, type SpriteState } from '../../../shared/office/projection'
import { countLabel, fullLabel, officeHeaderFacts, zoomLabel } from './header-facts'

function sprite(name: string, state: SpriteState, away = false): OfficeSprite {
  return {
    employeeId: name.toLowerCase(),
    name,
    title: 'Engineer',
    sprite: 0,
    state,
    reason: state,
    withIds: [],
    seat: { uid: 'seat-0', x: 10, y: 10, facing: 'down', visitor: { x: 20, y: 10, facing: 'left' }, occluders: [] },
    ...(away ? { away: { x: 50, y: 50, facing: 'up', place: 'coffee' as const } } : {}),
  }
}

/** An Employee the room had no desk for: no chair, waiting at the counter (T101). */
function chairless(name: string): OfficeSprite {
  const { seat: _, ...rest } = sprite(name, 'idle', true)
  return { ...rest, reason: NO_DESK_REASON }
}

describe('officeHeaderFacts', () => {
  it('counts Employees whose Session is on as at work, and those of them not away as at their desks', () => {
    const facts = officeHeaderFacts([
      sprite('Ada', 'working'),
      sprite('Bo', 'idle', true),
      sprite('Cy', 'off'),
      sprite('Di', 'starting'),
    ])
    expect(facts.atWork).toBe(3)
    expect(facts.atDesks).toBe(2)
  })

  it('does not count parked or out-of-budget Employees in the coffee area as at work', () => {
    const facts = officeHeaderFacts([
      sprite('Ada', 'parked', true),
      sprite('Bo', 'out_of_budget', true),
      sprite('Cy', 'working'),
    ])
    expect(facts.atWork).toBe(1)
    expect(facts.atDesks).toBe(1)
    expect(facts.presence.map((p) => p.name)).toEqual(['Cy', 'Ada', 'Bo'])
  })

  it('shows at most four avatars, people at work first, and the rest as a count', () => {
    const facts = officeHeaderFacts(
      ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'].map((name, i) => sprite(name, i < 2 ? 'off' : 'working')),
    )
    expect(facts.presence.map((p) => p.name)).toEqual(['Cy', 'Di', 'Ed', 'Flo'])
    expect(facts.more).toBe(2)
  })

  it('has no overflow count when everyone fits', () => {
    const facts = officeHeaderFacts([sprite('Ada', 'idle')])
    expect(facts.presence.map((p) => p.name)).toEqual(['Ada'])
    expect(facts.more).toBe(0)
  })
})

describe('a room with no desk left (T101)', () => {
  it('is not full while every Employee has a chair of their own', () => {
    const facts = officeHeaderFacts([sprite('Ada', 'working'), sprite('Bo', 'idle', true)])

    expect(facts.noDesk).toBe(0)
    expect(facts.full).toBe(false)
  })

  it('counts whoever the room had no desk for and says it is full', () => {
    const facts = officeHeaderFacts([sprite('Ada', 'working'), chairless('Bo'), chairless('Cy')])

    expect(facts.noDesk).toBe(2)
    expect(facts.full).toBe(true)
    expect(fullLabel(facts)).toBe('Room full · 2 waiting for a desk')
  })
})

describe('labels', () => {
  it('pluralises Employees', () => {
    expect(countLabel(1, 'Employee')).toBe('1 Employee')
    expect(countLabel(0, 'Employee')).toBe('0 Employees')
    expect(countLabel(6, 'Employee')).toBe('6 Employees')
  })

  it('shows the zoom as a whole percentage', () => {
    expect(zoomLabel(0.684)).toBe('68%')
    expect(zoomLabel(2)).toBe('200%')
  })
})
