import { describe, expect, it } from 'vitest'
import type { Employee } from '../domain/staff'
import { SESSION_STATUSES, type SessionStatus } from '../session'
import { spotsClash } from './boss'
import { CHARACTER_SHEETS } from './characters'
import { officeLayout } from './layout'
import { PAINTED_ROOM } from './painted-room'
import { projectOffice } from './projection'
import { isSelectable, ROOMS } from './rooms'

function employee(name: string, desk: number): Employee {
  return {
    id: `id-${name}`,
    name,
    desk,
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
  }
}

const team = ['Ada', 'Bo', 'Cy', 'Di', 'Eve', 'Flo', 'Gil', 'Hal'].map(employee)
const every = (status: SessionStatus) => Object.fromEntries(team.map((e) => [e.id, status]))

describe('the boss at their own desk', () => {
  it('sits at the boss seat with no Employees and no Sessions at all', () => {
    const scene = projectOffice({ employees: [] })

    expect(scene.boss.seat).toEqual(PAINTED_ROOM.boss.seat)
  })

  it('sits there in every Session state, including all of them off', () => {
    for (const status of SESSION_STATUSES) {
      const scene = projectOffice({
        employees: team,
        sessions: every(status),
        approvals: [{ requesterId: team[0]!.id, status: 'pending' }],
        tickets: [{ assigneeId: team[1]!.id, blocked: true, column: 'doing' }],
      })

      expect(scene.boss.seat).toEqual(PAINTED_ROOM.boss.seat)
      expect(scene.sprites).toHaveLength(team.length)
    }
  })

  it('is drawn with the character Your profile picked, whatever number comes in', () => {
    expect(projectOffice({ employees: [], bossSprite: 3 }).boss.sprite).toBe(3)
    // A sheet from another build, or a negative one, still lands on a row that exists.
    expect(projectOffice({ employees: [], bossSprite: CHARACTER_SHEETS + 2 }).boss.sprite).toBe(2)
    expect(projectOffice({ employees: [], bossSprite: -1 }).boss.sprite).toBe(CHARACTER_SHEETS - 1)
    // Nothing picked yet: the first character, as the profile's default says.
    expect(projectOffice({ employees: [] }).boss.sprite).toBe(0)
  })

  it('never lets an Employee stand or sit on the boss seat', () => {
    for (const status of SESSION_STATUSES) {
      const scene = projectOffice({
        employees: team,
        sessions: every(status),
        // Everyone wants the same desk, so the projection has to move most of them somewhere.
        approvals: team.map((e) => ({ requesterId: e.id, status: 'pending' as const })),
      })

      for (const sprite of scene.sprites) {
        expect(sprite.seat?.x === scene.boss.seat.x && sprite.seat?.y === scene.boss.seat.y).toBe(false)
        if (sprite.away) expect(spotsClash(sprite.away, scene.boss.seat)).toBe(false)
      }
    }
  })

  it('keeps every desk a room can grow off the boss seat', () => {
    for (const room of ROOMS.filter(isSelectable)) {
      const layout = officeLayout(room.geometry)

      for (const seat of layout.seats) expect(spotsClash(seat, layout.boss.seat), room.slug).toBe(false)
    }
  })
})

describe('the visitor spot at the boss desk', () => {
  it('stands beside the seat, never on it, in every measured room', () => {
    const measured = ROOMS.filter(isSelectable)

    expect(measured.length).toBeGreaterThan(0)
    for (const room of measured) {
      const { seat, visitor } = officeLayout(room.geometry).boss

      expect(spotsClash(visitor, seat)).toBe(false)
    }
  })

  it('is where an Employee talking to the boss goes', () => {
    const scene = projectOffice({
      employees: team,
      sessions: every('busy'),
      approvals: [{ requesterId: team[0]!.id, status: 'pending' }],
    })
    const visiting = scene.sprites.find((s) => s.away?.place === 'boss')

    expect(visiting?.away).toMatchObject(PAINTED_ROOM.boss.visitor)
  })
})
