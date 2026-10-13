import { describe, expect, it } from 'vitest'
import type { Employee } from '../domain/staff'
import { SESSION_STATUSES, type SessionStatus } from '../session'
import { CELL, inside, officeLayout, walkable } from './layout'
import { PAINTED_ROOM } from './painted-room'
import { projectOffice } from './projection'

function employee(overrides: Partial<Employee> & Pick<Employee, 'name' | 'desk'>): Employee {
  return {
    id: `id-${overrides.name}`,
    roleId: 'pm',
    title: 'PM',
    persona: '',
    capabilities: ['intake'],
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
    ...overrides,
  }
}

describe('officeLayout', () => {
  it('seats the first Employees at the painted desks, in the painting', () => {
    const layout = officeLayout()

    expect(layout.seats.slice(0, PAINTED_ROOM.seats.length)).toEqual(
      PAINTED_ROOM.seats.map((seat, i) =>
        expect.objectContaining({ uid: `desk-${i}`, x: seat.x, y: seat.y, facing: seat.facing, visitor: seat.visitor }),
      ),
    )
    expect({ width: layout.width, height: layout.height }).toEqual({ width: 1040, height: 660 })
  })

  it('has one seat per chair the painting draws, each at its own spot inside it', () => {
    const layout = officeLayout()

    expect(layout.seats.length).toBe(PAINTED_ROOM.seats.length)
    const spots = layout.seats.map((s) => `${s.x},${s.y}`)
    expect(new Set(spots).size).toBe(spots.length)
    for (const seat of layout.seats) {
      expect(seat.x).toBeGreaterThan(0)
      expect(seat.x).toBeLessThan(layout.width)
      expect(seat.y).toBeLessThan(layout.height)
    }
  })

  it('seats the chairs the painting draws and no more: no desk the room never had (T111)', () => {
    const layout = officeLayout()

    // A desk from the kit is a generic piece behind a sprite that brings its own chair, so a room
    // seats its own painted chairs, full stop; past them an Employee waits at the counter.
    expect(layout.seats.map((seat) => ({ x: seat.x, y: seat.y }))).toEqual(
      PAINTED_ROOM.seats.map((seat) => ({ x: seat.x, y: seat.y })),
    )
    // A painted chair is tucked under the desk the painting drew it at, so the floor is the check.
    for (const seat of layout.seats) {
      expect(inside(seat, PAINTED_ROOM.floor), `${seat.uid} off the floor`).toBe(true)
    }
  })

  it('is the painting and nothing else, however big the Company is', () => {
    const layout = officeLayout()

    expect({ width: layout.width, height: layout.height }).toEqual(layout.painting)
    for (const seat of layout.seats) expect(seat.y).toBeLessThan(layout.painting.height)
  })

  it('walks on the painted floor and never through painted furniture', () => {
    const layout = officeLayout()
    const grid = walkable(layout)
    const at = (x: number, y: number) => grid[Math.floor(y / CELL)]![Math.floor(x / CELL)]

    expect(at(700, 600), 'open floor').toBe(true)
    expect(at(500, 100), 'the back wall').toBe(false)
    expect(at(500, 320), 'the coffee table').toBe(false)
    expect(at(765, 545), 'the goose').toBe(false)
    expect(at(950, 450), 'behind the kitchen counter').toBe(false)
    expect(at(1000, 640), 'the dark outside').toBe(false)
  })
})

describe('projectOffice', () => {
  it('is an empty office with no Employees', () => {
    expect(projectOffice({ employees: [] }).sprites).toEqual([])
  })

  it('puts one sprite per Employee at their own desk, showing Off', () => {
    const ada = employee({ name: 'Ada', title: 'Backend', desk: 0, sprite: 2 })
    const bob = employee({ name: 'Bob', desk: 4, sprite: 4 })

    const office = projectOffice({ employees: [ada, bob] })

    expect(office.sprites).toEqual([
      {
        employeeId: ada.id,
        name: 'Ada',
        title: 'Backend',
        sprite: 2,
        state: 'off',
        reason: 'Off',
        withIds: [],
        seat: office.layout.seats[0],
      },
      {
        employeeId: bob.id,
        name: 'Bob',
        title: 'PM',
        sprite: 4,
        state: 'off',
        reason: 'Off',
        withIds: [],
        seat: office.layout.seats[4],
      },
    ])
  })

  it('leaves an Employee past the last chair with none, waiting at the counter (T111)', () => {
    const zed = employee({ name: 'Zed', desk: 30 })
    const office = projectOffice({ employees: [zed], sessions: { [zed.id]: 'busy' } })

    expect(office.layout.seats[30]).toBeUndefined()
    expect(office.sprites[0]!.seat).toBeUndefined()
    expect(office.sprites[0]!.away?.place).toBe('coffee')
  })
})

describe('projectOffice with Sessions', () => {
  const ada = employee({ name: 'Ada', desk: 0 })
  const stateFor = (status: SessionStatus) =>
    projectOffice({ employees: [ada], sessions: { [ada.id]: status } }).sprites[0]!.state

  it('shows Off, Starting, Idle and Busy (working) from the Session status', () => {
    expect(SESSION_STATUSES.slice(0, 4)).toEqual(['off', 'starting', 'idle', 'busy'])
    expect(SESSION_STATUSES.slice(0, 4).map(stateFor)).toEqual(['off', 'starting', 'idle', 'working'])
  })

  it('shows Parked and Out of budget, away from the chair, for those Session statuses', () => {
    expect((['parked', 'out_of_budget'] as const).map(stateFor)).toEqual(['parked', 'out_of_budget'])
  })

  it('shows Off for an Employee with no Session status', () => {
    const bob = employee({ name: 'Bob', desk: 1 })

    const office = projectOffice({ employees: [ada, bob], sessions: { [ada.id]: 'idle' } })

    expect(office.sprites.map((s) => s.state)).toEqual(['idle', 'off'])
  })
})
